/* server.js — ListIt (full, drop-in, S3 + SQLite-safe migrations)
   Features:
   - Users (email, username, bcrypt) + JWT cookies & Bearer support
   - Listings w/ title, description, price, location, tags (private), multi-images
   - Thin listings via ?noimg=1
   - **Pagination** for public listings (75 default, keyset or page)
   - Batch cover fetch /api/listings/covers
   - S3 direct uploads (presign + finalize) with SQLite metadata
   - AI analysis (title, tags, suggested price)
   - Conversations/messages with image attachments
   - Reverse geocoding proxy (OpenStreetMap)
   - Fuzzy city filtering & city autocomplete support
   - GPS lat/lon columns + /api/listings/nearby
   - Admin delete endpoints
   - Robust migrations for legacy DBs (adds missing columns safely)
   - Compression + static caching
   - Opt-in enable_nearby (default 0)
   - Immutable lat/lon (set once on first opt-in)
   - Larger image limit via MAX_IMAGE_MB (default 20MB) + 100MB body limit
   - Messages support S3 URLs (stored in message_images.url if provided)
   - Security: CSRF Origin/Referer guard, rate limits, helmet + CSP, finalize URL allowlist, strong JWT secret in prod
*/

const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

let cors; try { cors = require('cors'); } catch {}
let compression; try { compression = require('compression'); } catch {}

// Security deps (optional require to avoid crashing before package.json is updated)
let helmet; try { helmet = require('helmet'); } catch {}
let rateLimit; try { rateLimit = require('express-rate-limit'); } catch {}

let OpenAI; try { OpenAI = require('openai'); } catch {}

// Initialize app BEFORE any route usage
const app = express();
app.disable('x-powered-by');
// Always safe on Render/behind proxies for correct IPs/cookies
app.set('trust proxy', 1);

// S3 presign module (lazy error tolerant)
let presignUpload;
try {
  ({ presignUpload } = require('./s3'));
  console.log('[S3] s3.js loaded:', typeof presignUpload === 'function', 'bucket=', process.env.S3_BUCKET);
} catch (e) {
  console.error('[S3] require("./s3") failed:', e && e.message);
}

const PORT = process.env.PORT || 3000;
const IS_TEST = process.env.NODE_ENV === 'test';
const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_change_me';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || null;
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const PUBLIC_ASSET_BASE = (process.env.PUBLIC_ASSET_BASE || '').trim();
const S3_ORIGIN = (process.env.S3_BUCKET && process.env.S3_REGION)
  ? `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com`
: null;
const ASSET_ORIGIN = PUBLIC_ASSET_BASE || S3_ORIGIN || null;
// Refuse weak/empty JWT secret in production
if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev_jwt_change_me')) {
  console.error('FATAL: JWT_SECRET must be set to a strong value in production.');
  process.exit(1);
}

// === Image size knobs ===
const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB || 20);
const B64_SLOP = 1.6;

/* ------------------------------------------------------------------ */
/* Core parsers                                                        */
/* ------------------------------------------------------------------ */

app.use(cookieParser());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'invalid_json' });
  }
  next(err);
});

/* ------------------------------------------------------------------ */
/* CORS (with credentials)                                            */
/* ------------------------------------------------------------------ */
if (FRONTEND_ORIGIN && cors) {
  const corsCfg = {
    origin: FRONTEND_ORIGIN,
    credentials: true,
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
  };
  app.use(cors(corsCfg));
  app.options('*', cors(corsCfg));
}

/* ------------------------------------------------------------------ */
/* Security headers (helmet + CSP + HSTS)                              */
/* ------------------------------------------------------------------ */
if (helmet) {
  app.use(helmet({
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow loading from S3/CDN
  }));

  app.use(helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", "data:", "https:", "blob:"],              // S3/CloudFront
      "script-src": ["'self'", "https://unpkg.com"],           // React UMD
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["https://fonts.gstatic.com"],
      // allow presigned S3 PUTs/XHR to any https host (tighten to your bucket/CDN later if desired)
      "connect-src": ["'self'", "https://nominatim.openstreetmap.org", "https:", "wss:"],
      "frame-ancestors": ["'none'"],
      "object-src": ["'none'"]
    }
  }));

  if (IS_PROD) app.use(helmet.hsts({ maxAge: 15552000 })); // 180d
} else {
  console.warn('[security] helmet not installed; skipping security headers');
}

/* ------------------------------------------------------------------ */
/* Compression + static caching                                       */
/* ------------------------------------------------------------------ */
if (compression) app.use(compression());
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { maxAge: '7d', immutable: true }));

/* ------------------------------------------------------------------ */
/* SQLite path handling                                               */
/* ------------------------------------------------------------------ */
const DEFAULT_DB = path.join(__dirname, 'listit.db');
const WANTED_DB = process.env.DB_PATH || DEFAULT_DB;

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); return true; }
  catch (e) { console.warn('Could not create DB dir', dir, e.message); return false; }
}

/* -------------------- URL allowlist for message/finalize images ---- */
function isAllowedPublicUrl(u) {
  try {
    const url = new URL(u);
    if (PUBLIC_ASSET_BASE) return u.startsWith(PUBLIC_ASSET_BASE); // strict mode if set
    return (
      url.protocol === 'https:' &&
      (url.hostname.endsWith('.amazonaws.com') || url.hostname.endsWith('.cloudfront.net'))
    );
  } catch { return false; }
}

/* -------------------- CSRF Origin/Referer guard -------------------- */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function originGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!FRONTEND_ORIGIN) return next(); // nothing to enforce if not cross-site

  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const ok =
    (origin && origin === FRONTEND_ORIGIN) ||
    (referer && referer.startsWith(FRONTEND_ORIGIN + '/'));

  if (!ok) return res.status(403).json({ error: 'bad_origin' });
  next();
}
app.use(originGuard);

let DB_PATH = WANTED_DB;
if (!ensureDirFor(WANTED_DB)) {
  console.warn('Falling back to local DB path:', DEFAULT_DB);
  DB_PATH = DEFAULT_DB;
}

let db;
try {
  db = new Database(IS_TEST ? ':memory:' : DB_PATH);
  console.log('SQLite DB opened at:', IS_TEST ? ':memory:' : DB_PATH);
} catch (e) {
  console.error('Failed to open DB at', DB_PATH, e);
  db = new Database(':memory:');
  console.warn('Using in-memory DB — data will not persist.');
}

try { db.pragma('journal_mode = WAL'); } catch {}
try { db.pragma('foreign_keys = ON'); } catch {}

/* ------------------------------------------------------------------ */
/* Schema + robust migrations                                         */
/* ------------------------------------------------------------------ */
function hasColumn(table, col) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some(r => r.name === col);
  } catch { return false; }
}
function addColumnIfMissing(table, col, ddl) {
  if (!hasColumn(table, col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl};`);
  }
}
function createIndexIfMissing(name, ddl) {
  try { db.exec(ddl); } catch {}
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);
addColumnIfMissing('users', 'username', 'TEXT');
createIndexIfMissing('idx_users_username', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);');
addColumnIfMissing('users', 'is_admin', 'INTEGER DEFAULT 0');
addColumnIfMissing('users', 'paypal_email', 'TEXT');

db.exec(`
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  image_data TEXT,
  title TEXT,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  price REAL NOT NULL,
  created_at TEXT NOT NULL,
  tags TEXT,
  lat REAL,
  lon REAL,
  enable_nearby INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);
addColumnIfMissing('listings', 'image_data', 'TEXT');
addColumnIfMissing('listings', 'title', 'TEXT DEFAULT ""');
addColumnIfMissing('listings', 'tags', 'TEXT DEFAULT ""');
addColumnIfMissing('listings', 'lat', 'REAL');
addColumnIfMissing('listings', 'lon', 'REAL');
addColumnIfMissing('listings', 'enable_nearby', 'INTEGER DEFAULT 0');
try { db.exec('UPDATE listings SET enable_nearby = 1 WHERE enable_nearby IS NULL AND lat IS NOT NULL AND lon IS NOT NULL;'); } catch {}

db.exec(`
CREATE TABLE IF NOT EXISTS listing_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  image_data TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES listings(id)
);
`);
createIndexIfMissing('idx_listing_images_listing',
  'CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images(listing_id, position);'
);
addColumnIfMissing('listing_images', 'key', 'TEXT');
addColumnIfMissing('listing_images', 'url', 'TEXT');
addColumnIfMissing('listing_images', 'width', 'INTEGER');
addColumnIfMissing('listing_images', 'height', 'INTEGER');
addColumnIfMissing('listing_images', 'bytes', 'INTEGER');
addColumnIfMissing('listing_images', 'created_at', 'INTEGER DEFAULT 0');
try {
  db.exec(`
    UPDATE listing_images
    SET created_at = CAST(strftime('%s','now') AS INTEGER)
    WHERE created_at IS NULL OR created_at = 0;
  `);
} catch (e) { console.warn('created_at backfill skipped:', e.message); }
createIndexIfMissing('idx_listing_images_listing_id',
  'CREATE INDEX IF NOT EXISTS idx_listing_images_listing_id ON listing_images(listing_id, id)'
);
try {
  db.exec(`
    UPDATE listings
    SET image_data = (
      SELECT COALESCE(url, image_data)
      FROM listing_images
      WHERE listing_id = listings.id
      ORDER BY
        CASE WHEN position IS NULL THEN 1 ELSE 0 END,
        position ASC,
        id ASC
      LIMIT 1
    )
    WHERE image_data IS NULL OR image_data = '';
  `);
  console.log('Cover backfill complete');
} catch (e) { console.warn('Cover backfill skipped:', e.message); }

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a_user_id INTEGER NOT NULL,
  b_user_id INTEGER NOT NULL,
  listing_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (a_user_id, b_user_id, listing_id)
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS message_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  image_data TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
`);
addColumnIfMissing('message_images', 'key', 'TEXT');
addColumnIfMissing('message_images', 'url', 'TEXT');
addColumnIfMissing('message_images', 'width', 'INTEGER');
addColumnIfMissing('message_images', 'height', 'INTEGER');
addColumnIfMissing('message_images', 'bytes', 'INTEGER');
addColumnIfMissing('message_images', 'created_at', 'INTEGER DEFAULT 0');
createIndexIfMissing('idx_msg_imgs_msg',
  'CREATE INDEX IF NOT EXISTS idx_msg_imgs_msg ON message_images(message_id, position);'
);
createIndexIfMissing('idx_listings_user', 'CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id, id);');
createIndexIfMissing('idx_listings_created', 'CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(id DESC);');
createIndexIfMissing('idx_listings_lat_lon', 'CREATE INDEX IF NOT EXISTS idx_listings_lat_lon ON listings(lat, lon);');

/* ------------------------------------------------------------------ */
/* Utils                                                              */
/* ------------------------------------------------------------------ */
function nowIso(){ return new Date().toISOString(); }
function normalizePair(u1, u2){
  const a = Math.min(Number(u1), Number(u2));
  const b = Math.max(Number(u1), Number(u2));
  return { a, b };
}
function normalizeTags(input) {
  if (!input) return '';
  let arr = Array.isArray(input) ? input : String(input).split(',');
  arr = arr.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  const seen = new Set();
  const clean = [];
  for (let t of arr) {
    t = t.replace(/[^a-z0-9 \-]/g, '').trim();
    if (!t || t.length > 32) continue;
    if (seen.has(t)) continue;
    clean.push(t);
    seen.add(t);
    if (clean.length >= 20) break;
  }
  return clean.join(',');
}
function shortTitle(str) {
  const s = String(str || '').trim();
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').slice(0, 80);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function fallbackTagsFromTitleDesc(title, desc) {
  const s = `${title || ''} ${desc || ''}`.toLowerCase();
  const words = (s.match(/[a-z0-9\-]{3,}/g) || []).slice(0, 80);
  const freq = {};
  for (const w of words) { freq[w] = (freq[w] || 1) + 1; }
  const base = Object.entries(freq).sort((a,b)=>b[1]-a[1]).map(([w])=>w).slice(0,10);
  const generic = ['sale','buy','deal','used','second hand','good','condition','local','pickup','cheap','discount','shop','offer'];
  return [...new Set([...base, ...generic])].slice(0, 20);
}
function normLetters(s){ return String(s||'').toLowerCase().replace(/[^a-z]/g,''); }
function cityOf(location){ return String(location||'').split(',')[0].trim(); }
function levenshtein(a,b){
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if (m===0) return n; if (n===0) return m;
  const dp = new Array(n+1);
  for (let j=0;j<=n;j++) dp[j]=j;
  for (let i=1;i<=m;i++){
    let prev = i-1;
    dp[0]=i;
    for (let j=1;j<=n;j++){
      const tmp = dp[j];
      const cost = a[i-1]===b[j-1]?0:1;
      dp[j] = Math.min(dp[j]+1, dp[j-1]+1, prev+cost);
      prev = tmp;
    }
  }
  return dp[n];
}
function pickMatchingCities(allCities, query){
  const out = new Set();
  const q = (query||'').trim();
  const qn = normLetters(q);
  if (!q) return out;
  for (const c of allCities){
    const cn = normLetters(c);
    if (!cn) continue;
    if (c.toLowerCase().includes(q.toLowerCase()) || cn.includes(qn) || cn.startsWith(qn)) { out.add(c); continue; }
    const d = levenshtein(cn, qn);
    if (d <= 2) { out.add(c); continue; }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Auth helpers                                                        */
/* ------------------------------------------------------------------ */
function setAuthCookie(res, payload){
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: FRONTEND_ORIGIN ? 'none' : 'lax',
    secure: IS_PROD,
    domain: COOKIE_DOMAIN,
    maxAge: 7*24*60*60*1000,
    path: '/'
  });
  return token;
}
function clearAuthCookie(res){
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: FRONTEND_ORIGIN ? 'none' : 'lax',
    secure: IS_PROD,
    domain: COOKIE_DOMAIN,
    path: '/'
  });
}
function authFromReq(req){
  let t = req.cookies?.token;
  const hdr = req.headers?.authorization || '';
  if (!t && hdr.startsWith('Bearer ')) t = hdr.slice(7);
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}
function auth(req, res, next){
  const user = authFromReq(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next){
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

/* ------------------------------------------------------------------ */
/* Rate limiters                                                       */
/* ------------------------------------------------------------------ */
function mkLimiter(cfg) {
  return rateLimit ? rateLimit({ ...cfg, standardHeaders: true, legacyHeaders: false }) : (req,res,next)=>next();
}
const loginLimiter   = mkLimiter({ windowMs: 15*60*1000, max: 20 });
const writeLimiter   = mkLimiter({ windowMs: 60*1000, max: 60 });
const uploadLimiter  = mkLimiter({ windowMs: 10*60*1000, max: 120 });
const geocodeLimiter = mkLimiter({ windowMs: 60*1000, max: 30 });

/* ------------------------------------------------------------------ */
/* Optional admin bootstrap                                           */
/* ------------------------------------------------------------------ */
(function maybeCreateAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const username = (process.env.ADMIN_USERNAME || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !username || !password) return;
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) { console.log('Admin exists:', email); return; }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (email, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, 1)')
    .run(email, username, hash, nowIso());
  console.log('Admin created:', email, 'username:', username);
})();

/* ------------------------------------------------------------------ */
/* Auth routes                                                         */
/* ------------------------------------------------------------------ */
app.post('/api/register', writeLimiter, async (req, res) => {
  const username = (req.body.username || req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!username || !email || !password) return res.status(400).json({ error: 'Username, email, and password are required' });
  if (username.length < 3 || username.length > 32) return res.status(400).json({ error: 'Username must be 3–32 chars' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 chars' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (email, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, 0)')
      .run(email, username, hash, nowIso());
    const user = { id: info.lastInsertRowid, email, username, is_admin: false };
    const token = setAuthCookie(res, user);
    return res.json({ ...user, token });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('users.email'))   return res.status(409).json({ error: 'Email already registered' });
    if (msg.includes('users.username'))return res.status(409).json({ error: 'Username already taken' });
    console.error(e);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !row.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
  try {
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const user = { id: row.id, email: row.email, username: row.username, is_admin: !!row.is_admin };
    const token = setAuthCookie(res, user);
    return res.json({ ...user, token });
  } catch (e) {
    console.error('Bcrypt compare error:', e);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/logout', (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const u = authFromReq(req);
  if (!u) return res.json(null);

  try {
    const row = db.prepare(`
      SELECT id, email, username, is_admin,
             COALESCE(paypal_email, '') AS paypal_email
      FROM users
      WHERE id = ?
    `).get(u.id);

    if (!row) return res.json(null);
    return res.json({
      id: row.id,
      email: row.email,
      username: row.username,
      is_admin: !!row.is_admin,
      paypal_email: row.paypal_email
    });

  } catch (e) {
    // Fallback if the column doesn't exist yet (avoids 500 + logout on refresh)
    const msg = String(e && e.message || '');
    if (msg.includes('no such column: paypal_email')) {
      const row = db.prepare(`
        SELECT id, email, username, is_admin,
               '' AS paypal_email
        FROM users
        WHERE id = ?
      `).get(u.id);
      if (!row) return res.json(null);
      return res.json({
        id: row.id,
        email: row.email,
        username: row.username,
        is_admin: !!row.is_admin,
        paypal_email: ''
      });
    }
    console.error('GET /api/me failed:', e);
    return res.status(500).json({ error: 'me_failed' });
  }
});


app.put('/api/me/paypal', auth, writeLimiter, (req, res) => {
  const email = String(req.body?.paypal_email || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  db.prepare('UPDATE users SET paypal_email = ? WHERE id = ?').run(email || null, req.user.id);
  return res.json({ ok: true, paypal_email: email || '' });
});


/* ------------------------------------------------------------------ */
/* Listings (thin response + fuzzy city filter + **pagination** + **sorting**)       */
/* ------------------------------------------------------------------ */

function ensureListingColumns() {
  try {
    addColumnIfMissing('listings', 'title', 'TEXT DEFAULT ""');
    addColumnIfMissing('listings', 'tags', 'TEXT DEFAULT ""');
    addColumnIfMissing('listings', 'lat', 'REAL');
    addColumnIfMissing('listings', 'lon', 'REAL');
    addColumnIfMissing('listings', 'enable_nearby', 'INTEGER DEFAULT 0');
  } catch (e) { console.warn('ensureListingColumns failed:', e.message); }
}

function validateImages(images) {
  if (!Array.isArray(images) || images.length === 0) return 'At least one image is required';
  if (images.length > 10) return 'Too many images (max 10)';
  const maxB64Len = MAX_IMAGE_MB * 1024 * 1024 * B64_SLOP;
  for (const img of images) {
    if (typeof img !== 'string' || !img.startsWith('data:image')) return 'Each image must be a data URL';
    if (img.length > maxB64Len) return `Each image must be <= ~${MAX_IMAGE_MB}MB`;
  }
  return null;
}

/* ---------- allow S3 URLs or base64 for message images ---------- */
function validateMsgImages(images) {
  if (!images) return null;
  if (!Array.isArray(images)) return 'images must be an array';
  if (images.length > 5) return 'Too many images (max 5)';
  const maxB64Len = MAX_IMAGE_MB * 1024 * 1024 * B64_SLOP;
  for (const img of images) {
    if (typeof img !== 'string') return 'Each image must be a string';
    if (img.startsWith('data:image/') && img.length > maxB64Len) return `Each image must be <= ~${MAX_IMAGE_MB}MB`;
    if (img.startsWith('https://') && !isAllowedPublicUrl(img)) return 'Invalid image URL';
  }
  return null;
}

/**
 * GET /api/listings
 * Public feed is **paginated** by default:
 *   - limit: max 75 (default 75)
 *   - page: 1-based pages (used if no cursor provided)
 *   - cursor (aka before_id): keyset pagination; returns items with id < cursor
 *   - sort: 'new' (default, newest first), 'price_asc', 'price_desc', 'city'
 * For /api/listings?mine=1:
 *   - returns full list (legacy behavior) unless any pagination param is supplied.
 */
app.get('/api/listings', (req, res) => {
  const qRaw   = (req.query.q   || '').toString().trim().toLowerCase();
  const locRaw = (req.query.loc || '').toString().trim();
  const mine = req.query.mine === '1';
  const noimg = req.query.noimg === '1';
  const sort = String(req.query.sort || 'new').toLowerCase();

  // pagination knobs
  const limitParam = Number(req.query.limit);
  const pageParam  = Number(req.query.page);
  const cursorParam = Number(req.query.cursor || req.query.before || req.query.before_id);

  // Cap limit to 75 as required
  let limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(75, limitParam)) : 75;
  const hasCursor = Number.isFinite(cursorParam) && cursorParam > 0;
  const hasPage = !hasCursor && Number.isFinite(pageParam) && pageParam > 0;
  const page = hasPage ? pageParam : 1;
  const offset = hasPage ? (page - 1) * limit : 0;

  // Field sets
  const FIELDS_PUBLIC = `
    l.id, l.user_id, ${noimg ? '' : 'l.image_data,'}
    l.title, l.description, l.location, l.price, l.created_at,
    u.username as owner_username
  `;
  const FIELDS_MINE = `
    l.id, l.user_id, ${noimg ? '' : 'l.image_data,'}
    l.title, l.description, l.location, l.price, l.created_at,
    l.tags, l.lat, l.lon, l.enable_nearby, u.username as owner_username
  `;

  // Dynamic sort clause with tie-breaker (id DESC for stability)
  let orderSQL = 'ORDER BY l.id DESC';
  switch (sort) {
    case 'price_asc':
      orderSQL = 'ORDER BY l.price ASC, l.id DESC';
      break;
    case 'price_desc':
      orderSQL = 'ORDER BY l.price DESC, l.id DESC';
      break;
    case 'city':
      orderSQL = 'ORDER BY LOWER(l.location) ASC, l.id DESC';
      break;
    // default: 'new' (id DESC)
  }

  const itemsForUser = (userId, withPagination=false) => {
    // legacy: by default return full list for mine (no pagination)
    const fields = FIELDS_MINE;
    const where = ['l.user_id = @uid'];
    const params = { uid: userId };
    if (qRaw) {
      params.q = `%${qRaw}%`;
      where.push(`(LOWER(l.title) LIKE @q OR LOWER(l.description) LIKE @q OR LOWER(IFNULL(l.tags,'')) LIKE @q OR LOWER(l.location) LIKE @q)`);
    }

    // Fuzzy city filter
    let locClause = '';
    const locParams = {};
    if (locRaw) {
      const distinct = db.prepare('SELECT DISTINCT location FROM listings').all().map(r => r.location).filter(Boolean);
      const allCities = distinct.map(cityOf).filter(Boolean);
      const matches = pickMatchingCities(allCities, locRaw);
      if (matches.size === 0) {
        return withPagination
          ? { items: [], page: page, limit, has_more: false, next_cursor: null }
          : [];
      }
      const patterns = Array.from(matches).slice(0, 30).map((c, i) => {
        const k = `loc${i}`;
        locParams[k] = `${c}%`;
        return `l.location LIKE @${k}`;
      });
      locClause = '(' + patterns.join(' OR ') + ')';
      where.push(locClause);
    }

    const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    if (!withPagination) {
      const sql = `
        SELECT ${fields}
        FROM listings l
        JOIN users u ON u.id = l.user_id
        ${whereSQL}
        ${orderSQL}
      `;
      const rows = db.prepare(sql).all({ ...params, ...locParams });
      return rows.map(r => ({ ...r, tags: (r.tags ? String(r.tags).split(',') : []) }));
    }

    const lim = limit + 1; // lookahead
    const sql = `
      SELECT ${fields}
      FROM listings l
      JOIN users u ON u.id = l.user_id
      ${whereSQL}
      ${orderSQL}
      LIMIT @lim OFFSET @off
    `;
    const rows = db.prepare(sql).all({ ...params, ...locParams, lim, off: offset });
    const has_more = rows.length > limit;
    const items = has_more ? rows.slice(0, limit) : rows;
    const next_cursor = items.length ? items[items.length - 1].id : null;
    return { items: items.map(r => ({ ...r, tags: (r.tags ? String(r.tags).split(',') : []) })), page, limit, has_more, next_cursor };
  };

  // PUBLIC feed (not mine): always paginated for efficiency
  if (!mine) {
    const fields = FIELDS_PUBLIC.trim();
    const where = [];
    const params = {};
    if (qRaw) {
      params.q = `%${qRaw}%`;
      where.push(`(LOWER(l.title) LIKE @q OR LOWER(l.description) LIKE @q OR LOWER(IFNULL(l.tags,'')) LIKE @q OR LOWER(l.location) LIKE @q)`);
    }

    // Fuzzy city: compute candidate cities once, then filter via LIKE city%
    let locClause = '';
    const locParams = {};
    if (locRaw) {
      const distinct = db.prepare('SELECT DISTINCT location FROM listings').all().map(r => r.location).filter(Boolean);
      const allCities = distinct.map(cityOf).filter(Boolean);
      const matches = pickMatchingCities(allCities, locRaw);
      if (matches.size === 0) {
        return res.json({ items: [], page: page, limit, has_more: false, next_cursor: null });
      }
      const patterns = Array.from(matches).slice(0, 30).map((c, i) => {
        const k = `loc${i}`;
        locParams[k] = `${c}%`;
        return `l.location LIKE @${k}`;
      });
      locClause = '(' + patterns.join(' OR ') + ')';
      where.push(locClause);
    }

    if (hasCursor) {
      params.before = cursorParam;
      where.push('l.id < @before');
    }

    const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

    // LIMIT (+1 for has_more). Use offset only for page-mode (no cursor).
    const lim = limit + 1;
    const off = hasPage ? offset : 0;

    const sql = `
      SELECT ${fields}
      FROM listings l
      JOIN users u ON u.id = l.user_id
      ${whereSQL}
      ${orderSQL}
      LIMIT @lim ${hasPage ? 'OFFSET @off' : ''}
    `;

    const rows = db.prepare(sql).all({ ...params, ...locParams, lim, off });
    const has_more = rows.length > limit;
    const items = has_more ? rows.slice(0, limit) : rows;
    const next_cursor = items.length ? items[items.length - 1].id : null;

    return res.json({ items, page, limit, has_more, next_cursor });
  }

  // MINE
  const user = authFromReq(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  // Legacy behavior for profile: if no pagination params, return full array
  const wantsPagination = hasCursor || hasPage || Number.isFinite(limitParam);
  if (!wantsPagination) {
    const arr = itemsForUser(user.id, false);
    return res.json(arr);
  }

  const paged = itemsForUser(user.id, true);
  return res.json(paged);
});

/* Batch covers */
app.get('/api/listings/covers', (req, res) => {
  const idsStr = String(req.query.ids || '').trim();
  if (!idsStr) return res.json([]);
  let ids = idsStr.split(',').map(s => Number(s)).filter(Number.isFinite);
  ids = Array.from(new Set(ids)).slice(0, 200);
  if (!ids.length) return res.json([]);
  const placeholders = ids.map(()=>'?').join(',');
  // More robust: pick first by (position ASC, id ASC), else fall back to listings.image_data
  const rows = db.prepare(`
    SELECT l.id,
         COALESCE(
            (SELECT COALESCE(url, image_data)
             FROM listing_images
              WHERE listing_id = l.id
             ORDER BY
               CASE WHEN position IS NULL THEN 1 ELSE 0 END,
                 position ASC, id ASC
               LIMIT 1),
             l.image_data
           ) AS image_data
      FROM listings l
     WHERE l.id IN (${placeholders})
  `).all(...ids);
  res.json(rows);
});

app.post('/api/listings', auth, writeLimiter, (req, res) => {
  try {
    ensureListingColumns();

    const { images, image_data, title, description, location, price, tags, enable_nearby } = req.body || {};
    const imgs = Array.isArray(images) ? images : (image_data ? [image_data] : []);
    if (imgs.length) {
      const err = validateImages(imgs);
      if (err) return res.status(400).json({ error: err });
    }

    // Fields are optional: coerce strings, clamp length
    const descStr = String(description ?? '').slice(0,400);
    const locStr  = String(location ?? '').slice(0,80);

    // Default price to 0 if missing/invalid (allows free listings)
    const pNum = Number(price);
    const safePrice = (Number.isFinite(pNum) && pNum >= 0) ? pNum : 0;

    const cover = imgs.length ? imgs[0] : '';
    const tagStr = normalizeTags(tags);
    const safeTitle = shortTitle(title) || shortTitle(description);

    let lat = Number(req.body.lat);
    let lon = Number(req.body.lon);
    if (!Number.isFinite(lat)) lat = null;
    if (!Number.isFinite(lon)) lon = null;

    const enNearby = enable_nearby ? 1 : 0;

    const info = db.prepare(`
      INSERT INTO listings (user_id, image_data, title, description, location, price, created_at, tags, lat, lon, enable_nearby)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      cover,
      String(safeTitle),
      String(descStr),
      String(locStr),
      Number(safePrice),
      nowIso(),
      tagStr,
      lat, lon, enNearby
    );

    const listingId = info.lastInsertRowid;

    if (imgs.length) {
      const stmt = db.prepare('INSERT INTO listing_images (listing_id, image_data, position) VALUES (?, ?, ?)');
      imgs.forEach((img, i) => stmt.run(listingId, img, i));
    }

    const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
    return res.json(row);

  } catch (e) {
    const msg = String(e && e.message || e || 'db_error');
    console.error('Create listing failed:', msg);
    if (msg.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({ error: 'auth_stale', detail: 'Please log out and back in, then try again.' });
    }
    if (msg.includes('no column') || msg.includes('has no column named')) {
      return res.status(500).json({ error: 'schema_out_of_date', detail: msg });
    }
    if (msg.toLowerCase().includes('not null')) {
      return res.status(400).json({ error: 'db_constraint', detail: msg });
    }
    return res.status(500).json({ error: 'server_error', detail: msg });
  }
});

app.put('/api/listings/:id', auth, writeLimiter, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!req.user.is_admin && existing.user_id !== req.user.id) return res.status(403).json({ error: 'Not your listing' });

  const { images, image_data, title, description, location, price, tags } = req.body || {};
  if (images || image_data) {
    const imgs = Array.isArray(images) ? images : (image_data ? [image_data] : []);
    const err = validateImages(imgs);
    if (err) return res.status(400).json({ error: err });
    db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);
    const stmt = db.prepare('INSERT INTO listing_images (listing_id, image_data, position) VALUES (?, ?, ?)');
    imgs.forEach((img, i) => stmt.run(id, img, i));
    db.prepare('UPDATE listings SET image_data = ? WHERE id = ?').run(imgs[0], id);
  }

  // Allow empty strings; only check for undefined to decide whether to update
  const newTitle = (title !== undefined) ? shortTitle(title) : (existing.title || '');
  const newDesc  = (description !== undefined) ? String(description).slice(0,400) : existing.description;
  const newLoc   = (location !== undefined) ? String(location).slice(0,80) : existing.location;

  let newPrice;
  if (price !== undefined) {
    const p = Number(price);
    newPrice = (Number.isFinite(p) && p >= 0) ? p : 0; // allow $0; default to 0 if invalid
  } else {
    newPrice = existing.price;
  }

  let newLat = null, newLon = null;
  if (existing.lat == null && req.body.enable_nearby) {
    newLat = Number(req.body.lat);
    newLon = Number(req.body.lon);
    if (!Number.isFinite(newLat)) newLat = null;
    if (!Number.isFinite(newLon)) newLon = null;
  }

  db.prepare('UPDATE listings SET title=?, description=?, location=?, price=?, lat=COALESCE(?, lat), lon=COALESCE(?, lon) WHERE id=?')
    .run(newTitle, newDesc, newLoc, newPrice, newLat, newLon, id);

  if (typeof tags !== 'undefined') {
    const tagStr = normalizeTags(tags);
    db.prepare('UPDATE listings SET tags=? WHERE id=?').run(tagStr, id);
  }

  if (typeof req.body.enable_nearby !== 'undefined') {
    db.prepare('UPDATE listings SET enable_nearby=? WHERE id=?').run(req.body.enable_nearby ? 1 : 0, id);
  }

  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  res.json(row);
});

app.delete('/api/listings/:id', auth, writeLimiter, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!req.user.is_admin && existing.user_id !== req.user.id) return res.status(403).json({ error: 'Not your listing' });
  db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);
  db.prepare('DELETE FROM listings WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/listings/:id/images', (req, res) => {
  const id = Number(req.params.id);
  const rows = db.prepare('SELECT COALESCE(url, image_data) AS image FROM listing_images WHERE listing_id = ? ORDER BY position ASC, id ASC').all(id);
  res.json(rows.map(r => r.image));
});

/* ------------------------------------------------------------------ */
/* S3 presign + finalize                                              */
/* ------------------------------------------------------------------ */
app.post('/api/uploads/sign', auth, uploadLimiter, async (req, res) => {
  if (!presignUpload) return res.status(500).json({ error: 's3_module_not_loaded' });
  try {
    const { filename, contentType, bytes } = req.body || {};
    if (!contentType) return res.status(400).json({ error: 'contentType required' });
    const sig = await presignUpload({ filename, contentType, bytes });
    return res.json(sig);
  } catch (e) {
    console.error('[S3] sign error:', e);
    return res.status(400).json({ error: e.message || 'sign_failed' });
  }
});

app.post('/api/uploads/finalize', auth, uploadLimiter, (req, res) => {
  const { listingId, key, url, width, height, bytes } = req.body || {};
  if (!listingId || !key || !url) return res.status(400).json({ error: 'listingId, key, url required' });
  if (!isAllowedPublicUrl(url)) return res.status(400).json({ error: 'invalid_asset_url' });

  const lid = Number(listingId);
  const owner = db.prepare('SELECT user_id FROM listings WHERE id = ?').get(lid);
  if (!owner) return res.status(404).json({ error: 'Listing not found' });
  if (!req.user?.is_admin && owner.user_id !== req.user.id) return res.status(403).json({ error: 'Not your listing' });

  const pRow = db.prepare('SELECT MAX(position) AS maxp FROM listing_images WHERE listing_id = ?').get(lid);
  const pos = Number.isFinite(pRow?.maxp) ? (pRow.maxp + 1) : 0;

  db.prepare(`
    INSERT INTO listing_images (listing_id, image_data, position, key, url, width, height, bytes, created_at)
    VALUES (?, '', ?, ?, ?, ?, ?, ?, CAST(strftime('%s','now') AS INTEGER))
  `).run(lid, pos, String(key), String(url), width || null, height || null, bytes || null);

  db.prepare(`
    UPDATE listings
       SET image_data = COALESCE(NULLIF(image_data, ''), @url)
     WHERE id = @listingId
  `).run({ listingId: lid, url: String(url) });

  res.json({ ok: true, position: pos });
});

/* ------------------------------------------------------------------ */
/* AI Analysis                                                         */
/* ------------------------------------------------------------------ */
app.post('/api/ai/analyze', auth, writeLimiter, async (req, res) => {
  try {
    const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 3) : [];
    const hint = String(req.body.hint || '').slice(0, 200);
    if (!images.length) return res.status(400).json({ error: 'No images provided' });

    if (process.env.OPENAI_API_KEY && OpenAI) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const content = [];
      content.push({
        type: 'text',
        text: [
          'You are a listing assistant for a local marketplace.',
          'Analyze the item images and output STRICT JSON with:',
          '"title": concise <=80 chars, no emojis;',
          '"tags": array of 12-24 short, lowercase search terms;',
          '"price_usd": fair used-market price in USD as a number;',
          'Return ONLY JSON.'
        ].join('\n')
      });
      if (hint) content.push({ type: 'text', text: `User hint: ${hint}` });
      for (const img of images) content.push({ type: 'image_url', image_url: { url: img } });

      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' }
      });

      const txt = resp.choices?.[0]?.message?.content || '{}';
      let parsed = {};
      try { parsed = JSON.parse(txt); } catch {}
      let title = shortTitle(parsed.title || '');
      let tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      let priceNum = Number(parsed.price_usd);

      const tagStr = normalizeTags(tags);
      const outTags = tagStr ? tagStr.split(',') : [];
      if (!title) title = 'Item for sale';

      let suggested_price;
      if (!Number.isNaN(priceNum)) {
        priceNum = Math.min(Math.max(priceNum, 1), 100000);
        suggested_price = Math.round(priceNum * 100) / 100;
      }

      if (outTags.length < 8) {
        const extra = fallbackTagsFromTitleDesc(title, hint);
        const merged = normalizeTags([...outTags, ...extra]).split(',').filter(Boolean).slice(0,20);
        return res.json({ title, tags: merged, suggested_price });
      }

      return res.json({ title, tags: outTags.slice(0, 24), suggested_price });
    }

    const title = shortTitle(hint || 'Item for sale');
    const tags = normalizeTags(fallbackTagsFromTitleDesc(title, hint)).split(',').filter(Boolean);
    return res.json({ title, tags: tags.slice(0, 20) });
  } catch (e) {
    console.error('AI analyze failed:', e);
    return res.status(500).json({ error: 'AI analysis failed' });
  }
});

/* ------------------------------------------------------------------ */
/* Conversations & messages (with images)                              */
/* ------------------------------------------------------------------ */
function isMember(convo, uid){ return convo && (convo.a_user_id === uid || convo.b_user_id === uid); }

app.post('/api/conversations', auth, writeLimiter, (req, res) => {
  let { with_user_id, listing_id } = req.body || {};
  if (!with_user_id && !listing_id) return res.status(400).json({ error: 'with_user_id or listing_id required' });
  if (listing_id) {
    const lst = db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(listing_id));
    if (!lst) return res.status(404).json({ error: 'Listing not found' });
    if (!with_user_id) with_user_id = lst.user_id;
  }
  with_user_id = Number(with_user_id);
  if (with_user_id === req.user.id) return res.status(400).json({ error: 'Cannot message yourself' });

  const { a, b } = normalizePair(req.user.id, with_user_id);
  try {
    const info = db.prepare('INSERT INTO conversations (a_user_id, b_user_id, listing_id, created_at) VALUES (?, ?, ?, ?)').run(a, b, listing_id || null, nowIso());
    return res.json({ id: info.lastInsertRowid, a_user_id: a, b_user_id: b, listing_id: listing_id || null });
  } catch {
    const row = db.prepare('SELECT * FROM conversations WHERE a_user_id=? AND b_user_id=? AND listing_id IS ?').get(a, b, listing_id || null);
    return res.json(row);
  }
});

app.get('/api/conversations', auth, (req, res) => {
  const me = req.user.id;

  const rows = db.prepare(`
    SELECT
      c.id,
      c.listing_id,
      CASE WHEN c.a_user_id = @me THEN c.b_user_id ELSE c.a_user_id END AS other_user_id,
      u.username AS other_user_username,
      COALESCE(l.title, '') AS listing_title,
      l.user_id AS listing_owner_id,
      (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_at,
      (SELECT body       FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_body,
      (SELECT sender_id  FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_sender_id,
      (SELECT id         FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_id
    FROM conversations c
    JOIN users u
      ON u.id = CASE WHEN c.a_user_id = @me THEN c.b_user_id ELSE c.a_user_id END
    LEFT JOIN listings l
      ON l.id = c.listing_id
    WHERE c.a_user_id = @me OR c.b_user_id = @me
    ORDER BY c.id DESC
  `).all({ me });

  res.json(rows);
});

app.get('/api/conversations/:id/messages', auth, (req, res) => {
  const id = Number(req.params.id);
  const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!convo) return res.status(404).json({ error: 'Not found' });
  if (!isMember(convo, req.user.id)) return res.status(403).json({ error: 'Forbidden' });

  const msgs = db.prepare(`
    SELECT m.*, u.username AS sender_username
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.id ASC
  `).all(id);

  const getImgs = db.prepare('SELECT COALESCE(url, image_data) AS image_data FROM message_images WHERE message_id = ? ORDER BY position ASC');
  const out = msgs.map(m => ({ ...m, images: getImgs.all(m.id).map(r => r.image_data) }));

  res.json(out);
});

app.post('/api/conversations/:id/messages', auth, writeLimiter, (req, res) => {
  const id = Number(req.params.id);
  const { body, images } = req.body || {};

  if ((!body || !String(body).trim()) && (!Array.isArray(images) || images.length === 0)) {
    return res.status(400).json({ error: 'Message body or image required' });
  }

  const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!convo) return res.status(404).json({ error: 'Not found' });
  if (!isMember(convo, req.user.id)) return res.status(403).json({ error: 'Forbidden' });

  const err = validateMsgImages(images);
  if (err) return res.status(400).json({ error: err });

  const info = db.prepare(
    'INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, req.user.id, String(body || '').slice(0,2000), nowIso());

  const msgId = info.lastInsertRowid;

  // IMPORTANT FIX: satisfy NOT NULL on image_data by inserting '' for URL rows
  if (Array.isArray(images) && images.length) {
    const stmt = db.prepare(`
      INSERT INTO message_images (message_id, position, image_data, url)
      VALUES (?, ?, ?, ?)
    `);

    images.forEach((img, i) => {
      if (typeof img !== 'string') return;
      if (img.startsWith('data:image/')) {
        stmt.run(msgId, i, img, null);
      } else if (img.startsWith('https://') && isAllowedPublicUrl(img)) {
        stmt.run(msgId, i, '', img);   // insert empty string instead of NULL
      }
    });
  }

  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  const imgs = db.prepare('SELECT COALESCE(url, image_data) AS image_data FROM message_images WHERE message_id = ? ORDER BY position ASC').all(msgId).map(r => r.image_data);
  res.json({ ...row, images: imgs });
});

app.delete('/api/conversations/:id', auth, writeLimiter, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });

  const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!convo) return res.status(404).json({ error: 'Not found' });

  const isMem = (req.user?.id === convo.a_user_id) || (req.user?.id === convo.b_user_id) || !!req.user?.is_admin;
  if (!isMem) return res.status(403).json({ error: 'Forbidden' });

  db.prepare(`
    DELETE FROM message_images
      WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)
  `).run(id);
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);

  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Reverse geocoding proxy                                            */
/* ------------------------------------------------------------------ */
const geoCache = new Map();
app.get('/api/geo/reverse', geocodeLimiter, async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'lat/lon required' });
    }
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (geoCache.has(key)) return res.json(geoCache.get(key));

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'ListIt/1.0 (reverse-geocode)' }});
    if (!resp.ok) return res.status(502).json({ error: 'geocode_failed' });
    const data = await resp.json();

    const a = data.address || {};
    const city = a.city || a.town || a.village || a.hamlet || '';
    const state = a.state || a.region || '';
    const country = a.country || (a.country_code ? a.country_code.toUpperCase() : '');
    const display = [city, state || country].filter(Boolean).join(', ') || data.display_name || key;

    const out = { city, state, country, display, lat, lon };
    geoCache.set(key, out);
    res.json(out);
  } catch (e) {
    console.error('reverse geocode error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ------------------------------------------------------------------ */
/* Nearby listings endpoint                                           */
/* ------------------------------------------------------------------ */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

app.get('/api/listings/nearby', (req, res) => {
  const lat0 = Number(req.query.lat);
  const lon0 = Number(req.query.lon);
  let radius = Number(req.query.radius_m);
  if (!Number.isFinite(radius) || radius <= 0) radius = 150;
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) {
    return res.status(400).json({ error: 'lat/lon required' });
  }

  const degLat = radius / 111320;
  const degLon = radius / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const minLat = lat0 - degLat, maxLat = lat0 + degLat;
  const minLon = lon0 - degLon, maxLon = lon0 + degLon;

  const rows = db.prepare(`
    SELECT l.id, l.user_id, l.image_data, l.title, l.description, l.location,
           l.price, l.created_at, l.lat, l.lon,
           u.username as owner_username
    FROM listings l
    JOIN users u ON u.id = l.user_id
    WHERE l.enable_nearby = 1
      AND l.lat IS NOT NULL AND l.lon IS NOT NULL
      AND l.lat BETWEEN @minLat AND @maxLat
      AND l.lon BETWEEN @minLon AND @maxLon
    ORDER BY l.id DESC
  `).all({ minLat, maxLat, minLon, maxLon });

  const out = [];
  for (const r of rows) {
    const d = haversineMeters(lat0, lon0, r.lat, r.lon);
    if (d <= radius) out.push({ ...r, distance_m: Math.round(d) });
  }
  out.sort((a,b)=> (a.distance_m||1e12) - (b.distance_m||1e12));
  res.json(out);
});

/* ------------------------------------------------------------------ */
/* Admin endpoints                                                     */
/* ------------------------------------------------------------------ */
app.delete('/api/admin/listings/:id', auth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);
  const info = db.prepare('DELETE FROM listings WHERE id = ?').run(id);
  res.json({ ok: true, deleted: info.changes });
});

app.delete('/api/admin/listings', auth, requireAdmin, (_req, res) => {
  db.exec('DELETE FROM listing_images; DELETE FROM listings;');
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'server_error' });
});

/* ------------------------------------------------------------------ */
if (require.main === module) {
  app.listen(PORT, () => console.log(`ListIt running at http://localhost:${PORT}`));
}
module.exports = app;
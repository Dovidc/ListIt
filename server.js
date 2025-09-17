/* server.js — ListIt (PostgreSQL-ready with S3-only image storage) */



const express = require('express');

const fs = require('fs');

const path = require('path');

const db = require('./db-wrapper');

const bcrypt = require('bcryptjs');

const cookieParser = require('cookie-parser');

const jwt = require('jsonwebtoken');



let cors; try { cors = require('cors'); } catch {}

let compression; try { compression = require('compression'); } catch {}

let helmet; try { helmet = require('helmet'); } catch {}

let rateLimit; try { rateLimit = require('express-rate-limit'); } catch {}

let OpenAI; try { OpenAI = require('openai'); } catch {}



const app = express();

app.disable('x-powered-by');

app.set('trust proxy', 1);



const http = require('http');

const WebSocket = require('ws');

const server = http.createServer(app);

const wss = new WebSocket.Server({ 

  server,

  path: '/ws'  // Add explicit path for clarity

});



wss.on('error', (error) => {

  console.error('WebSocket Server Error:', error);

});



server.on('upgrade', (request, socket, head) => {

  console.log('WebSocket upgrade request received for:', request.url);

});



console.log('WebSocket server configured on path:', wss.options.path || '/');









// S3 presign module

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



const S3_BUCKET = (process.env.S3_BUCKET || '').trim();

const S3_REGION = (process.env.S3_REGION || '').trim();

const CDN_BASE = PUBLIC_ASSET_BASE ? PUBLIC_ASSET_BASE.replace(/\/+$/, '') : null;



function trimTrailingSlash(str) {

  return typeof str === 'string' ? str.replace(/\/+$/, '') : str;

}



const LEGACY_S3_PREFIXES = (() => {

  const prefixes = new Set();

  if (!S3_BUCKET) return [];

  if (S3_REGION) {

    prefixes.add(`https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`);

    prefixes.add(`https://s3.${S3_REGION}.amazonaws.com/${S3_BUCKET}`);

  }

  prefixes.add(`https://${S3_BUCKET}.s3.amazonaws.com`);

  prefixes.add(`https://s3.amazonaws.com/${S3_BUCKET}`);

  return Array.from(prefixes).map(trimTrailingSlash);

})();



const ALLOWED_ASSET_PREFIXES = [

  ...(CDN_BASE ? [CDN_BASE] : []),

  ...LEGACY_S3_PREFIXES

];

if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev_jwt_change_me')) {

  console.error('FATAL: JWT_SECRET must be set to a strong value in production.');

  process.exit(1);

}



const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB || 20);

const B64_SLOP = 1.6;



const NEARBY_MAX_RADIUS_M = Number(process.env.NEARBY_MAX_RADIUS_M || 1609);

const NEARBY_RESULT_LIMIT = Number(process.env.NEARBY_RESULT_LIMIT || 120);

const NEARBY_CACHE_TTL_MS = Number(process.env.NEARBY_CACHE_TTL_MS || 20000);

const NEARBY_CACHE_MAX = Number(process.env.NEARBY_CACHE_MAX || 200);

const nearbyCache = new Map();

const ADMIN_REPORT_MIN = Math.max(1, Number(process.env.ADMIN_REPORT_MIN || 1));

function quantizeCoord(value, precision) {

  return Math.round(value * precision) / precision;

}

function makeNearbyCacheKey(lat, lon, radius) {

  const precision = 5000; // ~22m increments

  const latKey = quantizeCoord(lat, precision).toFixed(4);

  const lonKey = quantizeCoord(lon, precision).toFixed(4);

  const radiusBucket = Math.max(1, Math.round(radius / 25));

  return `${latKey}|${lonKey}|${radiusBucket}`;

}

function getNearbyCache(key) {

  const entry = nearbyCache.get(key);

  if (!entry) return null;

  if (Date.now() > entry.expires) {

    nearbyCache.delete(key);

    return null;

  }

  return entry.value;

}

function setNearbyCache(key, value) {

  nearbyCache.set(key, { value, expires: Date.now() + NEARBY_CACHE_TTL_MS });

  if (nearbyCache.size > NEARBY_CACHE_MAX) {

    const oldestKey = nearbyCache.keys().next().value;

    if (oldestKey) nearbyCache.delete(oldestKey);

  }

}

function invalidateNearbyCache() {

  if (nearbyCache.size) nearbyCache.clear();

}



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

/* CORS                                                                */

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

/* Security headers                                                    */

/* ------------------------------------------------------------------ */

if (helmet) {

  app.use(helmet({

    frameguard: { action: 'deny' },

    referrerPolicy: { policy: 'no-referrer' },

    crossOriginResourcePolicy: { policy: 'cross-origin' },

  }));



  app.use(helmet.contentSecurityPolicy({

    useDefaults: true,

    directives: {

      "default-src": ["'self'"],

      "img-src": ["'self'", "data:", "https:", "blob:"],

      "script-src": ["'self'", "https://unpkg.com"],

      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],

      "font-src": ["https://fonts.gstatic.com"],

      "connect-src": [

        "'self'", 

        "https://nominatim.openstreetmap.org", 

        "https:", 

        "wss:",

        // Add ws: for development WebSocket connections

        IS_PROD ? null : "ws:",

        // Optionally, be more specific for development

        IS_PROD ? null : "ws://localhost:*"

      ].filter(Boolean),

      "frame-ancestors": ["'none'"],

      "object-src": ["'none'"]

    }

  }));



  if (IS_PROD) app.use(helmet.hsts({ maxAge: 15552000 }));

}



/* ------------------------------------------------------------------ */

/* Compression + static                                               */

/* ------------------------------------------------------------------ */

if (compression) app.use(compression());

const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.static(PUBLIC_DIR, { maxAge: '7d', immutable: true }));



/* ------------------------------------------------------------------ */

/* CSRF Origin/Referer guard                                          */

/* ------------------------------------------------------------------ */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originGuard(req, res, next) {

  if (SAFE_METHODS.has(req.method)) return next();

  if (!FRONTEND_ORIGIN) return next();

  const origin = req.headers.origin || '';

  const referer = req.headers.referer || '';

  const ok = (origin && origin === FRONTEND_ORIGIN) || 

             (referer && referer.startsWith(FRONTEND_ORIGIN + '/'));

  if (!ok) return res.status(403).json({ error: 'bad_origin' });

  next();

}

app.use(originGuard);



/* ------------------------------------------------------------------ */

/* Schema initialization (async)                                       */

/* ------------------------------------------------------------------ */

async function initializeSchema() {

  try {

    // Create tables with PostgreSQL-compatible syntax

    await db.exec(`

      CREATE TABLE IF NOT EXISTS users (

        id SERIAL PRIMARY KEY,

        email TEXT UNIQUE NOT NULL,

        password_hash TEXT NOT NULL,

        created_at TEXT NOT NULL,

        username TEXT UNIQUE,

        is_admin INTEGER DEFAULT 0,

        paypal_email TEXT,

        account_status TEXT DEFAULT 'active',

        status_note TEXT,

        status_updated_at TEXT,

        last_login_at TEXT

      );

    `);

    try { await db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"); } catch {}

    try { await db.exec("UPDATE users SET is_admin = 0 WHERE is_admin IS NULL"); } catch {}

    try { await db.exec("ALTER TABLE users ADD COLUMN paypal_email TEXT"); } catch {}

    try { await db.exec("ALTER TABLE users ADD COLUMN account_status TEXT DEFAULT 'active'"); } catch {}

    try { await db.exec("ALTER TABLE users ADD COLUMN status_note TEXT"); } catch {}

    try { await db.exec("ALTER TABLE users ADD COLUMN status_updated_at TEXT"); } catch {}

    try { await db.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT"); } catch {}

    try { await db.exec("UPDATE users SET account_status = 'active' WHERE account_status IS NULL"); } catch {}





    await db.exec(`

      CREATE TABLE IF NOT EXISTS listings (

        id SERIAL PRIMARY KEY,

        user_id INTEGER NOT NULL REFERENCES users(id),

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

        sold INTEGER DEFAULT 0

      );

    `);



    try {

      await db.exec('ALTER TABLE listings ADD COLUMN sold INTEGER DEFAULT 0');

    } catch {}



    // Updated schema: image_data can be NULL since we're using S3

    await db.exec(`

      CREATE TABLE IF NOT EXISTS listing_images (

        id SERIAL PRIMARY KEY,

        listing_id INTEGER NOT NULL REFERENCES listings(id),

        image_data TEXT,

        position INTEGER NOT NULL,

        key TEXT,

        url TEXT,

        width INTEGER,

        height INTEGER,

        bytes INTEGER,

        created_at INTEGER DEFAULT 0

      );

    `);



    await db.exec(`

      CREATE TABLE IF NOT EXISTS conversations (

        id SERIAL PRIMARY KEY,

        a_user_id INTEGER NOT NULL,

        b_user_id INTEGER NOT NULL,

        listing_id INTEGER,

        created_at TEXT NOT NULL,

        UNIQUE (a_user_id, b_user_id, listing_id)

      );

    `);



    await db.exec(`

      CREATE TABLE IF NOT EXISTS messages (

        id SERIAL PRIMARY KEY,

        conversation_id INTEGER NOT NULL REFERENCES conversations(id),

        sender_id INTEGER NOT NULL,

        body TEXT NOT NULL,

        created_at TEXT NOT NULL

      );

    `);



    await db.exec(`

      CREATE TABLE IF NOT EXISTS message_images (

        id SERIAL PRIMARY KEY,

        message_id INTEGER NOT NULL REFERENCES messages(id),

        image_data TEXT,

        position INTEGER NOT NULL,

        key TEXT,

        url TEXT,

        width INTEGER,

        height INTEGER,

        bytes INTEGER,

        created_at INTEGER DEFAULT 0

      );

    `);



    await db.exec(`

      CREATE TABLE IF NOT EXISTS ads (

        id SERIAL PRIMARY KEY,

        title TEXT NOT NULL,

        subtitle TEXT,

        target_url TEXT NOT NULL,

        image_url TEXT,

        cta_label TEXT,

        background TEXT,

        is_active INTEGER DEFAULT 1,

        position INTEGER DEFAULT 0,

        created_at TEXT NOT NULL,

        updated_at TEXT NOT NULL

      );

    `);

    await db.exec('CREATE INDEX IF NOT EXISTS idx_ads_active ON ads(is_active, position DESC, id DESC);');





    await db.exec(`

      CREATE TABLE IF NOT EXISTS seller_reports (

        id SERIAL PRIMARY KEY,

        reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,

        reasons TEXT NOT NULL,

        details TEXT,

        captcha_question TEXT,

        created_at TEXT NOT NULL,

        status TEXT DEFAULT 'open',
        admin_note TEXT,
        resolved_at TEXT,
        resolved_by INTEGER REFERENCES users(id),
        resolved_note TEXT
      );

    `);

    await db.exec('CREATE INDEX IF NOT EXISTS idx_seller_reports_reported ON seller_reports(reported_user_id, status);');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_seller_reports_created ON seller_reports(created_at DESC);');
    try { await db.exec("ALTER TABLE seller_reports ADD COLUMN resolved_at TEXT"); } catch {}
    try { await db.exec("ALTER TABLE seller_reports ADD COLUMN resolved_by INTEGER"); } catch {}
    try { await db.exec("ALTER TABLE seller_reports ADD COLUMN resolved_note TEXT"); } catch {}

    await db.exec(`

      CREATE TABLE IF NOT EXISTS listing_cities (

        city TEXT PRIMARY KEY,

        slug TEXT UNIQUE,

        count INTEGER DEFAULT 0

      );

    `);

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listing_cities_slug ON listing_cities(slug);');



    const cityIndexCount = await db.prepare('SELECT COUNT(*) AS c FROM listing_cities').get();

    if (!Number.isFinite(cityIndexCount?.c) || cityIndexCount.c === 0) {

      const existingLocations = await db.prepare("SELECT location FROM listings WHERE location IS NOT NULL AND TRIM(location) <> ''").all();

      for (const row of existingLocations) {

        try { await incrementCityCount(row.location); } catch {}

      }

    }



    // Create indexes

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id, id);');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(id DESC);');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listings_lat_lon ON listings(lat, lon);');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listings_price_desc ON listings(price DESC, id DESC);');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listings_price_asc ON listings(price ASC, id DESC);');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listings_enable_nearby_lat_lon ON listings(enable_nearby, lat, lon, id DESC);');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listings_location_lower ON listings(LOWER(location));');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listings_sold ON listings(sold, id DESC);');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images(listing_id, position);');

    await db.exec('CREATE INDEX IF NOT EXISTS idx_msg_imgs_msg ON message_images(message_id, position);');



    console.log('Schema initialized');

  } catch (e) {

    console.error('Schema initialization failed:', e);

  }

}



/* ------------------------------------------------------------------ */

/* Utils                                                              */

/* ------------------------------------------------------------------ */

function nowIso() { return new Date().toISOString(); }

function normalizePair(u1, u2) {

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



function normLetters(s) { return String(s||'').toLowerCase().replace(/[^a-z]/g,''); }

function cityOf(location) { return String(location||'').split(',')[0].trim(); }

function normalizeCitySlug(city) {

  return normLetters(String(city || '').toLowerCase()).replace(/[^a-z0-9]/g, '');

}



function levenshtein(a,b) {

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



function pickMatchingCities(allCities, query) {

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



async function incrementCityCount(cityRaw) {

  const city = cityOf(cityRaw);

  const slug = normalizeCitySlug(city);

  if (!city || !slug) return;

  await db.prepare(`

    INSERT INTO listing_cities (city, slug, count)

    VALUES (?, ?, 1)

    ON CONFLICT(city)

    DO UPDATE SET count = listing_cities.count + 1, slug = excluded.slug

  `).run(city, slug);

}



async function decrementCityCount(cityRaw) {

  const city = cityOf(cityRaw);

  const slug = normalizeCitySlug(city);

  if (!city || !slug) return;

  await db.prepare('UPDATE listing_cities SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END WHERE city = ?').run(city);

  await db.prepare('DELETE FROM listing_cities WHERE city = ? AND count <= 0').run(city);

}



function startsWithAssetPrefix(url, prefix) {

  if (!url || !prefix) return false;

  if (!url.startsWith(prefix)) return false;

  const next = url.charAt(prefix.length);

  return next === '' || next === '/' || next === '?' || next === '#';

}



function canonicalAssetUrl(value) {

  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  if (!trimmed) return trimmed;

  if (trimmed.startsWith('data:')) return trimmed;

  if (CDN_BASE) {

    if (startsWithAssetPrefix(trimmed, CDN_BASE)) {

      return trimmed;

    }

    for (const prefix of LEGACY_S3_PREFIXES) {

      if (startsWithAssetPrefix(trimmed, prefix)) {

        const suffix = trimmed.slice(prefix.length);

        const normalizedSuffix = suffix && suffix.startsWith('/') ? suffix : (suffix ? '/' + suffix : '');

        return `${CDN_BASE}${normalizedSuffix}`;

      }

    }

    if (!/^https?:\/\//i.test(trimmed)) {

      const key = trimmed.replace(/^\/+/, '');

      return key ? `${CDN_BASE}/${key}` : CDN_BASE;

    }

  }

  return trimmed;

}



function assetVariants(value) {

  if (typeof value !== 'string') return [];

  const trimmed = value.trim();

  if (!trimmed) return [];

  const variants = new Set([trimmed]);

  const normalized = canonicalAssetUrl(trimmed);

  if (typeof normalized === 'string' && normalized) variants.add(normalized);

  if (CDN_BASE && typeof normalized === 'string' && normalized && normalized.startsWith(CDN_BASE)) {

    const suffix = normalized.slice(CDN_BASE.length);

    const normalizedSuffix = suffix && suffix.startsWith('/') ? suffix : (suffix ? '/' + suffix : '');

    for (const prefix of LEGACY_S3_PREFIXES) {

      variants.add(prefix + normalizedSuffix);

    }

  }

  return Array.from(variants);

}



function isAllowedPublicUrl(u) {

  if (typeof u !== 'string') return false;

  const trimmed = u.trim();

  if (!trimmed) return false;



  const normalized = canonicalAssetUrl(trimmed);

  const candidate = (typeof normalized === 'string' && normalized.length) ? normalized : trimmed;



  for (const prefix of ALLOWED_ASSET_PREFIXES) {

    if (startsWithAssetPrefix(candidate, prefix)) {

      return true;

    }

  }



  try {

    const parsed = new URL(candidate);

    return parsed.protocol === 'https:' &&

      (parsed.hostname.endsWith('.amazonaws.com') || parsed.hostname.endsWith('.cloudfront.net'));

  } catch {

    return false;

  }

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



function normalizeHttpUrl(input, { allowEmpty = false } = {}) {

  let str = (input ?? '').toString().trim();

  if (!str) {

    return allowEmpty ? '' : null;

  }

  if (!/^https?:\/\//i.test(str)) {

    str = `https://${str}`;

  }

  try {

    const url = new URL(str);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    return url.toString();

  } catch {

    return null;

  }

}



function formatAdRow(row) {

  if (!row) return null;

  return {

    id: row.id,

    title: row.title || '',

    subtitle: row.subtitle || '',

    target_url: row.target_url || '',

    image_url: canonicalAssetUrl(row.image_url || ''),

    cta_label: row.cta_label || '',

    background: row.background || '',

    is_active: row.is_active ? 1 : 0,

    position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,

    created_at: row.created_at || null,

    updated_at: row.updated_at || null

  };

}





/* ------------------------------------------------------------------ */

/* Auth helpers                                                        */

/* ------------------------------------------------------------------ */

function setAuthCookie(res, payload) {

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



function clearAuthCookie(res) {

  res.clearCookie('token', {

    httpOnly: true,

    sameSite: FRONTEND_ORIGIN ? 'none' : 'lax',

    secure: IS_PROD,

    domain: COOKIE_DOMAIN,

    path: '/'

  });

}



function authFromReq(req) {

  let t = req.cookies?.token;

  const hdr = req.headers?.authorization || '';

  if (!t && hdr.startsWith('Bearer ')) t = hdr.slice(7);

  if (!t) return null;

  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }

}



async function getUserWithStatus(userId) {

  if (!Number.isFinite(Number(userId))) return null;

  try {

    return await db.prepare(`

      SELECT id, email, username, is_admin,

             COALESCE(account_status, 'active') AS account_status,

             status_note,

             status_updated_at,

             created_at,

             last_login_at

        FROM users

       WHERE id = ?

    `).get(Number(userId));

  } catch (err) {

    console.error('getUserWithStatus failed:', err);

    return null;

  }

}



function isLockedAccount(user) {

  return !!user && user.account_status === 'locked';

}



async function isAdminUserId(userId) {

  if (!Number.isFinite(Number(userId))) return false;

  try {

    const row = await db.prepare('SELECT is_admin FROM users WHERE id = ?').get(Number(userId));

    return !!(row && row.is_admin);

  } catch (err) {

    console.error('isAdminUserId failed:', err);

    return false;

  }

}



function respondLocked(res) {

  return res.status(423).json({ error: 'account_locked' });

}



async function auth(req, res, next) {

  const session = authFromReq(req);

  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {

    const row = await getUserWithStatus(session.id);

    if (!row) {

      clearAuthCookie(res);

      return res.status(401).json({ error: 'Not authenticated' });

    }



    if (row.account_status === 'banned') {

      clearAuthCookie(res);

      return res.status(403).json({ error: 'account_banned' });

    }



    req.user = {

      id: row.id,

      email: row.email,

      username: row.username,

      is_admin: !!row.is_admin,

      account_status: row.account_status,

      status_note: row.status_note,

      status_updated_at: row.status_updated_at,

      created_at: row.created_at,

      last_login_at: row.last_login_at

    };

    next();

  } catch (err) {

    console.error('Auth middleware failed:', err);

    return res.status(500).json({ error: 'auth_failed' });

  }

}



function requireAdmin(req, res, next) {

  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });

  next();

}



/* ------------------------------------------------------------------ */

/* Rate limiters                                                       */

/* ------------------------------------------------------------------ */

function mkLimiter(cfg) {

  return rateLimit ? rateLimit({ ...cfg, standardHeaders: true, legacyHeaders: false }) : (req,res,next)=>next();

}

const loginLimiter = mkLimiter({ windowMs: 15*60*1000, max: 20 });

const writeLimiter = mkLimiter({ windowMs: 60*1000, max: 60 });

const uploadLimiter = mkLimiter({ windowMs: 10*60*1000, max: 120 });

const geocodeLimiter = mkLimiter({ windowMs: 60*1000, max: 30 });



const REPORT_REASON_CODES = new Set([

  'fraud',

  'spam',

  'inappropriate',

  'harassment',

  'other'

]);



/* ------------------------------------------------------------------ */

/* Optional admin bootstrap                                           */

/* ------------------------------------------------------------------ */

async function maybeCreateAdmin() {

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

  const username = (process.env.ADMIN_USERNAME || '').trim();

  const password = process.env.ADMIN_PASSWORD || '';

  if (!email || !username || !password) return;

  

  try {

    const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);

    if (exists) { 

      console.log('Admin exists:', email); 

      return; 

    }

    const hash = await bcrypt.hash(password, 10);

    await db.prepare('INSERT INTO users (email, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, 1)')

      .run(email, username, hash, nowIso());

    console.log('Admin created:', email, 'username:', username);

  } catch (e) {

    console.error('Admin creation failed:', e);

  }

}

const userListingsLimiter = mkLimiter({ windowMs: 60*1000, max: 30 });

/* ------------------------------------------------------------------ */

/* Auth routes                                                         */

/* ------------------------------------------------------------------ */

app.post('/api/register', writeLimiter, async (req, res) => {

  try {

    const username = (req.body.username || req.body.name || '').trim();

    const email = (req.body.email || '').trim().toLowerCase();

    const password = req.body.password || '';

    

    if (!username || !email || !password) {

      return res.status(400).json({ error: 'Username, email, and password are required' });

    }

    if (username.length < 3 || username.length > 32) {

      return res.status(400).json({ error: 'Username must be 3–32 chars' });

    }

    if (password.length < 6) {

      return res.status(400).json({ error: 'Password must be at least 6 chars' });

    }



    const hash = await bcrypt.hash(password, 10);

    const createdAt = nowIso();

    const info = await db.prepare('INSERT INTO users (email, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, 0)')

      .run(email, username, hash, createdAt);

    

    const user = {

      id: info.lastInsertRowid,

      email,

      username,

      is_admin: false,

      account_status: 'active',

      created_at: createdAt,

      status_note: null,

      status_updated_at: null,

      last_login_at: null

    };

    const token = setAuthCookie(res, { id: user.id, email: user.email, username: user.username, is_admin: false, account_status: 'active' });

    return res.json({ ...user, token });

  } catch (e) {

    const msg = String(e);

    if (msg.includes('users.email')) return res.status(409).json({ error: 'Email already registered' });

    if (msg.includes('users.username')) return res.status(409).json({ error: 'Username already taken' });

    console.error(e);

    return res.status(500).json({ error: 'Registration failed' });

  }

});



app.post('/api/login', loginLimiter, async (req, res) => {

  try {

    const email = (req.body.email || '').trim().toLowerCase();

    const password = req.body.password || '';

    

    if (!email || !password) {

      return res.status(400).json({ error: 'Email and password required' });

    }

    

    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!row || !row.password_hash) {

      return res.status(401).json({ error: 'Invalid credentials' });

    }



    const ok = await bcrypt.compare(password, row.password_hash);

    if (!ok) {

      return res.status(401).json({ error: 'Invalid credentials' });

    }



    const accountStatus = row.account_status || 'active';

    if (accountStatus === 'banned') {

      clearAuthCookie(res);

      return res.status(403).json({ error: 'account_banned' });

    }



    const now = nowIso();

    try {

      await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);

    } catch (err) {

      console.error('Failed to update last_login_at:', err);

    }



    const user = {

      id: row.id,

      email: row.email,

      username: row.username,

      is_admin: !!row.is_admin,

      account_status: accountStatus,

      created_at: row.created_at,

      status_note: row.status_note,

      status_updated_at: row.status_updated_at,

      last_login_at: now

    };

    const token = setAuthCookie(res, { id: user.id, email: user.email, username: user.username, is_admin: user.is_admin, account_status: accountStatus });

    return res.json({ ...user, token });

  } catch (e) {

    console.error('Login error:', e);

    return res.status(401).json({ error: 'Invalid credentials' });

  }

});



app.post('/api/logout', (_req, res) => {

  clearAuthCookie(res);

  return res.json({ ok: true });

});



app.get('/api/me', async (req, res) => {

  try {

    const u = authFromReq(req);

    if (!u) return res.json(null);



    const row = await db.prepare(`

      SELECT id, email, username, is_admin,

             COALESCE(paypal_email, '') AS paypal_email,

             created_at,

             COALESCE(account_status, 'active') AS account_status,

             status_note,

             status_updated_at,

             last_login_at

      FROM users

      WHERE id = ?

    `).get(u.id);



    if (!row) return res.json(null);

    

    return res.json({

      id: row.id,

      email: row.email,

      username: row.username,

      is_admin: !!row.is_admin,

      paypal_email: row.paypal_email,

      account_status: row.account_status,

      status_note: row.status_note,

      status_updated_at: row.status_updated_at,

      created_at: row.created_at,

      last_login_at: row.last_login_at

    });

  } catch (e) {

    console.error('GET /api/me failed:', e);

    return res.status(500).json({ error: 'me_failed' });

  }

});



app.put('/api/me/paypal', auth, writeLimiter, async (req, res) => {

  try {

    const email = String(req.body?.paypal_email || '').trim().toLowerCase();

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {

      return res.status(400).json({ error: 'Invalid email' });

    }

    await db.prepare('UPDATE users SET paypal_email = ? WHERE id = ?').run(email || null, req.user.id);

    return res.json({ ok: true, paypal_email: email || '' });

  } catch (e) {

    console.error('Update PayPal failed:', e);

    return res.status(500).json({ error: 'update_failed' });

  }

});



/* ------------------------------------------------------------------ */

/* Listings                                                            */

/* ------------------------------------------------------------------ */

app.get('/api/listings', async (req, res) => {

  try {

    const qRaw = (req.query.q || '').toString().trim().toLowerCase();

    const locRaw = (req.query.loc || '').toString().trim();

    const mine = req.query.mine === '1';

    const noimg = req.query.noimg === '1';

    const sort = String(req.query.sort || 'new').toLowerCase();



    const limitParam = Number(req.query.limit);

    const pageParam = Number(req.query.page);

    const cursorParam = Number(req.query.cursor || req.query.before || req.query.before_id);



    let limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(75, limitParam)) : 75;

    const hasCursor = Number.isFinite(cursorParam) && cursorParam > 0;

    const hasPage = !hasCursor && Number.isFinite(pageParam) && pageParam > 0;

    const page = hasPage ? pageParam : 1;

    const offset = hasPage ? (page - 1) * limit : 0;



    const FIELDS_PUBLIC = `

      l.id, l.user_id, ${noimg ? '' : 'l.image_data,'}

      l.title, l.description, l.location, l.price, l.created_at,

      l.sold,

      u.username as owner_username

    `;

    const FIELDS_MINE = `

      l.id, l.user_id, ${noimg ? '' : 'l.image_data,'}

      l.title, l.description, l.location, l.price, l.created_at,

      l.tags, l.lat, l.lon, l.enable_nearby, l.sold, u.username as owner_username

    `;



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

    }



    const itemsForUser = async (userId, withPagination = false) => {

      const fields = FIELDS_MINE;

      const where = ['l.user_id = @uid'];

      const params = { uid: userId };

      

      if (qRaw) {

        params.q = `%${qRaw}%`;

        where.push(`(LOWER(l.title) LIKE @q OR LOWER(l.description) LIKE @q OR LOWER(COALESCE(l.tags,'')) LIKE @q OR LOWER(l.location) LIKE @q)`);

      }



      const locParams = {};

      if (locRaw) {

        const locCity = (cityOf(locRaw) || locRaw || '').toString().trim().toLowerCase();

        if (locCity && locCity !== 'no location') {

          locParams.loc = `${locCity.replace(/%/g, '')}%`;

          where.push('LOWER(l.location) LIKE @loc');

        }

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

        const rows = await db.prepare(sql).all({ ...params, ...locParams });

        return rows.map(r => {

          const out = { ...r, tags: (r.tags ? String(r.tags).split(',') : []) };

          out.image_data = canonicalAssetUrl(out.image_data);

          return out;

        });

      }



      const lim = limit + 1;

      const sql = `

        SELECT ${fields}

        FROM listings l

        JOIN users u ON u.id = l.user_id

        ${whereSQL}

        ${orderSQL}

        LIMIT @lim OFFSET @off

      `;

      const rows = await db.prepare(sql).all({ ...params, ...locParams, lim, off: offset });

      const has_more = rows.length > limit;

      const items = has_more ? rows.slice(0, limit) : rows;

      const next_cursor = items.length ? items[items.length - 1].id : null;

      return { 

        items: items.map(r => {

          const out = { ...r, tags: (r.tags ? String(r.tags).split(',') : []) };

          out.image_data = canonicalAssetUrl(out.image_data);

          return out;

        }), 

        page, 

        limit, 

        has_more, 

        next_cursor 

      };

    };



    if (!mine) {

      const fields = FIELDS_PUBLIC.trim();

      const where = ['l.sold = 0'];

      const params = {};

      

      if (qRaw) {

        params.q = `%${qRaw}%`;

        where.push(`(LOWER(l.title) LIKE @q OR LOWER(l.description) LIKE @q OR LOWER(COALESCE(l.tags,'')) LIKE @q OR LOWER(l.location) LIKE @q)`);

      }



      const locParams = {};

      if (locRaw) {

        const locCity = (cityOf(locRaw) || locRaw || '').toString().trim().toLowerCase();

        if (locCity && locCity !== 'no location') {

          locParams.loc = `${locCity.replace(/%/g, '')}%`;

          where.push('LOWER(l.location) LIKE @loc');

        }

      }



      if (hasCursor) {

        params.before = cursorParam;

        where.push('l.id < @before');

      }



      const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

      const lim = limit + 1;



      const sql = `

        SELECT ${fields}

        FROM listings l

        JOIN users u ON u.id = l.user_id

        ${whereSQL}

        ${orderSQL}

        LIMIT @lim

      `;



      const rows = await db.prepare(sql).all({ ...params, ...locParams, lim });

      const has_more = rows.length > limit;

      const items = has_more ? rows.slice(0, limit) : rows;

      const next_cursor = items.length ? items[items.length - 1].id : null;

      const normalizedItems = items.map(r => {

        const out = { ...r };

        if (Object.prototype.hasOwnProperty.call(out, 'image_data')) {

          out.image_data = canonicalAssetUrl(out.image_data);

        }

        return out;

      });



      return res.json({ items: normalizedItems, page, limit, has_more, next_cursor });

    }



    const session = authFromReq(req);

    if (!session) return res.status(401).json({ error: 'Not authenticated' });



    const userRow = await getUserWithStatus(session.id);

    if (!userRow) {

      clearAuthCookie(res);

      return res.status(401).json({ error: 'Not authenticated' });

    }

    if (userRow.account_status === 'banned') {

      clearAuthCookie(res);

      return res.status(403).json({ error: 'account_banned' });

    }

    if (userRow.account_status === 'locked') {

      return res.status(423).json({ error: 'account_locked' });

    }



    const wantsPagination = hasCursor || hasPage || Number.isFinite(limitParam);

    if (!wantsPagination) {

      const arr = await itemsForUser(userRow.id, false);

      return res.json(arr);

    }



    const paged = await itemsForUser(userRow.id, true);

    return res.json(paged);

  } catch (e) {

    console.error('GET /api/listings failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.get('/api/listings/covers', async (req, res) => {

  try {

    const idsStr = String(req.query.ids || '').trim();

    if (!idsStr) return res.json([]);

    

    let ids = idsStr.split(',').map(s => Number(s)).filter(Number.isFinite);

    ids = Array.from(new Set(ids)).slice(0, 200);

    if (!ids.length) return res.json([]);

    

    const placeholders = ids.map(()=>'?').join(',');

    const rows = await db.prepare(`

      SELECT l.id,

           COALESCE(

              (SELECT COALESCE(url, image_data)

               FROM listing_images

                WHERE listing_id = l.id

                  AND url IS NOT NULL

               ORDER BY position ASC, id ASC

                 LIMIT 1),

               l.image_data

             ) AS image_data

        FROM listings l

       WHERE l.id IN (${placeholders})

    `).all(...ids);

    

    const normalized = rows.map(row => ({

      ...row,

      image_data: canonicalAssetUrl(row.image_data)

    }));



    res.json(normalized);

  } catch (e) {

    console.error('GET /api/listings/covers failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }app.post('/api/reports', auth, writeLimiter, async (req, res) => {

  try {

    const reporterId = req.user.id;

    const reportedRaw = req.body?.reported_user_id ?? req.body?.reportedUserId;

    const reportedUserId = Number(reportedRaw);

    const listingRaw = req.body?.listing_id ?? req.body?.listingId;

    const listingId = listingRaw === undefined || listingRaw === null || listingRaw === '' ? null : Number(listingRaw);

    let reasons = req.body?.reasons;

    if (!Array.isArray(reasons)) reasons = [];



    const normalizedReasons = [];

    const seen = new Set();

    for (const code of reasons) {

      if (normalizedReasons.length >= 5) break;

      const val = String(code || '').toLowerCase().trim();

      if (!val) continue;

      if (!REPORT_REASON_CODES.has(val)) continue;

      if (seen.has(val)) continue;

      normalizedReasons.push(val);

      seen.add(val);

    }



    if (!Number.isFinite(reportedUserId) || reportedUserId <= 0) {

      return res.status(400).json({ error: 'invalid_reported_user' });

    }

    if (reportedUserId === reporterId) {

      return res.status(400).json({ error: 'cannot_report_self' });

    }

    if (!normalizedReasons.length) {

      return res.status(400).json({ error: 'invalid_reasons' });

    }



    const detailsRaw = (req.body?.details || '').toString().trim();

    const details = detailsRaw ? detailsRaw.slice(0, 500) : null;



    const captcha = req.body?.captcha || {};

    const a = Number(captcha?.a);

    const b = Number(captcha?.b);

    const answer = Number(captcha?.answer);

    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(answer) || a + b !== answer) {

      return res.status(400).json({ error: 'captcha_invalid' });

    }

    const captchaQuestion = `${a}+${b}`;



    const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(reportedUserId);

    if (!target) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    let finalListingId = null;

    if (listingId !== null) {

      if (!Number.isFinite(listingId) || listingId <= 0) {

        return res.status(400).json({ error: 'invalid_listing' });

      }

      const listing = await db.prepare('SELECT id, user_id FROM listings WHERE id = ?').get(listingId);

      if (!listing) {

        return res.status(404).json({ error: 'listing_not_found' });

      }

      if (listing.user_id !== reportedUserId) {

        return res.status(400).json({ error: 'listing_owner_mismatch' });

      }

      finalListingId = listing.id;

    }



    await db.prepare(`

      INSERT INTO seller_reports (reporter_user_id, reported_user_id, listing_id, reasons, details, captcha_question, created_at)

      VALUES (?, ?, ?, ?, ?, ?, ?)

    `).run(

      reporterId,

      reportedUserId,

      finalListingId,

      JSON.stringify(normalizedReasons),

      details || null,

      captchaQuestion,

      nowIso()

    );



    return res.json({ ok: true });

  } catch (e) {

    console.error('Submit report failed:', e);

    return res.status(500).json({ error: 'report_failed' });

  }

});





});



app.post('/api/listings', auth, writeLimiter, async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

    const { title, description, location, price, tags, enable_nearby } = req.body || {};

    

    // Since we're using S3 only, we don't handle images here

    // Images will be uploaded separately via /api/uploads/sign and /api/uploads/finalize

    

    const descStr = String(description ?? '').slice(0,400);

    const locStr = String(location ?? '').slice(0,80);

    const pNum = Number(price);

    const safePrice = (Number.isFinite(pNum) && pNum >= 0) ? pNum : 0;

    const tagStr = normalizeTags(tags);

    const safeTitle = shortTitle(title) || shortTitle(description);



    let lat = Number(req.body.lat);

    let lon = Number(req.body.lon);

    if (!Number.isFinite(lat)) lat = null;

    if (!Number.isFinite(lon)) lon = null;



    const enNearby = enable_nearby ? 1 : 0;



    const info = await db.prepare(`

      INSERT INTO listings (user_id, image_data, title, description, location, price, created_at, tags, lat, lon, enable_nearby)

      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    `).run(

      req.user.id,

      null, // No cover image initially since S3 uploads happen separately

      String(safeTitle),

      String(descStr),

      String(locStr),

      Number(safePrice),

      nowIso(),

      tagStr,

      lat, lon, enNearby

    );



    const listingId = info.lastInsertRowid;



    try { await incrementCityCount(locStr); } catch {}



    // NOTE: Images are NOT inserted here anymore - they come via S3 upload flow

    

    const row = await db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);

    if (row && Object.prototype.hasOwnProperty.call(row, 'image_data')) {

      row.image_data = canonicalAssetUrl(row.image_data);

    }

    invalidateNearbyCache();

    return res.json(row);

  } catch (e) {

    const msg = String(e && e.message || e || 'db_error');

    console.error('Create listing failed:', msg);

    return res.status(500).json({ error: 'server_error', detail: msg });

  }

});



/* ------------------------------------------------------------------ */

/* Get listings by specific user                                      */

/* ------------------------------------------------------------------ */

app.get('/api/users/:userId/listings', userListingsLimiter, async (req, res) => {

  try {

    const userId = Number(req.params.userId);

    if (!Number.isFinite(userId)) {

      return res.status(400).json({ error: 'Invalid user ID' });

    }



    // Check if user exists

    const userExists = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);

    if (!userExists) {

      return res.status(404).json({ error: 'User not found' });

    }



    // Get all public listings for this user

    const rows = await db.prepare(`

      SELECT 

        l.id, l.user_id, l.image_data,

        l.title, l.description, l.location, l.price, l.created_at,

        l.sold,

        u.username as owner_username

      FROM listings l

      JOIN users u ON u.id = l.user_id

      WHERE l.user_id = ?

      ORDER BY l.id DESC

    `).all(userId);



    const normalized = rows.map(row => ({

      ...row,

      image_data: canonicalAssetUrl(row.image_data)

    }));



    return res.json(normalized);

  } catch (e) {

    console.error('GET /api/users/:userId/listings failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});





app.put('/api/listings/:id', auth, writeLimiter, async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

    const id = Number(req.params.id);

    const existing = await db.prepare('SELECT * FROM listings WHERE id = ?').get(id);

    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (!req.user.is_admin && existing.user_id !== req.user.id) {

      return res.status(403).json({ error: 'Not your listing' });

    }



    const { title, description, location, price, tags, deletedImages } = req.body || {};

    

    // Handle image deletions

    if (Array.isArray(deletedImages) && deletedImages.length > 0) {

      for (const imageUrl of deletedImages) {

        const raw = String(imageUrl ?? '').trim();

        const variants = assetVariants(raw);

        const pool = variants.length ? variants : (raw ? [raw] : []);

        for (const variant of pool) {

          if (!variant) continue;

          await db.prepare('DELETE FROM listing_images WHERE listing_id = ? AND (url = ? OR image_data = ?)')

            .run(id, variant, variant);

        }

      }

      

      // Re-index remaining images

      const remaining = await db.prepare('SELECT id FROM listing_images WHERE listing_id = ? ORDER BY position, id')

        .all(id);

      for (let i = 0; i < remaining.length; i++) {

        await db.prepare('UPDATE listing_images SET position = ? WHERE id = ?')

          .run(i, remaining[i].id);

      }

      

      // Update listing cover if needed

      const firstImage = await db.prepare('SELECT url, image_data FROM listing_images WHERE listing_id = ? ORDER BY position LIMIT 1')

        .get(id);

      if (firstImage) {

        const cover = canonicalAssetUrl(firstImage.url || firstImage.image_data);

        await db.prepare('UPDATE listings SET image_data = ? WHERE id = ?')

          .run(cover, id);

      } else {

        await db.prepare('UPDATE listings SET image_data = NULL WHERE id = ?')

          .run(id);

      }

    }



    const newTitle = (title !== undefined) ? shortTitle(title) : (existing.title || '');

    const newDesc = (description !== undefined) ? String(description).slice(0,400) : existing.description;

    const newLoc = (location !== undefined) ? String(location).slice(0,80) : existing.location;



    let newPrice;

    if (price !== undefined) {

      const p = Number(price);

      newPrice = (Number.isFinite(p) && p >= 0) ? p : 0;

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



    await db.prepare('UPDATE listings SET title=?, description=?, location=?, price=?, lat=COALESCE(?, lat), lon=COALESCE(?, lon) WHERE id=?')

      .run(newTitle, newDesc, newLoc, newPrice, newLat, newLon, id);



    if (typeof tags !== 'undefined') {

      const tagStr = normalizeTags(tags);

      await db.prepare('UPDATE listings SET tags=? WHERE id=?').run(tagStr, id);

    }



    if (typeof req.body.enable_nearby !== 'undefined') {

      await db.prepare('UPDATE listings SET enable_nearby=? WHERE id=?').run(req.body.enable_nearby ? 1 : 0, id);

    }



    if (typeof req.body.sold !== 'undefined') {

      const soldVal = req.body.sold ? 1 : 0;

      await db.prepare('UPDATE listings SET sold=? WHERE id=?').run(soldVal, id);

    }



    const row = await db.prepare('SELECT * FROM listings WHERE id = ?').get(id);

    if (row && Object.prototype.hasOwnProperty.call(row, 'image_data')) {

      row.image_data = canonicalAssetUrl(row.image_data);

    }



    try {

      const prevCity = cityOf(existing.location);

      const nextCity = cityOf(newLoc);

      if (prevCity.toLowerCase() !== nextCity.toLowerCase()) {

        await decrementCityCount(existing.location);

        await incrementCityCount(newLoc);

      }

    } catch {}



    invalidateNearbyCache();

    res.json(row);

  } catch (e) {

    console.error('Update listing failed:', e);

    return res.status(500).json({ error: 'update_failed' });

  }

});



app.delete('/api/listings/:id', auth, writeLimiter, async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

    const id = Number(req.params.id);

    const existing = await db.prepare('SELECT * FROM listings WHERE id = ?').get(id);

    

    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (!req.user.is_admin && existing.user_id !== req.user.id) {

      return res.status(403).json({ error: 'Not your listing' });

    }

    

    await db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);

    await db.prepare('DELETE FROM listings WHERE id = ?').run(id);

    try { await decrementCityCount(existing.location); } catch {}

    invalidateNearbyCache();

    res.json({ ok: true });

  } catch (e) {

    console.error('Delete listing failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});



app.get('/api/listings/:id/images', async (req, res) => {

  try {

    const id = Number(req.params.id);

    const rows = await db.prepare(`

      SELECT COALESCE(url, image_data) AS image 

      FROM listing_images 

      WHERE listing_id = ? 

        AND (url IS NOT NULL OR image_data IS NOT NULL)

      ORDER BY position ASC, id ASC

    `).all(id);

    res.json(rows.map(r => canonicalAssetUrl(r.image)));

  } catch (e) {

    console.error('Get listing images failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.get('/api/listings/nearby', async (req, res) => {

  try {

    const lat0 = Number(req.query.lat);

    const lon0 = Number(req.query.lon);

    let radius = Number(req.query.radius_m);



    if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) {

      return res.status(400).json({ error: 'lat/lon required' });

    }

    if (!Number.isFinite(radius) || radius <= 0) radius = 150;

    radius = Math.max(50, Math.min(radius, NEARBY_MAX_RADIUS_M));



    const cacheKey = makeNearbyCacheKey(lat0, lon0, radius);

    const cached = getNearbyCache(cacheKey);

    if (cached) {

      res.set('X-Nearby-Cache', 'HIT');

      return res.json(cached);

    }



    const degLat = radius / 111320;

    const cosLat = Math.cos((lat0 * Math.PI) / 180);

    const safeCos = Math.max(Math.abs(cosLat), 1e-4);

    const degLon = radius / (111320 * safeCos);

    const minLat = lat0 - degLat, maxLat = lat0 + degLat;

    const minLon = lon0 - degLon, maxLon = lon0 + degLon;

    const lonScale = safeCos * safeCos;

    const preLimit = Math.min(NEARBY_RESULT_LIMIT * 2, 400);



    const rows = await db.prepare(`

      SELECT l.id, l.user_id, l.image_data, l.title, l.description, l.location,

             l.price, l.created_at, l.lat, l.lon,

             u.username as owner_username,

             ((l.lat - @lat0)*(l.lat - @lat0) + (l.lon - @lon0)*(l.lon - @lon0) * @lonScale) AS approx_dist_sq

      FROM listings l

      JOIN users u ON u.id = l.user_id

      WHERE l.enable_nearby = 1

        AND l.sold = 0

        AND l.lat IS NOT NULL AND l.lon IS NOT NULL

        AND l.lat BETWEEN @minLat AND @maxLat

        AND l.lon BETWEEN @minLon AND @maxLon

      ORDER BY approx_dist_sq ASC, l.id DESC

      LIMIT @limit

    `).all({ minLat, maxLat, minLon, maxLon, lat0, lon0, lonScale, limit: preLimit });



    const toRad = (d) => (d * Math.PI) / 180;

    const haversineMeters = (lat1, lon1, lat2, lon2) => {

      const R = 6371000;

      const dLat = toRad(lat2 - lat1);

      const dLon = toRad(lon2 - lon1);

      const a = Math.sin(dLat / 2) ** 2 +

                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *

                Math.sin(dLon / 2) ** 2;

      return 2 * R * Math.asin(Math.sqrt(a));

    };



    const out = [];

    for (const row of rows) {

      const d = haversineMeters(lat0, lon0, row.lat, row.lon);

      if (d <= radius) {

        const item = { ...row, distance_m: Math.round(d) };

        item.image_data = canonicalAssetUrl(item.image_data);

        out.push(item);

        if (out.length >= NEARBY_RESULT_LIMIT) break;

      }

    }



    setNearbyCache(cacheKey, out);

    res.set('X-Nearby-Cache', 'MISS');

    return res.json(out);

  } catch (e) {

    console.error('Nearby listings failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.get('/api/cities', async (req, res) => {

  try {

    const raw = String(req.query.q || '').trim();

    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 20);

    const slug = normalizeCitySlug(raw);

    const like = raw.toLowerCase().replace(/%/g, '') + '%';

    let rows;

    if (!raw) {

      rows = await db.prepare(`

        SELECT city, count

          FROM listing_cities

         ORDER BY count DESC, city ASC

         LIMIT @limit

      `).all({ limit });

    } else {

      rows = await db.prepare(`

        SELECT city, count

          FROM listing_cities

         WHERE (slug LIKE @slug || '%')

            OR (LOWER(city) LIKE @like)

         ORDER BY count DESC, city ASC

         LIMIT @limit

      `).all({ slug, like, limit });

    }

    res.json(rows.map(r => r.city));

  } catch (e) {

    console.error('City search failed:', e);

    res.status(500).json({ error: 'fetch_failed' });

  }

});



/* ------------------------------------------------------------------ */

/* S3 uploads                                                          */

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



app.post('/api/uploads/finalize', auth, uploadLimiter, async (req, res) => {

  try {

    const { listingId, key, url, width, height, bytes } = req.body || {};

    const rawUrl = typeof url === 'string' ? url : '';

    if (!listingId || !key || !rawUrl) {

      return res.status(400).json({ error: 'listingId, key, url required' });

    }

    if (!isAllowedPublicUrl(rawUrl)) {

      return res.status(400).json({ error: 'invalid_asset_url' });

    }

    const safeUrl = canonicalAssetUrl(rawUrl);



    const lid = Number(listingId);

    const owner = await db.prepare('SELECT user_id FROM listings WHERE id = ?').get(lid);

    if (!owner) return res.status(404).json({ error: 'Listing not found' });

    if (!req.user?.is_admin && owner.user_id !== req.user.id) {

      return res.status(403).json({ error: 'Not your listing' });

    }



    const pRow = await db.prepare('SELECT MAX(position) AS maxp FROM listing_images WHERE listing_id = ?').get(lid);

    const pos = Number.isFinite(pRow?.maxp) ? (pRow.maxp + 1) : 0;



    // Use NULL for image_data since we're using S3

    await db.prepare(`

      INSERT INTO listing_images (listing_id, image_data, position, key, url, width, height, bytes, created_at)

      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)

    `).run(lid, pos, String(key), safeUrl, width || null, height || null, bytes || null, Math.floor(Date.now() / 1000));



    // Update listing cover image if it doesn't have one

    await db.prepare(`

      UPDATE listings

         SET image_data = COALESCE(NULLIF(image_data, ''), @url)

       WHERE id = @listingId

    `).run({ listingId: lid, url: safeUrl });



    res.json({ ok: true, position: pos });

  } catch (e) {

    console.error('Finalize upload failed:', e);

    return res.status(500).json({ error: 'finalize_failed' });

  }

});



// New endpoint to delete a specific image

app.delete('/api/listings/:listingId/images/:imageId', auth, writeLimiter, async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

    const listingId = Number(req.params.listingId);

    const imageId = Number(req.params.imageId);

    

    const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').get(listingId);

    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    

    if (!req.user.is_admin && listing.user_id !== req.user.id) {

      return res.status(403).json({ error: 'Not your listing' });

    }

    

    await db.prepare('DELETE FROM listing_images WHERE id = ? AND listing_id = ?').run(imageId, listingId);

    

    // Update positions of remaining images

    await db.exec(`

      UPDATE listing_images 

      SET position = position - 1 

      WHERE listing_id = ${listingId} 

        AND position > (SELECT position FROM listing_images WHERE id = ${imageId})

    `);



    const firstImage = await db.prepare('SELECT url, image_data FROM listing_images WHERE listing_id = ? ORDER BY position LIMIT 1').get(listingId);

    if (firstImage) {

      const cover = canonicalAssetUrl(firstImage.url || firstImage.image_data);

      await db.prepare('UPDATE listings SET image_data = ? WHERE id = ?').run(cover, listingId);

    } else {

      await db.prepare('UPDATE listings SET image_data = NULL WHERE id = ?').run(listingId);

    }

    

    res.json({ ok: true });

  } catch (e) {

    console.error('Delete image failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});



/* ------------------------------------------------------------------ */

/* AI Analysis                                                         */

/* ------------------------------------------------------------------ */

app.post('/api/ai/analyze', auth, writeLimiter, async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

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

/* Conversations & Messages                                           */

/* ------------------------------------------------------------------ */

function isMember(convo, uid) { 

  return convo && (convo.a_user_id === uid || convo.b_user_id === uid); 

}



app.post('/api/conversations', auth, writeLimiter, async (req, res) => {

  try {

    let { with_user_id, listing_id } = req.body || {};

    if (!with_user_id && !listing_id) {

      return res.status(400).json({ error: 'with_user_id or listing_id required' });

    }

    

    if (listing_id) {

      const lst = await db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(listing_id));

      if (!lst) return res.status(404).json({ error: 'Listing not found' });

      if (!with_user_id) with_user_id = lst.user_id;

    }

    

    with_user_id = Number(with_user_id);

    if (!Number.isFinite(with_user_id)) {

      return res.status(400).json({ error: 'invalid_user' });

    }



    const target = await getUserWithStatus(with_user_id);

    if (!target) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    if (isLockedAccount(req.user) && !target.is_admin) {

      return respondLocked(res);

    }



    if (with_user_id === req.user.id) {

      return res.status(400).json({ error: 'Cannot message yourself' });

    }



    const { a, b } = normalizePair(req.user.id, with_user_id);



    const shareInbox = !!req.user.is_admin || !!target.is_admin;

    if (shareInbox) {

      const existing = await db.prepare(`

        SELECT *

          FROM conversations

         WHERE a_user_id = ? AND b_user_id = ?

         ORDER BY (listing_id IS NULL) DESC, id ASC

         LIMIT 1

      `).get(a, b);

      if (existing) {

        if (existing.listing_id != null) {

          await db.prepare('UPDATE conversations SET listing_id = NULL WHERE id = ?').run(existing.id);

          existing.listing_id = null;

        }

        return res.json(existing);

      }

      listing_id = null;

    }

    

    try {

      const info = await db.prepare('INSERT INTO conversations (a_user_id, b_user_id, listing_id, created_at) VALUES (?, ?, ?, ?)')

        .run(a, b, listing_id || null, nowIso());

      return res.json({ id: info.lastInsertRowid, a_user_id: a, b_user_id: b, listing_id: listing_id || null });

    } catch {

    const row = await db.prepare('SELECT * FROM conversations WHERE a_user_id=? AND b_user_id=? AND listing_id = ?')        .get(a, b, listing_id || null);

      return res.json(row);

    }

  } catch (e) {

    console.error('Create conversation failed:', e);

    return res.status(500).json({ error: 'create_failed' });

  }

});



app.get('/api/conversations', auth, async (req, res) => {

  try {

    const me = req.user.id;

    const rows = await db.prepare(`

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

        (SELECT id         FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_id,

        (SELECT is_admin   FROM users    WHERE id = (SELECT sender_id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1)) AS last_message_is_admin

      FROM conversations c

      JOIN users u

        ON u.id = CASE WHEN c.a_user_id = @me THEN c.b_user_id ELSE c.a_user_id END

      LEFT JOIN listings l

        ON l.id = c.listing_id

      WHERE c.a_user_id = @me OR c.b_user_id = @me

      ORDER BY c.id DESC

    `).all({ me });



    const normalized = rows.map(row => ({

      ...row,

      image_data: canonicalAssetUrl(row.image_data)

    }));



    res.json(normalized);

  } catch (e) {

    console.error('Get conversations failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.get('/api/conversations/:id/messages', auth, async (req, res) => {

  try {

    const id = Number(req.params.id);

    const convo = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

    

    if (!convo) return res.status(404).json({ error: 'Not found' });

    if (!isMember(convo, req.user.id)) return res.status(403).json({ error: 'Forbidden' });



    const msgs = await db.prepare(`

      SELECT m.*, u.username AS sender_username

      FROM messages m JOIN users u ON u.id = m.sender_id

      WHERE m.conversation_id = ?

      ORDER BY m.id ASC

    `).all(id);



    const getImgs = db.prepare('SELECT COALESCE(url, image_data) AS image_data FROM message_images WHERE message_id = ? ORDER BY position ASC');

    const out = [];

    for (const m of msgs) {

      const imgs = await getImgs.all(m.id);

      out.push({ ...m, images: imgs.map(r => canonicalAssetUrl(r.image_data)) });

    }



    res.json(out);

  } catch (e) {

    console.error('Get messages failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.post('/api/conversations/:id/messages', auth, writeLimiter, async (req, res) => {

  try {

    const id = Number(req.params.id);

    const { body, images } = req.body || {};



    if ((!body || !String(body).trim()) && (!Array.isArray(images) || images.length === 0)) {

      return res.status(400).json({ error: 'Message body or image required' });

    }



    const convo = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

    if (!convo) return res.status(404).json({ error: 'Not found' });

    if (!isMember(convo, req.user.id)) return res.status(403).json({ error: 'Forbidden' });



    const otherUserId = convo.a_user_id === req.user.id ? convo.b_user_id : convo.a_user_id;

    if (isLockedAccount(req.user)) {

      const targetIsAdmin = await isAdminUserId(otherUserId);

      if (!targetIsAdmin) {

        return respondLocked(res);

      }

    }



    const err = validateMsgImages(images);

    if (err) return res.status(400).json({ error: err });



    const info = await db.prepare(

      'INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)'

    ).run(id, req.user.id, String(body || '').slice(0,2000), nowIso());



    const msgId = info.lastInsertRowid;



    if (Array.isArray(images) && images.length) {

      const stmt = db.prepare(`

        INSERT INTO message_images (message_id, position, image_data, url)

        VALUES (?, ?, ?, ?)

      `);



      for (let i = 0; i < images.length; i++) {

        const img = images[i];

        if (typeof img !== 'string') continue;

        if (img.startsWith('data:image/')) {

          await stmt.run(msgId, i, img, null);

        } else if (img.startsWith('https://') && isAllowedPublicUrl(img)) {

          const normalized = canonicalAssetUrl(img);

          await stmt.run(msgId, i, null, normalized);

        }

      }

    }



    const row = await db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);

    const imgs = await db.prepare('SELECT COALESCE(url, image_data) AS image_data FROM message_images WHERE message_id = ? ORDER BY position ASC')

      .all(msgId);

    const normalizedImgs = imgs.map(r => canonicalAssetUrl(r.image_data));

    

    res.json({ ...row, images: normalizedImgs });



    const wsMessage = {

      type: 'new_message',

      conversation_id: id,

      message: { ...row, images: normalizedImgs },

      sender_id: req.user.id,

      recipient_id: convo.a_user_id === req.user.id ? convo.b_user_id : convo.a_user_id

    };

    

    wss.clients.forEach(client => {

      if (client.readyState === WebSocket.OPEN && 

          (client.userId === wsMessage.recipient_id || client.userId === wsMessage.sender_id)) {

        client.send(JSON.stringify(wsMessage));

      }

    });

    

  } catch (e) {

    console.error('Send message failed:', e);

    return res.status(500).json({ error: 'send_failed' });

  }

});



// WebSocket connection handler

wss.on('connection', (ws, req) => {

  // Extract token from query string or cookie

  const url = new URL(req.url, `http://${req.headers.host}`);

  const token = url.searchParams.get('token') || req.headers.cookie?.match(/token=([^;]+)/)?.[1];

  

  if (!token) {

    ws.close(1008, 'No token provided');

    return;

  }

  

  try {

    const user = jwt.verify(token, JWT_SECRET);

    ws.userId = user.id;

    ws.isAlive = true;

    

    ws.on('pong', () => { ws.isAlive = true; });

    

    ws.on('message', (message) => {

      try {

        const data = JSON.parse(message);

        if (data.type === 'ping') {

          ws.send(JSON.stringify({ type: 'pong' }));

        }

      } catch {}

    });

    

    ws.send(JSON.stringify({ type: 'connected', userId: user.id }));

  } catch {

    ws.close(1008, 'Invalid token');

  }

});



// Heartbeat to detect disconnected clients

const wsHeartbeat = setInterval(() => {

  wss.clients.forEach(ws => {

    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;

    ws.ping();

  });

}, 30000);



app.delete('/api/conversations/:id', auth, writeLimiter, async (req, res) => {

  try {

    const id = Number(req.params.id);

    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });



    const convo = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

    if (!convo) return res.status(404).json({ error: 'Not found' });



    const isMem = (req.user?.id === convo.a_user_id) || 

                  (req.user?.id === convo.b_user_id) || 

                  !!req.user?.is_admin;

    if (!isMem) return res.status(403).json({ error: 'Forbidden' });



    await db.prepare(`

      DELETE FROM message_images

        WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)

    `).run(id);

    await db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);

    await db.prepare('DELETE FROM conversations WHERE id = ?').run(id);



    res.json({ ok: true });

  } catch (e) {

    console.error('Delete conversation failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});



/* ------------------------------------------------------------------ */

/* Ads                                                                */

/* ------------------------------------------------------------------ */

app.get('/api/ads', async (_req, res) => {

  try {

    const rows = await db.prepare(`

      SELECT *

        FROM ads

       WHERE is_active = 1

       ORDER BY position DESC, updated_at DESC, id DESC

    `).all();

    return res.json(rows.map(formatAdRow));

  } catch (e) {

    console.error('Public ads fetch failed:', e);

    return res.status(500).json({ error: 'ads_fetch_failed' });

  }

});



app.get('/api/admin/ads', auth, requireAdmin, async (_req, res) => {

  try {

    const rows = await db.prepare('SELECT * FROM ads ORDER BY position DESC, updated_at DESC, id DESC').all();

    return res.json(rows.map(formatAdRow));

  } catch (e) {

    console.error('Admin ads list failed:', e);

    return res.status(500).json({ error: 'admin_ads_failed' });

  }

});



app.post('/api/admin/ads', auth, requireAdmin, async (req, res) => {

  try {

    const { title, subtitle, target_url, image_url, cta_label, background, position, is_active } = req.body || {};

    const safeTitle = String(title || '').trim().slice(0, 120);

    if (!safeTitle) {

      return res.status(400).json({ error: 'title_required' });

    }

    const safeSubtitle = String(subtitle || '').trim().slice(0, 200) || null;

    const safeCta = String(cta_label || '').trim().slice(0, 40) || null;

    const safeBackground = String(background || '').trim().slice(0, 160) || null;

    let safePosition = Number.isFinite(Number(position)) ? Math.round(Number(position)) : 0;

    if (safePosition > 9999) safePosition = 9999;

    if (safePosition < -9999) safePosition = -9999;

    const normalizedTarget = normalizeHttpUrl(target_url);

    if (!normalizedTarget) {

      return res.status(400).json({ error: 'invalid_target_url' });

    }

    let normalizedImage = '';

    if (image_url) {

      normalizedImage = normalizeHttpUrl(image_url, { allowEmpty: true }) || '';

      if (image_url && !normalizedImage) {

        return res.status(400).json({ error: 'invalid_image_url' });

      }

    }

    const activeFlag = Number(is_active) === 0 ? 0 : 1;

    const now = nowIso();

    const info = await db.prepare(`

      INSERT INTO ads (title, subtitle, target_url, image_url, cta_label, background, is_active, position, created_at, updated_at)

      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    `).run(

      safeTitle,

      safeSubtitle,

      normalizedTarget,

      normalizedImage || null,

      safeCta,

      safeBackground,

      activeFlag,

      safePosition,

      now,

      now

    );

    const row = await db.prepare('SELECT * FROM ads WHERE id = ?').get(info.lastInsertRowid);

    return res.json(formatAdRow(row));

  } catch (e) {

    console.error('Admin ad create failed:', e);

    return res.status(500).json({ error: 'admin_ad_create_failed' });

  }

});



app.put('/api/admin/ads/:id', auth, requireAdmin, async (req, res) => {

  try {

    const adId = Number(req.params.id);

    if (!Number.isFinite(adId)) {

      return res.status(400).json({ error: 'invalid_ad' });

    }

    const { title, subtitle, target_url, image_url, cta_label, background, position, is_active } = req.body || {};

    const safeTitle = String(title || '').trim().slice(0, 120);

    if (!safeTitle) {

      return res.status(400).json({ error: 'title_required' });

    }

    const safeSubtitle = String(subtitle || '').trim().slice(0, 200) || null;

    const safeCta = String(cta_label || '').trim().slice(0, 40) || null;

    const safeBackground = String(background || '').trim().slice(0, 160) || null;

    let safePosition = Number.isFinite(Number(position)) ? Math.round(Number(position)) : 0;

    if (safePosition > 9999) safePosition = 9999;

    if (safePosition < -9999) safePosition = -9999;

    const normalizedTarget = normalizeHttpUrl(target_url);

    if (!normalizedTarget) {

      return res.status(400).json({ error: 'invalid_target_url' });

    }

    let normalizedImage = '';

    if (image_url) {

      normalizedImage = normalizeHttpUrl(image_url, { allowEmpty: true }) || '';

      if (image_url && !normalizedImage) {

        return res.status(400).json({ error: 'invalid_image_url' });

      }

    }

    const activeFlag = Number(is_active) === 0 ? 0 : 1;

    const now = nowIso();

    const info = await db.prepare(`

      UPDATE ads

         SET title = ?,

             subtitle = ?,

             target_url = ?,

             image_url = ?,

             cta_label = ?,

             background = ?,

             is_active = ?,

             position = ?,

             updated_at = ?

       WHERE id = ?

    `).run(

      safeTitle,

      safeSubtitle,

      normalizedTarget,

      normalizedImage || null,

      safeCta,

      safeBackground,

      activeFlag,

      safePosition,

      now,

      adId

    );

    if (!info.changes) {

      return res.status(404).json({ error: 'ad_not_found' });

    }

    const row = await db.prepare('SELECT * FROM ads WHERE id = ?').get(adId);

    return res.json(formatAdRow(row));

  } catch (e) {

    console.error('Admin ad update failed:', e);

    return res.status(500).json({ error: 'admin_ad_update_failed' });

  }

});



app.delete('/api/admin/ads/:id', auth, requireAdmin, async (req, res) => {

  try {

    const adId = Number(req.params.id);

    if (!Number.isFinite(adId)) {

      return res.status(400).json({ error: 'invalid_ad' });

    }

    const info = await db.prepare('DELETE FROM ads WHERE id = ?').run(adId);

    if (!info.changes) {

      return res.status(404).json({ error: 'ad_not_found' });

    }

    return res.json({ ok: true });

  } catch (e) {

    console.error('Admin ad delete failed:', e);

    return res.status(500).json({ error: 'admin_ad_delete_failed' });

  }

});



/* ------------------------------------------------------------------ */

/* Reverse geocoding                                                  */

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

/* Admin endpoints                                                     */

/* ------------------------------------------------------------------ */

app.delete('/api/admin/listings/:id', auth, requireAdmin, async (req, res) => {

  try {

    const id = Number(req.params.id);

    await db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);

    const info = await db.prepare('DELETE FROM listings WHERE id = ?').run(id);

    invalidateNearbyCache();

    res.json({ ok: true, deleted: info.changes });

  } catch (e) {

    console.error('Admin delete listing failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});





app.get('/api/admin/users/search', auth, requireAdmin, async (req, res) => {

  try {

    const qRaw = String(req.query.q || '').trim();

    if (!qRaw) return res.json([]);

    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);



    let rows = [];

    const numeric = Number(qRaw);

    if (Number.isFinite(numeric)) {

      rows = await db.prepare(`

        SELECT u.id, u.email, u.username, u.created_at,

               COALESCE(u.account_status, 'active') AS account_status,

               u.status_note,

               u.status_updated_at,

               u.last_login_at,

               (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS listing_count,
               (SELECT COUNT(*) FROM seller_reports WHERE reported_user_id = u.id AND status != 'cleared') AS report_count
          FROM users u

         WHERE u.id = ?

      `).all(numeric);

    } else {

      const like = `%${qRaw.toLowerCase().replace(/%/g, '')}%`;

      rows = await db.prepare(`

        SELECT u.id, u.email, u.username, u.created_at,

               COALESCE(u.account_status, 'active') AS account_status,

               u.status_note,

               u.status_updated_at,

               u.last_login_at,

               (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS listing_count,
               (SELECT COUNT(*) FROM seller_reports WHERE reported_user_id = u.id AND status != 'cleared') AS report_count
          FROM users u

         WHERE LOWER(u.email) LIKE @like

            OR LOWER(u.username) LIKE @like

         ORDER BY u.username ASC, u.id ASC

         LIMIT @limit

      `).all({ like, limit });

    }



    const result = rows.map(row => ({

      id: row.id,

      email: row.email,

      username: row.username,

      created_at: row.created_at,

      account_status: row.account_status,

      status_note: row.status_note,

      status_updated_at: row.status_updated_at,

      last_login_at: row.last_login_at,

      listing_count: Number(row.listing_count || 0),

      report_count: Number(row.report_count || 0)

    }));



    return res.json(result);

  } catch (e) {

    console.error('Admin user search failed:', e);

    return res.status(500).json({ error: 'admin_search_failed' });

  }

});



app.get('/api/admin/users/:id', auth, requireAdmin, async (req, res) => {

  try {

    const userId = Number(req.params.id);

    if (!Number.isFinite(userId)) {

      return res.status(400).json({ error: 'invalid_user' });

    }



    const row = await db.prepare(`

      SELECT u.id, u.email, u.username, u.created_at,

             COALESCE(u.account_status, 'active') AS account_status,

             u.status_note,

             u.status_updated_at,

             u.last_login_at,

             u.paypal_email,

             u.is_admin,

             (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS listing_count,
             (SELECT COUNT(*) FROM seller_reports WHERE reported_user_id = u.id AND status != 'cleared') AS report_count,
             (SELECT COUNT(*) FROM seller_reports WHERE reported_user_id = u.id AND status = 'open') AS open_report_count

        FROM users u

       WHERE u.id = ?

    `).get(userId);



    if (!row) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    const recentReport = await db.prepare(`

      SELECT created_at

        FROM seller_reports

       WHERE reported_user_id = ?
         AND status != 'cleared'
       ORDER BY created_at DESC

       LIMIT 1

    `).get(userId);



    return res.json({

      id: row.id,

      email: row.email,

      username: row.username,

      created_at: row.created_at,

      account_status: row.account_status,

      status_note: row.status_note,

      status_updated_at: row.status_updated_at,

      last_login_at: row.last_login_at,

      paypal_email: row.paypal_email || '',

      is_admin: !!row.is_admin,

      listing_count: Number(row.listing_count || 0),

      report_count: Number(row.report_count || 0),

      open_report_count: Number(row.open_report_count || 0),

      last_report_at: recentReport?.created_at || null

    });

  } catch (e) {

    console.error('Admin user detail failed:', e);

    return res.status(500).json({ error: 'admin_user_failed' });

  }

});



app.get('/api/admin/users/:id/reports', auth, requireAdmin, async (req, res) => {

  try {

    const userId = Number(req.params.id);

    if (!Number.isFinite(userId)) {

      return res.status(400).json({ error: 'invalid_user' });

    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);



    const rows = await db.prepare(`

      SELECT r.id, r.listing_id, r.reasons, r.details, r.created_at, r.status, r.admin_note,
             r.resolved_at, r.resolved_by, r.resolved_note,
             r.reporter_user_id,

             reporter.username AS reporter_username,

             reporter.email AS reporter_email

        FROM seller_reports r

        JOIN users reporter ON reporter.id = r.reporter_user_id

       WHERE r.reported_user_id = ?

       ORDER BY r.created_at DESC

       LIMIT ?

    `).all(userId, limit);



    const parsed = rows.map(row => {

      let reasons;

      try {

        reasons = Array.isArray(row.reasons) ? row.reasons : JSON.parse(row.reasons || '[]');

        if (!Array.isArray(reasons)) reasons = [];

      } catch {

        reasons = [];

      }

      return {

        id: row.id,

        listing_id: row.listing_id,

        reasons,

        details: row.details,

        created_at: row.created_at,

        status: row.status,

        admin_note: row.admin_note,
        resolved_at: row.resolved_at || null,
        resolved_by: row.resolved_by || null,
        resolved_note: row.resolved_note || null,
        reporter: {

          id: row.reporter_user_id,

          username: row.reporter_username,

          email: row.reporter_email

        }

      };

    });



    return res.json(parsed);

  } catch (e) {

    console.error('Admin report list failed:', e);

    return res.status(500).json({ error: 'admin_reports_failed' });

  }

});

app.post('/api/admin/users/:id/reports/clear', auth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'invalid_user' });
    }

    const existing = await db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!existing) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    const noteRaw = (req.body?.note ?? '').toString().trim();
    const note = noteRaw.length ? noteRaw.slice(0, 500) : '';
    const now = nowIso();
    const adminId = Number.isFinite(Number(req.user?.id)) ? Number(req.user.id) : null;

    const info = await db.prepare(`
      UPDATE seller_reports
         SET status = 'cleared',
             resolved_at = @now,
             resolved_by = @adminId,
             resolved_note = CASE WHEN @note != '' THEN @note ELSE resolved_note END
       WHERE reported_user_id = @userId
         AND status != 'cleared'
    `).run({ now, adminId, note, userId });

    return res.json({ ok: true, cleared: info.changes || 0 });
  } catch (e) {
    console.error('Admin clear reports failed:', e);
    return res.status(500).json({ error: 'admin_clear_failed' });
  }
});

app.post('/api/admin/users/:id/status', auth, requireAdmin, async (req, res) => {

  try {

    const userId = Number(req.params.id);

    if (!Number.isFinite(userId)) {

      return res.status(400).json({ error: 'invalid_user' });

    }



    const statusRaw = String(req.body?.status || '').trim().toLowerCase();

    const allowed = new Set(['active', 'locked', 'banned']);

    if (!allowed.has(statusRaw)) {

      return res.status(400).json({ error: 'invalid_status' });

    }



    let note = (req.body?.note || '').toString().trim();

    if (note) note = note.slice(0, 500);

    if (statusRaw === 'active' && !note) note = null;



    const now = nowIso();

    const info = await db.prepare(`

      UPDATE users

         SET account_status = ?,

             status_note = ?,

             status_updated_at = ?

       WHERE id = ?

    `).run(statusRaw, note || null, now, userId);



    if (!info.changes) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    const updated = await getUserWithStatus(userId);

    if (!updated) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    return res.json({

      id: updated.id,

      email: updated.email,

      username: updated.username,

      account_status: updated.account_status,

      status_note: updated.status_note,

      status_updated_at: updated.status_updated_at,

      created_at: updated.created_at,

      last_login_at: updated.last_login_at,

      is_admin: updated.is_admin

    });

  } catch (e) {

    console.error('Admin user status update failed:', e);

    return res.status(500).json({ error: 'status_update_failed' });

  }

});



app.get('/api/admin/reports/top', auth, requireAdmin, async (req, res) => {

  try {

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const daysParam = Number(req.query.days);

    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const minParam = Number(req.query.min ?? req.query.min_reports);

    const minReports = Math.max(1, Number.isFinite(minParam) && minParam > 0 ? minParam : ADMIN_REPORT_MIN);

    const rows = await db.prepare(`

      SELECT r.reported_user_id AS user_id,

             u.username,

             u.email,

             COALESCE(u.account_status, 'active') AS account_status,

             COUNT(*) AS total_reports,

             SUM(CASE WHEN r.status = 'open' THEN 1 ELSE 0 END) AS open_reports,

             SUM(CASE WHEN r.created_at >= @since THEN 1 ELSE 0 END) AS recent_reports,

             MAX(r.created_at) AS last_report_at

        FROM seller_reports r

        JOIN users u ON u.id = r.reported_user_id
       WHERE r.status != 'cleared'
       GROUP BY r.reported_user_id, u.username, u.email, COALESCE(u.account_status, 'active')
      HAVING COUNT(*) >= @minReports
       ORDER BY total_reports DESC, last_report_at DESC

       LIMIT @limit
    `).all({ since, limit, minReports });

    const payload = rows.map(row => ({

      user_id: row.user_id,

      username: row.username,

      email: row.email,

      account_status: row.account_status,

      total_reports: Number(row.total_reports || 0),

      open_reports: Number(row.open_reports || 0),

      recent_reports: Number(row.recent_reports || 0),

      last_report_at: row.last_report_at
    }));

    return res.json({ items: payload, days, min_reports: minReports });
  } catch (e) {
    console.error('Admin top reports failed:', e);
    return res.status(500).json({ error: 'admin_reports_failed' });
  }
});




app.delete('/api/admin/listings', auth, requireAdmin, async (_req, res) => {

  try {

    await db.exec('DELETE FROM listing_images; DELETE FROM listings;');

    invalidateNearbyCache();

    res.json({ ok: true });

  } catch (e) {

    console.error('Admin delete all failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});



if (IS_TEST) {

  app.post('/__test/reset', async (_req, res) => {

    try {

      await initializeSchema();

      const tables = [

        'message_images',

        'messages',

        'conversations',

        'listing_images',

        'seller_reports',

        'listings',

        'listing_cities',

        'users'

      ];

      for (const name of tables) {

        try {

          await db.exec(`DELETE FROM ${name};`);

        } catch (err) {

          console.error('Reset delete failed for', name, err);

        }

      }

      if (!process.env.DATABASE_URL) {

        try {

          await db.exec("DELETE FROM sqlite_sequence WHERE name IN ('message_images','messages','conversations','listing_images','seller_reports','listings','listing_cities','users')");

        } catch (err) {

          // ignore

        }

      }

      invalidateNearbyCache();

      res.json({ ok: true });

    } catch (e) {

      console.error('Test reset failed:', e);

      res.status(500).json({ error: 'reset_failed' });

    }

  });

}



/* ------------------------------------------------------------------ */

/* Health & Error handling                                            */

/* ------------------------------------------------------------------ */

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));



app.use((err, _req, res, _next) => {

  console.error('Unhandled error:', err);

  res.status(500).json({ error: 'server_error' });

});



/* ------------------------------------------------------------------ */

/* Server startup                                                      */

/* ------------------------------------------------------------------ */

async function startServer() {

  await initializeSchema();

  await maybeCreateAdmin();

  

  server.listen(PORT, () => {

    console.log(`ListIt running at http://localhost:${PORT}`);

    console.log('WebSocket server ready');

  });

}



app._initializeSchema = initializeSchema;

app._maybeCreateAdmin = maybeCreateAdmin;

app._startServer = startServer;

app._db = db;



// ADD THIS:

if (require.main === module) {

  startServer();

}



module.exports = app;




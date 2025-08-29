/* server.js — ListIt with usernames + titles + private searchable tags + AI analysis (title, tags, suggested price) + messaging + admin + robust SQLite path */

const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
let cors; try { cors = require('cors'); } catch {}
let OpenAI; try { OpenAI = require('openai'); } catch {}

const app = express();

const PORT = process.env.PORT || 3000;
const IS_TEST = process.env.NODE_ENV === 'test';
const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_change_me';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || null;
if (FRONTEND_ORIGIN && cors) app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

/* ------------------------------------------------------------------ */
/* SQLite path handling (Render Disk friendly)                         */
/* ------------------------------------------------------------------ */
const DEFAULT_DB = path.join(__dirname, 'listit.db');
const WANTED_DB = process.env.DB_PATH || DEFAULT_DB;

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); return true; }
  catch (e) { console.warn('Could not create DB dir', dir, e.message); return false; }
}

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

/* ------------------------------------------------------------------ */
/* Schema + migrations                                                 */
/* ------------------------------------------------------------------ */
try { db.pragma('journal_mode = WAL'); } catch {}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

try { db.prepare('SELECT username FROM users LIMIT 1').get(); }
catch {
  db.exec('ALTER TABLE users ADD COLUMN username TEXT;');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);');
}

try { db.prepare('SELECT is_admin FROM users LIMIT 1').get(); }
catch { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;'); }

db.exec(`
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  image_data TEXT NOT NULL,
  title TEXT DEFAULT "",
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  price REAL NOT NULL,
  created_at TEXT NOT NULL,
  tags TEXT DEFAULT "",
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS listing_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  image_data TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES listings(id)
);
CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images(listing_id, position);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a_user_id INTEGER NOT NULL,
  b_user_id INTEGER NOT NULL,
  listing_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (a_user_id, b_user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
`);

try { db.prepare('SELECT tags FROM listings LIMIT 1').get(); }
catch { db.exec('ALTER TABLE listings ADD COLUMN tags TEXT DEFAULT "";'); }
try { db.prepare('SELECT title FROM listings LIMIT 1').get(); }
catch { db.exec('ALTER TABLE listings ADD COLUMN title TEXT DEFAULT "";'); }

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
    seen.add(t);
    clean.push(t);
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

/* ------------------------------------------------------------------ */
/* Auth helpers                                                        */
/* ------------------------------------------------------------------ */
function setAuthCookie(res, payload){
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: FRONTEND_ORIGIN ? 'none' : 'lax',
    secure: IS_PROD,
    maxAge: 7*24*60*60*1000,
    path: '/'
  });
}
function auth(req, res, next){
  const { token } = req.cookies || {};
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }
}
function requireAdmin(req, res, next){
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

/* ------------------------------------------------------------------ */
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/* Optional admin bootstrap via env vars                               */
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
app.post('/api/register', async (req, res) => {
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
    const user = { id: info.lastInsertRowid, email, username, is_admin: 0 };
    setAuthCookie(res, user);
    return res.json(user);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('users.email'))   return res.status(409).json({ error: 'Email already registered' });
    if (msg.includes('users.username'))return res.status(409).json({ error: 'Username already taken' });
    console.error(e);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const user = { id: row.id, email: row.email, username: row.username, is_admin: row.is_admin || 0 };
  setAuthCookie(res, user);
  return res.json(user);
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: FRONTEND_ORIGIN ? 'none' : 'lax', secure: IS_PROD, path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const { token } = req.cookies || {};
  if (!token) return res.json(null);
  try {
    const data = jwt.verify(token, JWT_SECRET);
    return res.json({ id: data.id, email: data.email, username: data.username, is_admin: data.is_admin || 0 });
  } catch {
    return res.json(null);
  }
});

/* ------------------------------------------------------------------ */
/* Listings (Title + private tags in search)                           */
/* ------------------------------------------------------------------ */
function validateImages(images) {
  if (!Array.isArray(images) || images.length === 0) return 'At least one image is required';
  if (images.length > 10) return 'Too many images (max 10)';
  for (const img of images) {
    if (typeof img !== 'string' || !img.startsWith('data:image')) return 'Each image must be a data URL';
    if (img.length > 3 * 1024 * 1024 * 1.6) return 'Each image must be <= ~3MB';
  }
  return null;
}

app.get('/api/listings', (req, res) => {
  const qRaw = (req.query.q || '').toString().trim().toLowerCase();
  const q = qRaw ? `%${qRaw}%` : null;
  const mine = req.query.mine === '1';

  const SELECT_PUBLIC = `
    SELECT l.id, l.user_id, l.image_data, l.title, l.description, l.location, l.price, l.created_at,
           u.username as owner_username
    FROM listings l
    JOIN users u ON u.id = l.user_id
  `;

  if (mine) {
    const { token } = req.cookies || {};
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    let me; try { me = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }

    let rows;
    if (q) {
      rows = db.prepare(`${SELECT_PUBLIC}
        WHERE l.user_id = ?
          AND (LOWER(l.title) LIKE ? OR LOWER(l.description) LIKE ? OR LOWER(IFNULL(l.tags,'')) LIKE ? OR LOWER(l.location) LIKE ?)
        ORDER BY l.id DESC
      `).all(me.id, q, q, q, q);
    } else {
      rows = db.prepare(`${SELECT_PUBLIC}
        WHERE l.user_id = ?
        ORDER BY l.id DESC
      `).all(me.id);
    }

    const withTags = rows.map(r => {
      const t = db.prepare('SELECT tags FROM listings WHERE id=?').get(r.id)?.tags || '';
      return { ...r, tags: t ? t.split(',') : [] };
    });
    return res.json(withTags);
  }

  let rows;
  if (q) {
    rows = db.prepare(`${SELECT_PUBLIC}
      WHERE (LOWER(l.title) LIKE ? OR LOWER(l.description) LIKE ? OR LOWER(IFNULL(l.tags,'')) LIKE ? OR LOWER(l.location) LIKE ?)
      ORDER BY l.id DESC
    `).all(q, q, q, q);
  } else {
    rows = db.prepare(`${SELECT_PUBLIC} ORDER BY l.id DESC`).all();
  }

  return res.json(rows);
});

app.post('/api/listings', auth, (req, res) => {
  const { images, image_data, title, description, location, price, tags } = req.body || {};
  const imgs = Array.isArray(images) ? images : (image_data ? [image_data] : []);
  const err = validateImages(imgs);
  if (err) return res.status(400).json({ error: err });
  if (!description || !location || typeof price !== 'number' || Number.isNaN(price)) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const cover = imgs[0];
  const tagStr = normalizeTags(tags);
  const safeTitle = shortTitle(title) || shortTitle(description);

  const info = db.prepare(`
    INSERT INTO listings (user_id, image_data, title, description, location, price, created_at, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, cover, safeTitle, String(description).slice(0,400), String(location).slice(0,80), Number(price), nowIso(), tagStr);

  const listingId = info.lastInsertRowid;
  const stmt = db.prepare('INSERT INTO listing_images (listing_id, image_data, position) VALUES (?, ?, ?)');
  imgs.forEach((img, i) => stmt.run(listingId, img, i));
  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
  res.json(row);
});

app.put('/api/listings/:id', auth, (req, res) => {
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

  const newTitle = title !== undefined ? shortTitle(title) : existing.title;
  const newDesc = description ? String(description).slice(0,400) : existing.description;
  const newLoc  = location ? String(location).slice(0,80) : existing.location;
  const newPrice = (typeof price === 'number' && !Number.isNaN(price)) ? Number(price) : existing.price;

  db.prepare('UPDATE listings SET title=?, description=?, location=?, price=? WHERE id=?')
    .run(newTitle, newDesc, newLoc, newPrice, id);

  if (typeof tags !== 'undefined') {
    const tagStr = normalizeTags(tags);
    db.prepare('UPDATE listings SET tags=? WHERE id=?').run(tagStr, id);
  }

  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  res.json(row);
});

app.delete('/api/listings/:id', auth, (req, res) => {
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
  const rows = db.prepare('SELECT image_data FROM listing_images WHERE listing_id = ? ORDER BY position ASC').all(id);
  res.json(rows.map(r => r.image_data));
});

/* ------------------------------------------------------------------ */
/* AI Analysis endpoint (title, tags, suggested_price)                */
/* ------------------------------------------------------------------ */
app.post('/api/ai/analyze', auth, async (req, res) => {
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
          '"tags": array of 12-24 short, lowercase search terms (generic words users type; include generic synonyms, e.g., "car" for a Jeep);',
          '"price_usd": fair used-market price in USD as a number (no symbols), based on comparable items and visible condition; estimate conservatively if unsure.',
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

      let suggested_price = undefined;
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

    // Fallback (no OpenAI)
    const title = shortTitle(hint || 'Item for sale');
    const tags = normalizeTags(fallbackTagsFromTitleDesc(title, hint)).split(',').filter(Boolean);
    return res.json({ title, tags: tags.slice(0, 20), suggested_price: undefined });
  } catch (e) {
    console.error('AI analyze failed:', e);
    return res.status(500).json({ error: 'AI analysis failed' });
  }
});

function fallbackTagsFromTitleDesc(title, desc) {
  const s = `${title || ''} ${desc || ''}`.toLowerCase();
  const words = (s.match(/[a-z0-9\-]{3,}/g) || []).slice(0, 80);
  const freq = {};
  for (const w of words) { freq[w] = (freq[w] || 0) + 1; }
  const base = Object.entries(freq).sort((a,b)=>b[1]-a[1]).map(([w])=>w).slice(0,10);
  const generic = ['sale','buy','deal','used','second hand','good','condition','local','pickup','cheap','discount','shop','offer'];
  return [...new Set([...base, ...generic])].slice(0, 20);
}

/* ------------------------------------------------------------------ */
/* Conversations & messages                                            */
/* ------------------------------------------------------------------ */
function isMember(convo, uid){ return convo && (convo.a_user_id === uid || convo.b_user_id === uid); }

app.post('/api/conversations', auth, (req, res) => {
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
    SELECT c.id, c.listing_id,
      CASE WHEN c.a_user_id = ? THEN c.b_user_id ELSE c.a_user_id END AS other_user_id,
      (SELECT username FROM users WHERE id = CASE WHEN c.a_user_id = ? THEN c.b_user_id ELSE c.a_user_id END) AS other_user_username,
      (SELECT description FROM listings WHERE id = c.listing_id) AS listing_description,
      (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_at,
      (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_body,
      (SELECT sender_id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_sender_id,
      (SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_id
    FROM conversations c
    WHERE c.a_user_id = ? OR c.b_user_id = ?
    ORDER BY c.id DESC
  `).all(me, me, me, me);
  res.json(rows);
});

app.get('/api/conversations/:id/messages', auth, (req, res) => {
  const id = Number(req.params.id);
  const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!convo) return res.status(404).json({ error: 'Not found' });
  if (!isMember(convo, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const rows = db.prepare(`
    SELECT m.*, u.username AS sender_username
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.id ASC
  `).all(id);
  res.json(rows);
});

app.post('/api/conversations/:id/messages', auth, (req, res) => {
  const id = Number(req.params.id);
  const { body } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Message body required' });
  const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!convo) return res.status(404).json({ error: 'Not found' });
  if (!isMember(convo, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const info = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)').run(id, req.user.id, String(body).slice(0,2000), nowIso());
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  res.json(row);
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

app.delete('/api/admin/listings', auth, requireAdmin, (req, res) => {
  db.exec('DELETE FROM listing_images; DELETE FROM listings;');
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
if (require.main === module) {
  app.listen(PORT, () => console.log(`ListIt running at http://localhost:${PORT}`));
}
module.exports = app;

/* server.js — usernames + no public emails */

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_change_me';
const IS_TEST = process.env.NODE_ENV === 'test';
const IS_PROD = process.env.NODE_ENV === 'production';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || null; // set if frontend is on another domain
if (FRONTEND_ORIGIN) app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

// --- DB Setup ---
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'listit.db');
const db = new Database(IS_TEST ? ':memory:' : DB_PATH);
try { db.pragma('journal_mode = WAL'); } catch (_) {}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

// Auto-migrate: add username column/index if missing
try { db.prepare('SELECT username FROM users LIMIT 1').get(); }
catch {
  db.exec(`ALTER TABLE users ADD COLUMN username TEXT;`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);`);
}

// Core tables (existing)
db.exec(`
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  image_data TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  price REAL NOT NULL,
  created_at TEXT NOT NULL,
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

function nowIso(){ return new Date().toISOString(); }
function setAuthCookie(res, payload){
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
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
function normalizePair(u1, u2){
  const a = Math.min(Number(u1), Number(u2));
  const b = Math.max(Number(u1), Number(u2));
  return { a, b };
}

app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth ---
app.post('/api/register', async (req, res) => {
  const username = (req.body.username || req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!username || !email || !password) return res.status(400).json({ error: 'Username, email, and password are required' });
  if (username.length < 3 || username.length > 32) return res.status(400).json({ error: 'Username must be 3–32 chars' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 chars' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(email, username, hash, nowIso());
    setAuthCookie(res, { id: info.lastInsertRowid, email, username });
    return res.json({ id: info.lastInsertRowid, email, username });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('users.email')) return res.status(409).json({ error: 'Email already registered' });
    if (msg.includes('users.username')) return res.status(409).json({ error: 'Username already taken' });
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
  setAuthCookie(res, { id: row.id, email: row.email, username: row.username });
  return res.json({ id: row.id, email: row.email, username: row.username });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const { token } = req.cookies || {};
  if (!token) return res.json(null);
  try {
    const data = jwt.verify(token, JWT_SECRET);
    // Return email only to the owner; never expose others' emails in public endpoints
    return res.json({ id: data.id, email: data.email, username: data.username });
  } catch {
    return res.json(null);
  }
});

// --- Listings ---
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
  const mine = req.query.mine === '1';
  if (mine) {
    const { token } = req.cookies || {};
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    let me; try { me = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }
    const rows = db.prepare(`
      SELECT l.*, u.username as owner_username
      FROM listings l
      JOIN users u ON u.id = l.user_id
      WHERE l.user_id = ?
      ORDER BY l.id DESC
    `).all(me.id);
    return res.json(rows);
  }
  const rows = db.prepare(`
    SELECT l.*, u.username as owner_username
    FROM listings l
    JOIN users u ON u.id = l.user_id
    ORDER BY l.id DESC
  `).all();
  return res.json(rows);
});

app.post('/api/listings', auth, (req, res) => {
  const { images, image_data, description, location, price } = req.body || {};
  const imgs = Array.isArray(images) ? images : (image_data ? [image_data] : []);
  const err = validateImages(imgs);
  if (err) return res.status(400).json({ error: err });
  if (!description || !location || typeof price !== 'number' || Number.isNaN(price)) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const cover = imgs[0];
  const info = db.prepare(`INSERT INTO listings (user_id, image_data, description, location, price, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(req.user.id, cover, String(description).slice(0,400), String(location).slice(0,80), Number(price), nowIso());
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
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: 'Not your listing' });

  const { images, image_data, description, location, price } = req.body || {};
  if (images || image_data) {
    const imgs = Array.isArray(images) ? images : (image_data ? [image_data] : []);
    const err = validateImages(imgs);
    if (err) return res.status(400).json({ error: err });
    db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);
    const stmt = db.prepare('INSERT INTO listing_images (listing_id, image_data, position) VALUES (?, ?, ?)');
    imgs.forEach((img, i) => stmt.run(id, img, i));
    db.prepare('UPDATE listings SET image_data = ? WHERE id = ?').run(imgs[0], id);
  }
  db.prepare('UPDATE listings SET description=?, location=?, price=? WHERE id=?')
    .run(
      description ? String(description).slice(0,400) : existing.description,
      location ? String(location).slice(0,80) : existing.location,
      typeof price === 'number' && !Number.isNaN(price) ? Number(price) : existing.price,
      id
    );
  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  res.json(row);
});

app.delete('/api/listings/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: 'Not your listing' });
  db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);
  db.prepare('DELETE FROM listings WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/listings/:id/images', (req, res) => {
  const id = Number(req.params.id);
  const rows = db.prepare('SELECT image_data FROM listing_images WHERE listing_id = ? ORDER BY position ASC').all(id);
  res.json(rows.map(r => r.image_data));
});

// --- Conversations & Messages ---
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

// test helper
if (IS_TEST) {
  app.post('/__test/reset', (req, res) => {
    db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM listing_images; DELETE FROM listings; DELETE FROM users;');
    res.json({ ok: true });
  });
}

if (require.main === module) {
  app.listen(PORT, () => console.log(`ListIt server running at http://localhost:${PORT}`));
}

module.exports = app;

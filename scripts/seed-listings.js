#!/usr/bin/env node

const path = require('path');
const crypto = require('crypto');

// Ensure we can run from repo root or scripts directory
const repoRoot = path.resolve(__dirname, '..');
process.chdir(repoRoot);

const db = require('../db-wrapper');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        out[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          out[key] = next;
          i += 1;
        } else {
          out[key] = 'true';
        }
      }
    } else if (token.startsWith('-')) {
      const key = token.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = 'true';
      }
    } else {
      out._.push(token);
    }
  }
  return out;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function randomPrice(min, max) {
  return Number((min + Math.random() * (max - min)).toFixed(2));
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomWords(prefix, index) {
  return `${prefix} ${index}`;
}

async function ensureUserExists(userId) {
  const row = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId);
  if (!row) {
    throw new Error(`User ${userId} not found. Create a user or pass --user=<id>.`);
  }
  return row;
}

async function insertListing({ userId, title, description, location, price, tags, imageUrl, createdAtIso, enableNearby }) {
  const insertSql = `
    INSERT INTO listings (user_id, image_data, title, description, location, price, created_at, tags, lat, lon, enable_nearby)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `;
  const result = await db.prepare(insertSql).run(
    userId,
    imageUrl,
    title,
    description,
    location,
    price,
    createdAtIso,
    tags,
    enableNearby ? 1 : 0
  );
  return result.lastInsertRowid || result.id || result?.lastInsertId;
}

async function insertListingImage({ listingId, position, key, url, width, height, bytes, createdAtEpoch }) {
  const sql = `
    INSERT INTO listing_images (listing_id, image_data, position, key, url, width, height, bytes, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `;
  await db.prepare(sql).run(
    listingId,
    position,
    key,
    url,
    width,
    height,
    bytes,
    createdAtEpoch
  );
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const count = toNumber(argv.count ?? argv.c ?? argv._?.[0], 100);
  const imagesPerListing = Math.max(1, toNumber(argv.images ?? argv.i, 1));
  const userId = toNumber(argv.user ?? argv.u, 1);
  const enableNearby = argv.nearby === 'true' || argv.nearby === '1';
  const placeholder = argv.placeholder || 'https://via.placeholder.com/800x600.png?text=Load+Test';
  const tagBase = (argv.tag || '#loadtest').trim();
  const priceMin = toNumber(argv.priceMin ?? argv.min, 5);
  const priceMax = Math.max(priceMin, toNumber(argv.priceMax ?? argv.max, 150));
  const seedPrefix = argv.prefix || 'Load Test Listing';
  const batch = toNumber(argv.batch, 50);

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error('Count must be a positive number. Pass --count=<n>.');
  }

  await ensureUserExists(userId);

  console.log(`Seeding ${count} listings for user ${userId}...`);

  const cities = [
    'Seattle, WA', 'Austin, TX', 'Denver, CO', 'Boston, MA', 'Miami, FL',
    'San Francisco, CA', 'Chicago, IL', 'New York, NY', 'Phoenix, AZ', 'Portland, OR'
  ];

  const start = Date.now();
  for (let i = 0; i < count; i++) {
    const index = i + 1;
    const title = randomWords(seedPrefix, index);
    const description = `${title} generated for load testing.`;
    const location = randomFrom(cities);
    const price = randomPrice(priceMin, priceMax);
    const createdAtIso = new Date(start - i * 60000).toISOString();
    const createdAtEpoch = Math.floor(Date.now() / 1000);
    const tags = `${tagBase},auto,seed`;

    const listingId = await insertListing({
      userId,
      title,
      description,
      location,
      price,
      tags,
      imageUrl: placeholder,
      createdAtIso,
      enableNearby
    });

    for (let p = 0; p < imagesPerListing; p++) {
      const key = `loadtest/${createdAtEpoch}/${listingId}/${crypto.randomBytes(4).toString('hex')}.jpg`;
      await insertListingImage({
        listingId,
        position: p,
        key,
        url: placeholder,
        width: 800,
        height: 600,
        bytes: 125000,
        createdAtEpoch
      });
    }

    if ((index % batch) === 0) {
      console.log(`  Inserted ${index} listings...`);
    }
  }

  console.log('Finished seeding listings.');

  if (typeof db.close === 'function') {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  if (typeof db.close === 'function') {
    Promise.resolve(db.close()).catch(() => {});
  }
  process.exit(1);
});

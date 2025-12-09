/**
 * Shared Listing Service
 *
 * Provides reusable listing creation logic for both the HTTP API
 * and the background worker (fire-and-forget auto-listing).
 */

const db = require('../db-wrapper');

/**
 * Normalize tags into comma-separated string
 */
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

/**
 * Truncate and format title
 */
function shortTitle(str) {
  const s = String(str || '').trim();
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').slice(0, 80);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Generate fallback tags from title and description
 */
function fallbackTagsFromTitleDesc(title, desc) {
  const s = `${title || ''} ${desc || ''}`.toLowerCase();
  const words = (s.match(/[a-z0-9\-]{3,}/g) || []).slice(0, 80);
  const freq = {};
  for (const w of words) { freq[w] = (freq[w] || 1) + 1; }
  const base = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 10);
  const generic = ['sale', 'buy', 'deal', 'used', 'second hand', 'good', 'condition', 'local', 'pickup', 'cheap', 'discount', 'shop', 'offer'];
  return [...new Set([...base, ...generic])].slice(0, 20);
}

/**
 * Synthesize a description when none is provided
 * AI descriptions disabled - returns hint if provided, otherwise 'No description'
 */
function synthesizeListingDescription(_title, hint) {
  const cleanHint = (hint || '').toString().trim().replace(/\s+/g, ' ');
  if (cleanHint) {
    return cleanHint.slice(0, 200);
  }
  return 'No description';
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Resolve upload tokens to draft records
 * @param {number} userId - User ID
 * @param {string[]} uploadTokens - Array of upload tokens
 * @returns {Promise<Array>} - Resolved upload records
 */
async function resolveUploadDrafts(userId, uploadTokens) {
  if (!uploadTokens || !uploadTokens.length) return [];

  const tokenParams = { userId };
  const placeholders = uploadTokens.map((_, idx) => {
    const key = `t${idx}`;
    tokenParams[key] = uploadTokens[idx];
    return `@${key}`;
  }).join(', ');

  const rows = placeholders
    ? await db.prepare(`
        SELECT token, key, url, width, height, bytes, created_at
        FROM listing_upload_drafts
        WHERE user_id = @userId
          AND token IN (${placeholders})
      `).all(tokenParams)
    : [];

  const rowByToken = new Map((rows || []).map((r) => [r.token, r]));
  return uploadTokens.map((token) => rowByToken.get(token)).filter(Boolean);
}

/**
 * Create a listing from resolved upload data
 * This is the core logic extracted from the POST /api/listings endpoint
 *
 * @param {Object} params - Listing parameters
 * @param {number} params.userId - User ID
 * @param {Array} params.uploads - Resolved upload records (from resolveUploadDrafts)
 * @param {string} params.title - Listing title
 * @param {string} params.description - Listing description
 * @param {string} params.location - Location string
 * @param {number} params.price - Price in dollars
 * @param {string|string[]} params.tags - Tags
 * @param {boolean} params.enableNearby - Enable nearby posting
 * @param {boolean} params.inquiryEnabled - Enable inquiry mode
 * @param {number|null} params.lat - Latitude (if enableNearby)
 * @param {number|null} params.lon - Longitude (if enableNearby)
 * @param {Function} params.canonicalAssetUrl - URL canonicalization function
 * @param {Function} params.isAllowedPublicUrl - URL validation function
 * @param {Function} params.maybeUpdateListingGeography - Geography update function
 * @param {Function} params.incrementCityCount - City count update function
 * @returns {Promise<Object>} - Created listing
 */
async function createListingFromUploads({
  userId,
  uploads,
  title,
  description,
  location,
  price,
  tags,
  enableNearby,
  inquiryEnabled,
  lat,
  lon,
  canonicalAssetUrl,
  isAllowedPublicUrl,
  maybeUpdateListingGeography,
  incrementCityCount
}) {
  const descStr = String(description ?? '').slice(0, 400);
  const locStr = String(location ?? '').slice(0, 80);
  const pNum = Number(price);
  const safePrice = (Number.isFinite(pNum) && pNum >= 0) ? pNum : 0;
  const tagStr = normalizeTags(tags);
  const safeTitle = shortTitle(title) || shortTitle(description);
  const enNearby = enableNearby ? 1 : 0;
  const inquiryEnabledInt = inquiryEnabled ? 1 : 0;

  // Validate lat/lon only if nearby is enabled
  let safeLat = null;
  let safeLon = null;
  if (enNearby) {
    safeLat = Number.isFinite(Number(lat)) ? Number(lat) : null;
    safeLon = Number.isFinite(Number(lon)) ? Number(lon) : null;
  }

  // Process uploads
  const processedUploads = uploads.map((r) => {
    const safeWidth = Number(r?.width);
    const safeHeight = Number(r?.height);
    const safeBytes = Number(r?.bytes);
    const createdAt = Number.isFinite(Number(r?.created_at)) ? Number(r.created_at) : Math.floor(Date.now() / 1000);
    const url = canonicalAssetUrl(String(r?.url || ''));
    return {
      token: r?.token,
      key: String(r?.key || ''),
      url,
      width: Number.isFinite(safeWidth) ? safeWidth : null,
      height: Number.isFinite(safeHeight) ? safeHeight : null,
      bytes: Number.isFinite(safeBytes) ? safeBytes : null,
      createdAt
    };
  }).filter((item) => typeof item.url === 'string' && item.url && isAllowedPublicUrl(item.url));

  if (!processedUploads.length) {
    const err = new Error('image_required');
    err.code = 'image_required';
    throw err;
  }

  // Insert listing
  const info = await db.prepare(`
    INSERT INTO listings (user_id, image_data, title, description, location, price, created_at, tags, lat, lon, enable_nearby, inquiry_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    null,
    String(safeTitle),
    String(descStr),
    String(locStr),
    Number(safePrice),
    nowIso(),
    tagStr,
    safeLat, safeLon, enNearby, inquiryEnabledInt
  );

  const listingId = info.lastInsertRowid;

  if (maybeUpdateListingGeography) {
    await maybeUpdateListingGeography(listingId, safeLat, safeLon);
  }

  // Insert images
  if (processedUploads.length) {
    const pRow = await db.prepare('SELECT MAX(position) AS maxp FROM listing_images WHERE listing_id = ?').get(listingId);
    let pos = Number.isFinite(pRow?.maxp) ? (pRow.maxp + 1) : 0;
    let coverUrl = null;

    for (const upload of processedUploads) {
      await db.prepare(`
        INSERT INTO listing_images (listing_id, image_data, position, key, url, width, height, bytes, created_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        listingId,
        pos,
        upload.key,
        upload.url,
        upload.width,
        upload.height,
        upload.bytes,
        upload.createdAt
      );
      if (!coverUrl) coverUrl = upload.url;
      pos += 1;
    }

    if (coverUrl) {
      await db.prepare(`
        UPDATE listings
           SET image_data = COALESCE(NULLIF(image_data, ''), @url)
         WHERE id = @listingId
      `).run({ listingId, url: coverUrl });
    }

    // Clean up draft tokens
    const tokensToDelete = processedUploads.map((item) => item.token).filter(Boolean);
    if (tokensToDelete.length) {
      const deleteParams = { userId };
      const deletePlaceholders = tokensToDelete.map((token, idx) => {
        const key = `d${idx}`;
        deleteParams[key] = token;
        return `@${key}`;
      }).join(', ');
      if (deletePlaceholders) {
        await db.prepare(`
          DELETE FROM listing_upload_drafts
           WHERE user_id = @userId
             AND token IN (${deletePlaceholders})
        `).run(deleteParams);
      }
    }
  }

  if (incrementCityCount) {
    try { await incrementCityCount(locStr); } catch { }
  }

  // Fetch and return created listing
  const row = await db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
  if (row && Object.prototype.hasOwnProperty.call(row, 'image_data')) {
    row.image_data = canonicalAssetUrl(row.image_data);
  }

  return row;
}

module.exports = {
  normalizeTags,
  shortTitle,
  fallbackTagsFromTitleDesc,
  synthesizeListingDescription,
  nowIso,
  resolveUploadDrafts,
  createListingFromUploads
};

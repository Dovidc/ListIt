// s3.js
'use strict';

const crypto = require('crypto');
let S3Client, PutObjectCommand, GetObjectCommand;
let getSignedUrl;
let _s3 = null;

// Magic byte signatures for validating image file headers
const MAGIC_BYTES = {
  // JPEG: FF D8 FF
  jpeg: { bytes: [0xFF, 0xD8, 0xFF], offset: 0 },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  png: { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0 },
  // GIF: 47 49 46 38 (GIF8)
  gif: { bytes: [0x47, 0x49, 0x46, 0x38], offset: 0 },
  // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
  webp: { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, secondCheck: { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 } },
  // HEIC/HEIF: ....ftyp at offset 4
  heic: { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  // AVIF: ....ftyp at offset 4 (same container as HEIC)
  avif: { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  // MP4: ....ftyp at offset 4
  mp4: { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }
};

/**
 * Validate that buffer's magic bytes match the claimed content type
 * @param {Buffer} buffer - The file buffer to validate
 * @param {string} contentType - The claimed MIME type
 * @returns {boolean} - True if valid, false if magic bytes don't match
 */
function validateMagicBytes(buffer, contentType) {
  if (!buffer || buffer.length < 12) return false;

  const type = contentType.toLowerCase();
  let signatures = [];

  if (type.includes('jpeg') || type.includes('jpg')) {
    signatures = [MAGIC_BYTES.jpeg];
  } else if (type.includes('png')) {
    signatures = [MAGIC_BYTES.png];
  } else if (type.includes('gif')) {
    signatures = [MAGIC_BYTES.gif];
  } else if (type.includes('webp')) {
    signatures = [MAGIC_BYTES.webp];
  } else if (type.includes('heic') || type.includes('heif')) {
    signatures = [MAGIC_BYTES.heic];
  } else if (type.includes('avif')) {
    signatures = [MAGIC_BYTES.avif];
  } else if (type.includes('mp4')) {
    signatures = [MAGIC_BYTES.mp4];
  } else {
    return false; // Unknown type
  }

  for (const sig of signatures) {
    let match = true;

    // Check primary bytes
    for (let i = 0; i < sig.bytes.length; i++) {
      if (buffer[sig.offset + i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }

    // Check secondary bytes if present (e.g., WebP)
    if (match && sig.secondCheck) {
      for (let i = 0; i < sig.secondCheck.bytes.length; i++) {
        if (buffer[sig.secondCheck.offset + i] !== sig.secondCheck.bytes[i]) {
          match = false;
          break;
        }
      }
    }

    if (match) return true;
  }

  return false;
}

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function getS3() {
  if (!_s3) {
    // Load AWS SDKs only when needed
    ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
    ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
    const region = process.env.AWS_REGION || process.env.S3_REGION;
    if (!region) throw new Error('Missing env AWS_REGION (or S3_REGION)');
    _s3 = new S3Client({ region });
  }
  return _s3;
}

function newKey(filename = 'upload.bin') {
  const ext = (filename.split('.').pop() || 'bin').toLowerCase();
  const id = crypto.randomBytes(16).toString('hex');
  const d = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const prefix = process.env.S3_PREFIX || 'public/uploads';
  return `${prefix}/${d}/${id}.${ext}`;
}

async function presignUpload({ filename = 'upload.bin', contentType, bytes = 0 } = {}) {
  const s3 = getS3(); // validates AWS_REGION
  const Bucket = need('S3_BUCKET');
  const region = process.env.AWS_REGION || process.env.S3_REGION;
  const PUBLIC_BASE = (process.env.PUBLIC_ASSET_BASE || '').trim(); // optional

  const imageRegex = /^image\/(png|jpe?g|webp|avif|heic|heif|gif)$/i;
  const videoRegex = /^video\/mp4$/i;
  const maxImageBytes = (+process.env.MAX_IMAGE_MB || 20) * 1024 * 1024;
  const maxVideoBytes = (+process.env.MAX_VIDEO_MB || 10) * 1024 * 1024;

  let cacheControl = 'public, max-age=31536000, immutable';

  if (imageRegex.test(contentType)) {
    if (bytes > maxImageBytes) throw new Error('Image too large');
  } else if (videoRegex.test(contentType)) {
    if (bytes > maxVideoBytes) throw new Error('Video too large');
  } else {
    throw new Error('Unsupported type');
  }
  const Key = newKey(filename);
  const cmd = new PutObjectCommand({
    Bucket,
    Key,
    ContentType: contentType,
    CacheControl: cacheControl,
  });

  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 });
  const base = PUBLIC_BASE || `https://${Bucket}.s3.${region}.amazonaws.com`;
  const publicUrl = `${base.replace(/\/+$/,'')}/${Key}`;
  return { Bucket, Key, uploadUrl, publicUrl };
}

function normalizeKey(key = '') {
  if (typeof key !== 'string') throw new Error('Invalid key');
  const trimmed = key.trim();
  if (!trimmed) throw new Error('Missing key');
  if (trimmed.includes('..')) throw new Error('Invalid key');
  return trimmed.replace(/^\/+/, '');
}

async function presignDownload({ key, expiresIn = 120 } = {}) {
  const s3 = getS3();
  const Bucket = need('S3_BUCKET');
  if (!GetObjectCommand) {
    ({ GetObjectCommand } = require('@aws-sdk/client-s3'));
  }
  const Key = normalizeKey(key);
  const cmd = new GetObjectCommand({ Bucket, Key });
  return await getSignedUrl(s3, cmd, { expiresIn });
}

/**
 * Upload a buffer directly to S3 from the server.
 * Used for fire-and-forget listing creation where we want to
 * receive the image on our server first (fast) then upload to S3 (async).
 */
async function uploadBuffer({ buffer, filename = 'upload.bin', contentType }) {
  const s3 = getS3();
  const Bucket = need('S3_BUCKET');
  const region = process.env.AWS_REGION || process.env.S3_REGION;
  const PUBLIC_BASE = (process.env.PUBLIC_ASSET_BASE || '').trim();

  const imageRegex = /^image\/(png|jpe?g|webp|avif|heic|heif|gif)$/i;
  if (!imageRegex.test(contentType)) {
    throw new Error('Unsupported type');
  }

  const maxImageBytes = (+process.env.MAX_IMAGE_MB || 20) * 1024 * 1024;
  if (buffer.length > maxImageBytes) {
    throw new Error('Image too large');
  }

  // Validate magic bytes to ensure file content matches claimed type
  if (!validateMagicBytes(buffer, contentType)) {
    throw new Error('Invalid file: content does not match declared type');
  }

  const Key = newKey(filename);
  const cmd = new PutObjectCommand({
    Bucket,
    Key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  });

  await s3.send(cmd);

  const base = PUBLIC_BASE || `https://${Bucket}.s3.${region}.amazonaws.com`;
  const publicUrl = `${base.replace(/\/+$/, '')}/${Key}`;
  return { Bucket, Key, publicUrl };
}

module.exports = { presignUpload, presignDownload, uploadBuffer };

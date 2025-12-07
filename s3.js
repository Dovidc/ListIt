// s3.js
'use strict';

const crypto = require('crypto');
let S3Client, PutObjectCommand, GetObjectCommand;
let getSignedUrl;
let _s3 = null;

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

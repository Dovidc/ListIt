// s3.js
'use strict';

const crypto = require('crypto');
let S3Client, PutObjectCommand, GetObjectCommand;
let getSignedUrl;
let _s3 = null;

const MAX_AWS_TTL = 60 * 60 * 24 * 7; // 7 days per AWS limitation

function parseTtl(value, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(num, MAX_AWS_TTL);
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

  const max = (+process.env.MAX_IMAGE_MB || 20) * 1024 * 1024;
  if (bytes > max) throw new Error('Image too large');
  if (!/^image\/(png|jpe?g|webp|avif|heic|heif|gif)$/i.test(contentType)) throw new Error('Unsupported type');
  const Key = newKey(filename);
  const cmd = new PutObjectCommand({
    Bucket,
    Key,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  });

  const uploadTtl = parseTtl(process.env.S3_UPLOAD_TTL, 300);
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: uploadTtl });
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

async function presignDownload({ key, expiresIn } = {}) {
  const s3 = getS3();
  const Bucket = need('S3_BUCKET');
  if (!GetObjectCommand) {
    ({ GetObjectCommand } = require('@aws-sdk/client-s3'));
  }
  const Key = normalizeKey(key);
  const cmd = new GetObjectCommand({ Bucket, Key });
  const downloadTtl = parseTtl(expiresIn ?? process.env.S3_DOWNLOAD_TTL, 900);
  return await getSignedUrl(s3, cmd, { expiresIn: downloadTtl });
}

module.exports = { presignUpload, presignDownload };

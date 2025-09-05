// s3.js
'use strict';

const crypto = require('crypto');
let S3Client, PutObjectCommand;
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
    _s3 = new S3Client({ region: need('AWS_REGION') });
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
  const PUBLIC_BASE = need('PUBLIC_ASSET_BASE');

  const max = (+process.env.MAX_IMAGE_MB || 20) * 1024 * 1024;
  if (bytes > max) throw new Error('Image too large');
  if (!/^image\/(png|jpe?g|webp|avif|heic|heif)$/i.test(contentType)) throw new Error('Unsupported type');

  const Key = newKey(filename);
  const cmd = new PutObjectCommand({
    Bucket,
    Key,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  });

  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 });
  const publicUrl = `${PUBLIC_BASE}/${Key}`;
  return { Bucket, Key, uploadUrl, publicUrl };
}

module.exports = { presignUpload };

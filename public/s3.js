// s3.js
'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const REGION = need('AWS_REGION');
const BUCKET = need('S3_BUCKET');
const PUBLIC_BASE = need('PUBLIC_ASSET_BASE');
const PREFIX = process.env.S3_PREFIX || 'public/uploads';

const s3 = new S3Client({ region: REGION });

function newKey(filename = 'upload.bin') {
  const ext = (filename.split('.').pop() || 'bin').toLowerCase();
  const id = crypto.randomBytes(16).toString('hex');
  const d = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${PREFIX}/${d}/${id}.${ext}`;
}

async function presignUpload({ filename = 'upload.bin', contentType, bytes = 0 }) {
  const max = (+process.env.MAX_IMAGE_MB || 10) * 1024 * 1024;
  if (bytes > max) throw new Error(`Image too large`);
  if (!/^image\/(png|jpe?g|webp|avif)$/i.test(contentType)) throw new Error('Unsupported type');

  const Key = newKey(filename);

  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  });

  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 });
  const publicUrl = `${PUBLIC_BASE}/${Key}`;
  return { Bucket: BUCKET, Key, uploadUrl, publicUrl };
}

module.exports = { presignUpload };

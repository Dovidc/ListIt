// s3.js
'use strict';

const crypto = require('crypto');
const https = require('https');

let S3Client, PutObjectCommand, GetObjectCommand;
let getSignedUrl;
let _s3Promise = null;
let _clockOffsetMs = 0;

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function detectAwsClockOffset(region) {
  const host = `s3.${region}.amazonaws.com`;
  return await new Promise((resolve) => {
    const request = https.request(
      {
        method: 'HEAD',
        host,
        path: '/',
        timeout: 1500,
      },
      (res) => {
        const header = res.headers['date'];
        if (!header) return resolve(0);
        const serverTime = Date.parse(header);
        if (!Number.isFinite(serverTime)) return resolve(0);
        const offset = serverTime - Date.now();
        if (Math.abs(offset) < 2000) return resolve(0);

        // Ignore obviously invalid offsets so we don't generate wildly future keys.
        const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000; // 15 minutes
        if (Math.abs(offset) > MAX_CLOCK_SKEW_MS) {
          console.warn('[S3] Ignoring unrealistic AWS clock skew (ms):', offset);
          return resolve(0);
        }
        resolve(offset);
      },
    );
    request.on('error', () => resolve(0));
    request.on('timeout', () => {
      request.destroy();
      resolve(0);
    });
    request.end();
  });
}

async function initS3() {
  // Load AWS SDKs only when needed
  ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
  const region = process.env.AWS_REGION || process.env.S3_REGION;
  if (!region) throw new Error('Missing env AWS_REGION (or S3_REGION)');
  _clockOffsetMs = await detectAwsClockOffset(region);
  if (_clockOffsetMs) {
    console.warn('[S3] Adjusting for detected AWS clock skew (ms):', _clockOffsetMs);
  }
  const config = _clockOffsetMs ? { region, systemClockOffset: _clockOffsetMs } : { region };
  return new S3Client(config);
}

async function getS3() {
  if (!_s3Promise) {
    _s3Promise = initS3().catch((err) => {
      _s3Promise = null;
      throw err;
    });
  }
  return _s3Promise;
}

function newKey(filename = 'upload.bin') {
  const ext = (filename.split('.').pop() || 'bin').toLowerCase();
  const id = crypto.randomBytes(16).toString('hex');
  const skewedNow = new Date(Date.now() + _clockOffsetMs);
  const d = skewedNow.toISOString().slice(0, 10); // YYYY-MM-DD
  const prefix = process.env.S3_PREFIX || 'public/uploads';
  return `${prefix}/${d}/${id}.${ext}`;
}

async function presignUpload({ filename = 'upload.bin', contentType, bytes = 0 } = {}) {
  const s3 = await getS3(); // validates AWS_REGION
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
  const s3 = await getS3();
  const Bucket = need('S3_BUCKET');
  if (!GetObjectCommand) {
    ({ GetObjectCommand } = require('@aws-sdk/client-s3'));
  }
  const Key = normalizeKey(key);
  const cmd = new GetObjectCommand({ Bucket, Key });
  return await getSignedUrl(s3, cmd, { expiresIn });
}

module.exports = { presignUpload, presignDownload };

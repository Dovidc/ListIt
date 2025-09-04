// s3.js
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const s3 = new S3Client({ region: process.env.AWS_REGION });

function newKey(filename) {
  const ext = (filename.split('.').pop() || 'bin').toLowerCase();
  const id = crypto.randomBytes(16).toString('hex');
  const d = new Date().toISOString().slice(0,10);
  // e.g. public/uploads/2025-09-04/abc123.jpg
  return `${process.env.S3_PREFIX}/${d}/${id}.${ext}`;
}

exports.presignUpload = async ({ filename, contentType, bytes }) => {
  const max = (+process.env.MAX_IMAGE_MB || 10) * 1024 * 1024;
  if (bytes > max) throw new Error('Image too large');
  if (!/^image\/(png|jpe?g|webp|avif)$/i.test(contentType)) throw new Error('Unsupported type');

  const Bucket = process.env.S3_BUCKET;
  const Key = newKey(filename);

  const cmd = new PutObjectCommand({
    Bucket, Key, ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable'
  });

  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 }); // 60s
  const publicUrl = `${process.env.PUBLIC_ASSET_BASE}/${Key}`;
  return { Bucket, Key, uploadUrl, publicUrl };
};

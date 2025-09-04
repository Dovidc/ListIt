const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const region = process.env.AWS_REGION || 'us-east-1';
const s3 = new S3Client({ region });

function newKey(filename) {
  const ext = (filename && filename.includes('.') ? filename.split('.').pop() : 'bin').toLowerCase();
  const id = crypto.randomBytes(16).toString('hex');
  const d = new Date().toISOString().slice(0,10);
  const prefix = (process.env.S3_PREFIX || 'public/uploads').replace(/\/+$/,'');
  // e.g. public/uploads/2025-09-04/abc123.jpg
  return `${prefix}/${d}/${id}.${ext}`;
}

exports.presignUpload = async ({ filename = 'upload.bin', contentType, bytes = 0 }) => {
  const max = (+process.env.MAX_IMAGE_MB || 10) * 1024 * 1024;
  if (!contentType) throw new Error('Unsupported type'); // align with server validation
  if (bytes > max) throw new Error('Image too large');
  if (!/^image\/(png|jpe?g|webp|avif)$/i.test(contentType)) throw new Error('Unsupported type');

  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw new Error('S3_BUCKET not set');

  const Key = newKey(filename);

  const cmd = new PutObjectCommand({
    Bucket, Key, ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable'
  });

  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 });

  // Construct a portable public URL (virtual-hosted–style)
  const publicUrl = `https://${Bucket}.s3.${region}.amazonaws.com/${Key}`;

  return { Bucket, Key, uploadUrl, publicUrl };
};

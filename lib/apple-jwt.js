/**
 * Apple JWT Verification
 *
 * Verifies JWTs signed by Apple using their public keys.
 * Used for App Store Server Notifications V2.
 */

const crypto = require('crypto');

// Cache for Apple's public keys
let cachedKeys = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch Apple's public keys from their JWKS endpoint
 * Keys are cached for 1 hour to avoid repeated requests
 */
async function getApplePublicKeys() {
  const now = Date.now();

  if (cachedKeys && now < cacheExpiry) {
    return cachedKeys;
  }

  console.log('[Apple JWT] Fetching public keys from Apple...');

  const response = await fetch('https://appleid.apple.com/auth/keys');
  if (!response.ok) {
    throw new Error(`Failed to fetch Apple keys: ${response.status}`);
  }

  const data = await response.json();
  cachedKeys = data.keys;
  cacheExpiry = now + CACHE_TTL_MS;

  console.log(`[Apple JWT] Cached ${cachedKeys.length} public keys`);
  return cachedKeys;
}

/**
 * Convert a JWK (JSON Web Key) to PEM format for Node's crypto
 */
function jwkToPem(jwk) {
  // For RSA keys, we need to convert n (modulus) and e (exponent) to PEM
  const keyObject = crypto.createPublicKey({
    key: {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e
    },
    format: 'jwk'
  });

  return keyObject.export({ type: 'spki', format: 'pem' });
}

/**
 * Verify an Apple-signed JWT
 *
 * @param {string} jwt - The signed JWT from Apple
 * @returns {object} - The verified payload
 * @throws {Error} - If verification fails
 */
async function verifyAppleJWT(jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to get the key ID (kid)
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  const { kid, alg } = header;

  if (!kid) {
    throw new Error('JWT header missing kid');
  }

  if (alg !== 'ES256' && alg !== 'RS256') {
    throw new Error(`Unsupported algorithm: ${alg}`);
  }

  // Fetch Apple's public keys and find the matching one
  const keys = await getApplePublicKeys();
  const key = keys.find(k => k.kid === kid);

  if (!key) {
    // Key not found - maybe Apple rotated keys, clear cache and retry once
    cachedKeys = null;
    cacheExpiry = 0;
    const freshKeys = await getApplePublicKeys();
    const freshKey = freshKeys.find(k => k.kid === kid);

    if (!freshKey) {
      throw new Error(`No matching key found for kid: ${kid}`);
    }

    return verifyWithKey(headerB64, payloadB64, signatureB64, freshKey, alg);
  }

  return verifyWithKey(headerB64, payloadB64, signatureB64, key, alg);
}

/**
 * Verify signature with a specific key
 */
function verifyWithKey(headerB64, payloadB64, signatureB64, key, alg) {
  const pem = jwkToPem(key);
  const signedContent = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, 'base64url');

  // Determine the algorithm for Node's crypto
  const algorithm = alg === 'ES256' ? 'SHA256' : 'RSA-SHA256';

  const isValid = crypto.verify(
    algorithm,
    Buffer.from(signedContent),
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_PADDING
    },
    signature
  );

  if (!isValid) {
    throw new Error('JWT signature verification failed');
  }

  // Signature valid - decode and return payload
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  return payload;
}

/**
 * Clear the key cache (useful for testing)
 */
function clearKeyCache() {
  cachedKeys = null;
  cacheExpiry = 0;
}

module.exports = {
  verifyAppleJWT,
  getApplePublicKeys,
  clearKeyCache
};

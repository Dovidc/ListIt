/**
 * eBay Integration Service
 *
 * Handles all eBay API interactions including:
 * - OAuth 2.0 authentication flow
 * - Inventory API operations (create, update, end listings)
 * - Webhook signature verification
 * - Token refresh management
 * - Category suggestions
 */

const crypto = require('crypto');

// eBay API endpoints
const EBAY_AUTH_URL = process.env.EBAY_SANDBOX === 'true'
  ? 'https://auth.sandbox.ebay.com'
  : 'https://auth.ebay.com';

const EBAY_API_URL = process.env.EBAY_SANDBOX === 'true'
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

// Required OAuth scopes for listing management
const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription'
];

// Token encryption key (from environment)
const TOKEN_ENCRYPTION_KEY = process.env.EBAY_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;

// Cache for eBay's public keys (for webhook verification)
let cachedPublicKeys = null;
let publicKeysCacheExpiry = 0;
const PUBLIC_KEYS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Condition mapping from Trovelr to eBay
const CONDITION_MAP = {
  'new': 'NEW',
  'like_new': 'LIKE_NEW',
  'excellent': 'USED_EXCELLENT',
  'very_good': 'USED_VERY_GOOD',
  'good': 'USED_GOOD',
  'acceptable': 'USED_ACCEPTABLE',
  'for_parts': 'FOR_PARTS_OR_NOT_WORKING'
};

/**
 * Encrypt a token for storage
 */
function encryptToken(token) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(TOKEN_ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0')), iv);

  let encrypted = cipher.update(token, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('base64'),
    encrypted,
    tag: authTag.toString('base64')
  });
}

/**
 * Decrypt a stored token
 */
function decryptToken(encryptedData) {
  const { iv, encrypted, tag } = JSON.parse(encryptedData);

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(TOKEN_ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0')),
    Buffer.from(iv, 'base64')
  );

  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generate OAuth state parameter with CSRF protection
 */
function generateOAuthState(userId) {
  const payload = {
    userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    timestamp: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
  };

  return encryptToken(JSON.stringify(payload));
}

/**
 * Validate OAuth state parameter
 */
function validateOAuthState(encryptedState, expectedUserId) {
  try {
    const decrypted = decryptToken(encryptedState);
    const payload = JSON.parse(decrypted);

    if (payload.userId !== expectedUserId) {
      console.error('[eBay OAuth] State userId mismatch');
      return false;
    }

    if (Date.now() > payload.expiresAt) {
      console.error('[eBay OAuth] State expired');
      return false;
    }

    return true;
  } catch (error) {
    console.error('[eBay OAuth] State validation error:', error.message);
    return false;
  }
}

/**
 * Generate the eBay OAuth authorization URL
 */
function getAuthorizationUrl(userId, redirectUri) {
  const state = generateOAuthState(userId);

  const authUrl = new URL(`${EBAY_AUTH_URL}/oauth2/authorize`);
  authUrl.searchParams.set('client_id', process.env.EBAY_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', EBAY_SCOPES.join(' '));
  authUrl.searchParams.set('state', state);

  return {
    url: authUrl.toString(),
    state
  };
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code, redirectUri) {
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(`${EBAY_API_URL}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[eBay OAuth] Token exchange failed:', error);
    throw new Error(`eBay token exchange failed: ${response.status}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    refreshTokenExpiresIn: data.refresh_token_expires_in,
    tokenType: data.token_type
  };
}

/**
 * Refresh an expired access token
 */
async function refreshAccessToken(refreshToken) {
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(`${EBAY_API_URL}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[eBay OAuth] Token refresh failed:', error);
    throw new Error(`eBay token refresh failed: ${response.status}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in
  };
}

/**
 * Get eBay user info (to retrieve eBay username)
 */
async function getEbayUserInfo(accessToken) {
  const response = await fetch(`${EBAY_API_URL}/commerce/identity/v1/user/`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[eBay] Failed to get user info:', error);
    throw new Error(`Failed to get eBay user info: ${response.status}`);
  }

  return response.json();
}

/**
 * Create or replace an inventory item on eBay
 */
async function createOrReplaceInventoryItem(accessToken, sku, inventoryItem) {
  const response = await fetch(
    `${EBAY_API_URL}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US'
      },
      body: JSON.stringify(inventoryItem)
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Create inventory item failed:', error);
    throw new EbayApiError('CREATE_INVENTORY_FAILED', error);
  }

  // 204 No Content on success
  return { success: true };
}

/**
 * Create an offer for an inventory item
 */
async function createOffer(accessToken, offer) {
  const response = await fetch(`${EBAY_API_URL}/sell/inventory/v1/offer`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US'
    },
    body: JSON.stringify(offer)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Create offer failed:', error);
    throw new EbayApiError('CREATE_OFFER_FAILED', error);
  }

  return response.json();
}

/**
 * Publish an offer (make listing live)
 */
async function publishOffer(accessToken, offerId) {
  const response = await fetch(
    `${EBAY_API_URL}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Publish offer failed:', error);
    throw new EbayApiError('PUBLISH_OFFER_FAILED', error);
  }

  return response.json();
}

/**
 * Withdraw an offer (end listing)
 */
async function withdrawOffer(accessToken, offerId) {
  const response = await fetch(
    `${EBAY_API_URL}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Withdraw offer failed:', error);
    throw new EbayApiError('WITHDRAW_OFFER_FAILED', error);
  }

  return { success: true };
}

/**
 * Update an existing offer (price, etc.)
 */
async function updateOffer(accessToken, offerId, offer) {
  const response = await fetch(
    `${EBAY_API_URL}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US'
      },
      body: JSON.stringify(offer)
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Update offer failed:', error);
    throw new EbayApiError('UPDATE_OFFER_FAILED', error);
  }

  return { success: true };
}

/**
 * Delete an inventory item
 */
async function deleteInventoryItem(accessToken, sku) {
  const response = await fetch(
    `${EBAY_API_URL}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok && response.status !== 404) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Delete inventory item failed:', error);
    throw new EbayApiError('DELETE_INVENTORY_FAILED', error);
  }

  return { success: true };
}

/**
 * Get category suggestions based on keywords
 */
async function getCategorySuggestions(accessToken, keywords) {
  const params = new URLSearchParams({
    q: keywords
  });

  const response = await fetch(
    `${EBAY_API_URL}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Get category suggestions failed:', error);
    throw new EbayApiError('CATEGORY_SUGGESTIONS_FAILED', error);
  }

  const data = await response.json();

  return (data.categorySuggestions || []).map(suggestion => ({
    categoryId: suggestion.category.categoryId,
    categoryName: suggestion.category.categoryName,
    categoryPath: suggestion.categoryTreeNodeAncestors
      ? suggestion.categoryTreeNodeAncestors
        .map(a => a.categoryName)
        .concat(suggestion.category.categoryName)
        .join(' > ')
      : suggestion.category.categoryName
  }));
}

/**
 * Get seller fulfillment policies
 */
async function getFulfillmentPolicies(accessToken, marketplaceId = 'EBAY_US') {
  const response = await fetch(
    `${EBAY_API_URL}/sell/account/v1/fulfillment_policy?marketplace_id=${marketplaceId}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Get fulfillment policies failed:', error);
    throw new EbayApiError('GET_POLICIES_FAILED', error);
  }

  return response.json();
}

/**
 * Get seller payment policies
 */
async function getPaymentPolicies(accessToken, marketplaceId = 'EBAY_US') {
  const response = await fetch(
    `${EBAY_API_URL}/sell/account/v1/payment_policy?marketplace_id=${marketplaceId}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Get payment policies failed:', error);
    throw new EbayApiError('GET_POLICIES_FAILED', error);
  }

  return response.json();
}

/**
 * Get seller return policies
 */
async function getReturnPolicies(accessToken, marketplaceId = 'EBAY_US') {
  const response = await fetch(
    `${EBAY_API_URL}/sell/account/v1/return_policy?marketplace_id=${marketplaceId}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    console.error('[eBay] Get return policies failed:', error);
    throw new EbayApiError('GET_POLICIES_FAILED', error);
  }

  return response.json();
}

/**
 * Get eBay's public keys for webhook signature verification
 */
async function getEbayPublicKeys() {
  const now = Date.now();

  if (cachedPublicKeys && now < publicKeysCacheExpiry) {
    return cachedPublicKeys;
  }

  console.log('[eBay Webhook] Fetching public keys...');

  const response = await fetch(
    `${EBAY_API_URL}/commerce/notification/v1/public_key`,
    {
      headers: {
        'Accept': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch eBay public keys: ${response.status}`);
  }

  const data = await response.json();
  cachedPublicKeys = data;
  publicKeysCacheExpiry = now + PUBLIC_KEYS_CACHE_TTL_MS;

  console.log('[eBay Webhook] Public keys cached');
  return cachedPublicKeys;
}

/**
 * Verify eBay webhook signature
 */
async function verifyWebhookSignature(payload, signatureHeader) {
  try {
    // eBay signature format: base64(signature)
    // The signature is over the raw request body

    // Get the public key
    const keys = await getEbayPublicKeys();

    // Compute expected signature
    const expectedSignature = crypto
      .createVerify('SHA256')
      .update(payload)
      .verify(keys.publicKey, Buffer.from(signatureHeader, 'base64'));

    return expectedSignature;
  } catch (error) {
    console.error('[eBay Webhook] Signature verification failed:', error.message);
    return false;
  }
}

/**
 * Map Trovelr condition to eBay condition
 */
function mapConditionToEbay(trovelrCondition) {
  return CONDITION_MAP[trovelrCondition?.toLowerCase()] || 'USED_GOOD';
}

/**
 * Map eBay condition to Trovelr condition
 */
function mapConditionFromEbay(ebayCondition) {
  const reverseMap = Object.fromEntries(
    Object.entries(CONDITION_MAP).map(([k, v]) => [v, k])
  );
  return reverseMap[ebayCondition] || 'good';
}

/**
 * Truncate title to eBay's 80 character limit
 */
function truncateTitle(title, maxLength = 80) {
  if (!title) return '';
  if (title.length <= maxLength) return title;

  // Try to truncate at a word boundary
  const truncated = title.substring(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.7) {
    return truncated.substring(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Build an inventory item payload from a Trovelr listing
 * @param {Object} listing - The Trovelr listing
 * @param {Array} images - Array of image objects with url property
 * @param {Object} [packageInfo] - Optional package weight and dimensions
 * @param {Object} [packageInfo.weight] - Weight object { value: number, unit: 'POUND'|'OUNCE'|'KILOGRAM'|'GRAM' }
 * @param {Object} [packageInfo.dimensions] - Dimensions { length, width, height, unit: 'INCH'|'CENTIMETER' }
 */
function buildInventoryItem(listing, images, packageInfo) {
  const item = {
    availability: {
      shipToLocationAvailability: {
        quantity: listing.sold ? 0 : 1
      }
    },
    condition: mapConditionToEbay(listing.condition),
    product: {
      title: truncateTitle(listing.title),
      description: listing.description || '',
      imageUrls: (images || []).slice(0, 12).map(img => img.url).filter(Boolean)
    }
  };

  // Add package weight and size if provided (required for calculated shipping)
  if (packageInfo && (packageInfo.weight || packageInfo.dimensions)) {
    item.packageWeightAndSize = {};

    if (packageInfo.weight && packageInfo.weight.value > 0) {
      item.packageWeightAndSize.weight = {
        value: packageInfo.weight.value,
        unit: packageInfo.weight.unit || 'POUND'
      };
    }

    if (packageInfo.dimensions) {
      const dims = packageInfo.dimensions;
      if (dims.length > 0 && dims.width > 0 && dims.height > 0) {
        item.packageWeightAndSize.dimensions = {
          length: dims.length,
          width: dims.width,
          height: dims.height,
          unit: dims.unit || 'INCH'
        };
      }
    }
  }

  return item;
}

/**
 * Build an offer payload
 */
function buildOffer(sku, categoryId, price, fulfillmentPolicyId, paymentPolicyId, returnPolicyId, marketplaceId = 'EBAY_US') {
  return {
    sku,
    marketplaceId,
    format: 'FIXED_PRICE',
    listingDuration: 'GTC', // Good 'Til Cancelled
    availableQuantity: 1,
    categoryId,
    pricingSummary: {
      price: {
        value: price.toString(),
        currency: 'USD'
      }
    },
    listingPolicies: {
      fulfillmentPolicyId,
      paymentPolicyId,
      returnPolicyId
    }
  };
}

/**
 * Custom error class for eBay API errors
 */
class EbayApiError extends Error {
  constructor(code, details) {
    super(details?.message || details?.errors?.[0]?.message || code);
    this.name = 'EbayApiError';
    this.code = code;
    this.details = details;
    this.retryable = this.isRetryable(details);
  }

  isRetryable(details) {
    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
    const retryableCodes = ['SERVICE_UNAVAILABLE', 'TOO_MANY_REQUESTS', 'INTERNAL_ERROR'];

    if (details?.httpStatusCode && retryableStatusCodes.includes(details.httpStatusCode)) {
      return true;
    }

    if (details?.errors?.some(e => retryableCodes.includes(e.errorId))) {
      return true;
    }

    return false;
  }
}

/**
 * Execute an eBay API call with retry logic
 */
async function withRetry(operation, options = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    context = {}
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const isRetryable = error instanceof EbayApiError ? error.retryable : false;
      const isLastAttempt = attempt === maxRetries;

      if (!isRetryable || isLastAttempt) {
        console.error('[eBay] API call failed', {
          ...context,
          attempt,
          error: error.message,
          retryable: isRetryable
        });
        throw error;
      }

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt),
        maxDelayMs
      );

      console.warn('[eBay] API call failed, retrying', {
        ...context,
        attempt,
        nextRetryInMs: delay,
        error: error.message
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

module.exports = {
  // OAuth
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  validateOAuthState,
  generateOAuthState,

  // Token encryption
  encryptToken,
  decryptToken,

  // User info
  getEbayUserInfo,

  // Inventory API
  createOrReplaceInventoryItem,
  createOffer,
  publishOffer,
  withdrawOffer,
  updateOffer,
  deleteInventoryItem,

  // Category & Taxonomy
  getCategorySuggestions,

  // Seller policies
  getFulfillmentPolicies,
  getPaymentPolicies,
  getReturnPolicies,

  // Webhook
  verifyWebhookSignature,
  getEbayPublicKeys,

  // Helpers
  mapConditionToEbay,
  mapConditionFromEbay,
  truncateTitle,
  buildInventoryItem,
  buildOffer,

  // Retry utility
  withRetry,

  // Error class
  EbayApiError,

  // Constants
  EBAY_API_URL,
  EBAY_AUTH_URL,
  EBAY_SCOPES
};

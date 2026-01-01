const db = require('../db-wrapper');
const path = require('path');

let apn;
try {
  apn = require('apn');
} catch (err) {
  console.warn('[push] apn module unavailable:', err?.message || err);
}

let firebaseAdmin;
try {
  firebaseAdmin = require('firebase-admin');
} catch (err) {
  console.warn('[push] firebase-admin module unavailable:', err?.message || err);
}

const IS_TEST = process.env.NODE_ENV === 'test';

// APNs configuration from environment
const APNS_KEY_ID = (process.env.APNS_KEY_ID || '').trim();
const APNS_TEAM_ID = (process.env.APNS_TEAM_ID || '').trim();
const APNS_KEY_PATH = (process.env.APNS_KEY_PATH || '').trim();
const APNS_KEY_CONTENT = (process.env.APNS_KEY_CONTENT || '').trim();
const APNS_BUNDLE_ID = (process.env.APNS_BUNDLE_ID || '').trim();
const APNS_PRODUCTION = process.env.APNS_PRODUCTION === 'true' || process.env.NODE_ENV === 'production';

// Firebase configuration
const FIREBASE_SERVICE_ACCOUNT_PATH = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();

// Token management
const IOS_PUSH_MAX_PER_USER = Math.max(1, Number(process.env.IOS_PUSH_MAX_PER_USER || 5));

let apnProvider = null;
let IOS_PUSH_AVAILABLE = false;
let FCM_AVAILABLE = false;

// Initialize APNs provider
function initApnProvider() {
  if (!apn) return false;
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID) return false;
  if (!APNS_KEY_PATH && !APNS_KEY_CONTENT) return false;

  try {
    const options = {
      token: {
        key: APNS_KEY_CONTENT || APNS_KEY_PATH,
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID
      },
      production: APNS_PRODUCTION
    };

    apnProvider = new apn.Provider(options);
    console.log('[push] APNs provider initialized (production:', APNS_PRODUCTION, ')');
    return true;
  } catch (err) {
    console.error('[push] Failed to initialize APNs provider:', err);
    return false;
  }
}

// Initialize Firebase Admin SDK for FCM
function initFirebaseAdmin() {
  if (!firebaseAdmin) return false;

  try {
    // Check if already initialized
    if (firebaseAdmin.apps.length > 0) {
      console.log('[push] Firebase Admin already initialized');
      return true;
    }

    // Try to load service account from path or default location
    let serviceAccountPath = FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!serviceAccountPath) {
      // Try default location in project root
      serviceAccountPath = path.join(process.cwd(), 'firebase-service-account.json');
    }

    try {
      const serviceAccount = require(serviceAccountPath);
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      console.log('[push] Firebase Admin initialized with service account, project:', serviceAccount.project_id);
      return true;
    } catch (fileErr) {
      // Try using application default credentials (for cloud environments)
      try {
        firebaseAdmin.initializeApp({
          credential: firebaseAdmin.credential.applicationDefault()
        });
        console.log('[push] Firebase Admin initialized with application default credentials');
        return true;
      } catch (defaultErr) {
        console.warn('[push] Firebase Admin initialization failed:', fileErr?.message || fileErr);
        return false;
      }
    }
  } catch (err) {
    console.error('[push] Failed to initialize Firebase Admin:', err);
    return false;
  }
}

console.log('[push] === Push Service Loading ===');
console.log('[push] APNs config check:', {
  hasApnModule: !!apn,
  hasKeyId: !!APNS_KEY_ID,
  hasTeamId: !!APNS_TEAM_ID,
  hasBundleId: !!APNS_BUNDLE_ID,
  hasKeyPath: !!APNS_KEY_PATH,
  hasKeyContent: !!APNS_KEY_CONTENT,
  production: APNS_PRODUCTION
});
console.log('[push] Firebase config check:', {
  hasFirebaseAdmin: !!firebaseAdmin,
  hasServiceAccountPath: !!FIREBASE_SERVICE_ACCOUNT_PATH
});

IOS_PUSH_AVAILABLE = initApnProvider();
FCM_AVAILABLE = initFirebaseAdmin();

console.log('[push] IOS_PUSH_AVAILABLE:', IOS_PUSH_AVAILABLE);
console.log('[push] FCM_AVAILABLE:', FCM_AVAILABLE);

if (!IOS_PUSH_AVAILABLE && !IS_TEST) {
  if (!apn) {
    console.warn('[push] iOS push disabled: apn module missing');
  } else if (!APNS_KEY_ID || !APNS_TEAM_ID) {
    console.warn('[push] iOS push disabled: APNS_KEY_ID or APNS_TEAM_ID not provided');
  } else if (!APNS_KEY_PATH && !APNS_KEY_CONTENT) {
    console.warn('[push] iOS push disabled: APNS_KEY_PATH or APNS_KEY_CONTENT not provided');
  } else if (!APNS_BUNDLE_ID) {
    console.warn('[push] iOS push disabled: APNS_BUNDLE_ID not provided');
  }
}

if (!FCM_AVAILABLE && !IS_TEST) {
  console.warn('[push] Android push disabled: Firebase Admin not initialized');
}

function nowIso() {
  return new Date().toISOString();
}

function isIosPushAvailable() {
  return Boolean(IOS_PUSH_AVAILABLE);
}

function isFcmAvailable() {
  return Boolean(FCM_AVAILABLE);
}

function isNativePushAvailable() {
  return IOS_PUSH_AVAILABLE || FCM_AVAILABLE;
}

// Save iOS/Android device token for a user
async function saveIosToken(userId, token, platform = 'ios') {
  if (!token || typeof token !== 'string') return;
  const now = nowIso();

  await db.prepare(`
    INSERT INTO ios_push_tokens (user_id, token, platform, created_at, updated_at)
    VALUES (@userId, @token, @platform, @now, @now)
    ON CONFLICT(token) DO UPDATE SET
      user_id = excluded.user_id,
      platform = excluded.platform,
      updated_at = excluded.updated_at,
      fail_count = 0,
      last_error = NULL
  `).run({ userId, token, platform, now });

  // Limit tokens per user
  await db.prepare(`
    DELETE FROM ios_push_tokens
     WHERE user_id = @userId
       AND id NOT IN (
         SELECT id FROM ios_push_tokens
          WHERE user_id = @userId
          ORDER BY updated_at DESC
          LIMIT @limit
       )
  `).run({ userId, limit: IOS_PUSH_MAX_PER_USER });
}

// Remove iOS/Android device token
async function deleteIosToken(userId, token) {
  if (!token) return;
  await db.prepare(
    'DELETE FROM ios_push_tokens WHERE user_id = ? AND token = ?'
  ).run(userId, token);
}

// Get all tokens for a user
async function getIosTokensForUser(userId, limit = IOS_PUSH_MAX_PER_USER) {
  return await db.prepare(`
    SELECT id, token, platform
      FROM ios_push_tokens
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT ?
  `).all(userId, Math.max(1, limit));
}

// Handle push delivery failure
async function handleDeliveryFailure(tokenRow, error) {
  try {
    const reason = error?.reason || error?.code || error?.message || 'unknown';
    // Fatal errors for both APNs and FCM
    const fatalReasons = [
      'BadDeviceToken', 'Unregistered', 'ExpiredProviderToken', // APNs
      'messaging/invalid-registration-token', 'messaging/registration-token-not-registered' // FCM
    ];
    const fatal = fatalReasons.some(r => String(reason).includes(r));

    if (fatal) {
      await db.prepare('DELETE FROM ios_push_tokens WHERE id = ?').run(tokenRow.id);
      console.log('[push] Removed invalid token:', tokenRow.id);
      return;
    }

    await db.prepare(`
      UPDATE ios_push_tokens
         SET fail_count = fail_count + 1,
             last_error = @err
       WHERE id = @id
    `).run({ id: tokenRow.id, err: String(reason).slice(0, 255) });
  } catch (err) {
    console.warn('[push] failed to mark delivery error:', err);
  }
}

// Send push via APNs (iOS)
async function sendApnsPush(tokenRow, payload) {
  if (!IOS_PUSH_AVAILABLE || !apnProvider) return false;

  const notification = new apn.Notification();
  notification.topic = APNS_BUNDLE_ID;
  notification.expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  notification.sound = 'notification.caf';

  // Handle different payload types
  if (payload.type === 'message') {
    notification.alert = {
      title: payload.senderName || 'New Message',
      body: payload.body || 'You have a new message'
    };
    notification.badge = payload.unreadCount || 1;
    notification.payload = {
      type: 'message',
      conversation_id: payload.conversationId,
      sender_id: payload.senderId
    };
  } else if (payload.type === 'nearby_listing') {
    notification.alert = {
      title: 'New Item Nearby',
      body: payload.title ? `${payload.title} - $${payload.price}` : 'A new item was posted near you'
    };
    notification.payload = {
      type: 'nearby_listing',
      listing_id: payload.listingId
    };
  } else {
    notification.alert = payload.alert || payload.title || 'Notification';
    if (payload.body) {
      notification.alert = { title: payload.title || 'Trovelr', body: payload.body };
    }
    notification.payload = payload.data || {};
  }

  try {
    console.log('[push] Sending APNs to token:', tokenRow.token?.substring(0, 20) + '...');
    const result = await apnProvider.send(notification, tokenRow.token);

    console.log('[push] APNs result:', { sent: result.sent?.length || 0, failed: result.failed?.length || 0 });

    if (result.failed && result.failed.length > 0) {
      for (const failure of result.failed) {
        console.error('[push] APNs delivery failed:', failure.response);
        await handleDeliveryFailure(tokenRow, failure.response);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error('[push] APNs send failed:', err);
    await handleDeliveryFailure(tokenRow, err);
    return false;
  }
}

// Send push via FCM (Android)
async function sendFcmPush(tokenRow, payload) {
  if (!FCM_AVAILABLE || !firebaseAdmin) return false;

  // Build FCM message
  const message = {
    token: tokenRow.token,
    notification: {},
    data: {},
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'default'
      }
    }
  };

  // Handle different payload types
  if (payload.type === 'message') {
    message.notification = {
      title: payload.senderName || 'New Message',
      body: payload.body || 'You have a new message'
    };
    message.data = {
      type: 'message',
      conversation_id: String(payload.conversationId || ''),
      sender_id: String(payload.senderId || '')
    };
  } else if (payload.type === 'nearby_listing') {
    message.notification = {
      title: 'New Item Nearby',
      body: payload.title ? `${payload.title} - $${payload.price}` : 'A new item was posted near you'
    };
    message.data = {
      type: 'nearby_listing',
      listing_id: String(payload.listingId || '')
    };
  } else {
    message.notification = {
      title: payload.title || 'Trovelr',
      body: payload.body || payload.alert || 'You have a notification'
    };
    if (payload.data) {
      // Convert all values to strings (FCM requirement)
      for (const [key, value] of Object.entries(payload.data)) {
        message.data[key] = String(value);
      }
    }
  }

  try {
    console.log('[push] Sending FCM to token:', tokenRow.token?.substring(0, 20) + '...');
    const response = await firebaseAdmin.messaging().send(message);
    console.log('[push] FCM result:', response);
    return true;
  } catch (err) {
    console.error('[push] FCM send failed:', err?.code || err?.message || err);
    await handleDeliveryFailure(tokenRow, err);
    return false;
  }
}

// Send push notification to user (handles both iOS and Android)
async function sendIosPushToUser(userId, payload) {
  console.log('[push] sendPushToUser called:', { userId, payloadType: payload?.type, iosAvailable: IOS_PUSH_AVAILABLE, fcmAvailable: FCM_AVAILABLE });

  if (!IOS_PUSH_AVAILABLE && !FCM_AVAILABLE) {
    console.log('[push] Skipping - no push providers available');
    return;
  }

  const tokens = await getIosTokensForUser(userId);
  console.log('[push] Found tokens for user:', { userId, tokenCount: tokens.length });

  if (!tokens.length) {
    console.log('[push] No tokens found for user', userId);
    return;
  }

  // Send to all user's devices
  for (const tokenRow of tokens) {
    if (tokenRow.platform === 'android') {
      await sendFcmPush(tokenRow, payload);
    } else {
      // Default to iOS/APNs
      await sendApnsPush(tokenRow, payload);
    }
  }
}

// Broadcast to all devices (for nearby listings, etc.)
async function broadcastIosPush(payload, options = {}) {
  if (!IOS_PUSH_AVAILABLE && !FCM_AVAILABLE) return;

  const limit = Math.max(1, Number(options.limit || 200));
  const excludeUserId = options.excludeUserId ?? null;

  const tokens = await db.prepare(`
    SELECT id, user_id, token, platform
      FROM ios_push_tokens
     WHERE (@exclude IS NULL OR user_id <> @exclude)
     ORDER BY updated_at DESC
     LIMIT @limit
  `).all({ exclude: excludeUserId, limit });

  if (!tokens.length) return;

  for (const tokenRow of tokens) {
    if (tokenRow.platform === 'android') {
      await sendFcmPush(tokenRow, payload);
    } else {
      await sendApnsPush(tokenRow, payload);
    }
  }
}

// Cleanup stale tokens
async function cleanupStaleIosTokens() {
  if (!IOS_PUSH_AVAILABLE && !FCM_AVAILABLE) return;
  const staleDays = 90;
  const maxFails = 3;
  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();

  try {
    await db.prepare(`
      DELETE FROM ios_push_tokens
       WHERE fail_count >= @maxFails
          OR updated_at < @cutoff
    `).run({ maxFails, cutoff });
  } catch (err) {
    console.warn('[push] cleanup failed:', err?.message || err);
  }
}

// Shutdown providers on process exit
function shutdown() {
  if (apnProvider) {
    apnProvider.shutdown();
    apnProvider = null;
  }
  // Firebase Admin doesn't need explicit shutdown
}

module.exports = {
  isIosPushAvailable,
  isFcmAvailable,
  isNativePushAvailable,
  saveIosToken,
  deleteIosToken,
  getIosTokensForUser,
  sendIosPushToUser,
  broadcastIosPush,
  cleanupStaleIosTokens,
  shutdown
};

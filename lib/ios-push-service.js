const db = require('../db-wrapper');

let apn;
try {
  apn = require('apn');
} catch (err) {
  console.warn('[ios-push] apn module unavailable:', err?.message || err);
}

const IS_TEST = process.env.NODE_ENV === 'test';

// APNs configuration from environment
const APNS_KEY_ID = (process.env.APNS_KEY_ID || '').trim();
const APNS_TEAM_ID = (process.env.APNS_TEAM_ID || '').trim();
const APNS_KEY_PATH = (process.env.APNS_KEY_PATH || '').trim();
const APNS_KEY_CONTENT = (process.env.APNS_KEY_CONTENT || '').trim();
const APNS_BUNDLE_ID = (process.env.APNS_BUNDLE_ID || '').trim();
const APNS_PRODUCTION = process.env.APNS_PRODUCTION === 'true' || process.env.NODE_ENV === 'production';

// Token management
const IOS_PUSH_MAX_PER_USER = Math.max(1, Number(process.env.IOS_PUSH_MAX_PER_USER || 5));

let apnProvider = null;
let IOS_PUSH_AVAILABLE = false;

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
    console.log('[ios-push] APNs provider initialized (production:', APNS_PRODUCTION, ')');
    return true;
  } catch (err) {
    console.error('[ios-push] Failed to initialize APNs provider:', err);
    return false;
  }
}

IOS_PUSH_AVAILABLE = initApnProvider();

if (!IOS_PUSH_AVAILABLE && !IS_TEST) {
  if (!apn) {
    console.warn('[ios-push] iOS push disabled: apn module missing');
  } else if (!APNS_KEY_ID || !APNS_TEAM_ID) {
    console.warn('[ios-push] iOS push disabled: APNS_KEY_ID or APNS_TEAM_ID not provided');
  } else if (!APNS_KEY_PATH && !APNS_KEY_CONTENT) {
    console.warn('[ios-push] iOS push disabled: APNS_KEY_PATH or APNS_KEY_CONTENT not provided');
  } else if (!APNS_BUNDLE_ID) {
    console.warn('[ios-push] iOS push disabled: APNS_BUNDLE_ID not provided');
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isIosPushAvailable() {
  return Boolean(IOS_PUSH_AVAILABLE);
}

// Save iOS device token for a user
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

// Remove iOS device token
async function deleteIosToken(userId, token) {
  if (!token) return;
  await db.prepare(
    'DELETE FROM ios_push_tokens WHERE user_id = ? AND token = ?'
  ).run(userId, token);
}

// Get all iOS tokens for a user
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
async function handleIosDeliveryFailure(tokenRow, error) {
  try {
    const reason = error?.reason || error?.message || 'unknown';
    const fatal = ['BadDeviceToken', 'Unregistered', 'ExpiredProviderToken'].includes(reason);

    if (fatal) {
      await db.prepare('DELETE FROM ios_push_tokens WHERE id = ?').run(tokenRow.id);
      return;
    }

    await db.prepare(`
      UPDATE ios_push_tokens
         SET fail_count = fail_count + 1,
             last_error = @err
       WHERE id = @id
    `).run({ id: tokenRow.id, err: String(reason).slice(0, 255) });
  } catch (err) {
    console.warn('[ios-push] failed to mark delivery error:', err);
  }
}

// Send push notification to iOS device
async function sendIosPushToUser(userId, payload) {
  console.log('[ios-push] sendIosPushToUser called:', { userId, payloadType: payload?.type, available: IOS_PUSH_AVAILABLE });

  if (!IOS_PUSH_AVAILABLE || !apnProvider) {
    console.log('[ios-push] Skipping - APNs not available');
    return;
  }

  const tokens = await getIosTokensForUser(userId);
  console.log('[ios-push] Found tokens for user:', { userId, tokenCount: tokens.length });

  if (!tokens.length) {
    console.log('[ios-push] No tokens found for user', userId);
    return;
  }

  const notification = new apn.Notification();
  notification.topic = APNS_BUNDLE_ID;
  notification.expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  notification.sound = 'default';

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
    // Generic notification
    notification.alert = payload.alert || payload.title || 'Notification';
    if (payload.body) {
      notification.alert = { title: payload.title || 'Trovelr', body: payload.body };
    }
    notification.payload = payload.data || {};
  }

  // Send to all user's devices
  for (const tokenRow of tokens) {
    try {
      console.log('[ios-push] Sending to token:', tokenRow.token?.substring(0, 20) + '...');
      const result = await apnProvider.send(notification, tokenRow.token);

      console.log('[ios-push] APNs result:', { sent: result.sent?.length || 0, failed: result.failed?.length || 0 });

      if (result.failed && result.failed.length > 0) {
        for (const failure of result.failed) {
          console.error('[ios-push] Delivery failed:', failure.response);
          await handleIosDeliveryFailure(tokenRow, failure.response);
        }
      }
    } catch (err) {
      console.error('[ios-push] Send failed:', err);
      await handleIosDeliveryFailure(tokenRow, err);
    }
  }
}

// Broadcast to all iOS devices (for nearby listings, etc.)
async function broadcastIosPush(payload, options = {}) {
  if (!IOS_PUSH_AVAILABLE || !apnProvider) return;

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

  const notification = new apn.Notification();
  notification.topic = APNS_BUNDLE_ID;
  notification.expiry = Math.floor(Date.now() / 1000) + 3600;
  notification.sound = 'default';

  if (payload.type === 'nearby_listing') {
    notification.alert = {
      title: 'New Item Nearby',
      body: payload.title ? `${payload.title} - $${payload.price}` : 'A new item was posted near you'
    };
    notification.payload = {
      type: 'nearby_listing',
      listing_id: payload.listingId
    };
  } else {
    notification.alert = payload.alert || 'New notification';
    notification.payload = payload.data || {};
  }

  for (const tokenRow of tokens) {
    try {
      const result = await apnProvider.send(notification, tokenRow.token);
      if (result.failed && result.failed.length > 0) {
        for (const failure of result.failed) {
          await handleIosDeliveryFailure(tokenRow, failure.response);
        }
      }
    } catch (err) {
      await handleIosDeliveryFailure(tokenRow, err);
    }
  }
}

// Cleanup stale tokens
async function cleanupStaleIosTokens() {
  if (!IOS_PUSH_AVAILABLE) return;
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
    console.warn('[ios-push] cleanup failed:', err?.message || err);
  }
}

// Shutdown provider on process exit
function shutdown() {
  if (apnProvider) {
    apnProvider.shutdown();
    apnProvider = null;
  }
}

module.exports = {
  isIosPushAvailable,
  saveIosToken,
  deleteIosToken,
  getIosTokensForUser,
  sendIosPushToUser,
  broadcastIosPush,
  cleanupStaleIosTokens,
  shutdown
};

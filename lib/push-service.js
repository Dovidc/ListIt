const db = require('../db-wrapper');

let webPush;
try {
  webPush = require('web-push');
} catch (err) {
  const message = err?.message || err;
  if (message) {
    console.warn('[push] web-push module unavailable:', message);
  } else {
    console.warn('[push] web-push module unavailable');
  }
}

const IS_TEST = process.env.NODE_ENV === 'test';
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT_RAW = (process.env.VAPID_SUBJECT || process.env.PUSH_CONTACT_EMAIL || '').trim();
const VAPID_SUBJECT = VAPID_SUBJECT_RAW
  ? (/^(mailto:|https?:)/i.test(VAPID_SUBJECT_RAW)
      ? VAPID_SUBJECT_RAW
      : `mailto:${VAPID_SUBJECT_RAW.replace(/^mailto:/i, '')}`)
  : 'mailto:support@listit.local';

const PUSH_MAX_PER_USER = Math.max(1, Number(process.env.PUSH_MAX_PER_USER || 10));
const PUSH_BROADCAST_LIMIT = Math.max(1, Number(process.env.PUSH_BROADCAST_LIMIT || 200));
const PUSH_FAILURE_MAX = Math.max(1, Number(process.env.PUSH_FAILURE_MAX || 3));
const PUSH_FAILURE_TTL_DAYS = Math.max(1, Number(process.env.PUSH_FAILURE_TTL_DAYS || 14));
const PUSH_STALE_TTL_DAYS = Math.max(30, Number(process.env.PUSH_STALE_TTL_DAYS || 90));
const PUSH_CLEANUP_INTERVAL_MS = Math.max(300000, Number(process.env.PUSH_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000));

let PUSH_AVAILABLE = Boolean(webPush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (PUSH_AVAILABLE) {
  try {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('[push] web-push configured with subject', VAPID_SUBJECT);
  } catch (err) {
    console.error('[push] Failed to configure web-push:', err);
    PUSH_AVAILABLE = false;
  }
}

if (!PUSH_AVAILABLE && !IS_TEST) {
  if (!webPush) {
    console.warn('[push] Push notifications disabled: web-push module missing');
  } else if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push] Push notifications disabled: VAPID keys not provided');
  } else {
    console.warn('[push] Push notifications disabled: web-push configuration failed');
  }
}

function nowIso() {
  return new Date().toISOString();
}

function publicPushMeta() {
  return {
    available: Boolean(PUSH_AVAILABLE),
    vapid_public_key: PUSH_AVAILABLE ? VAPID_PUBLIC_KEY : null
  };
}

function normalizePushSubscriptionInput(raw) {
  let source = raw;

  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return { error: 'invalid_subscription' };
    }
  }

  if (!source || typeof source !== 'object') {
    return { error: 'invalid_subscription' };
  }

  const endpoint = typeof source?.endpoint === 'string' ? source.endpoint.trim() : '';
  const auth = source?.keys?.auth || source?.keys?.Auth || source?.keys?.AUTH;
  const p256dh = source?.keys?.p256dh || source?.keys?.P256dh || source?.keys?.P256DH;
  const expiration = source?.expirationTime ?? source?.expiration_time ?? null;

  if (!endpoint || typeof auth !== 'string' || typeof p256dh !== 'string') {
    return { error: 'invalid_subscription' };
  }

  return {
    value: {
      endpoint,
      keys: { auth, p256dh },
      expiration_time: expiration
    }
  };
}

async function savePushSubscription(userId, normalized) {
  if (!normalized || typeof normalized !== 'object') return;
  const now = nowIso();

  const payload = {
    userId,
    endpoint: normalized.endpoint,
    auth: normalized.keys.auth,
    p256dh: normalized.keys.p256dh,
    expiration: normalized.expiration_time,
    now
  };

  await db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, expiration_time, created_at, updated_at, fail_count, last_failed_at, last_error)
    VALUES (@userId, @endpoint, @p256dh, @auth, @expiration, @now, @now, 0, NULL, NULL)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      expiration_time = excluded.expiration_time,
      updated_at = excluded.updated_at,
      fail_count = 0,
      last_failed_at = NULL,
      last_error = NULL
  `).run(payload);

  await db.prepare(`
    DELETE FROM push_subscriptions
     WHERE user_id = @userId
       AND id NOT IN (
         SELECT id FROM push_subscriptions
          WHERE user_id = @userId
          ORDER BY updated_at DESC
          LIMIT @limit
       )
  `).run({ userId, limit: PUSH_MAX_PER_USER });
}

async function deletePushSubscription(userId, endpoint) {
  if (!endpoint) return;
  await db.prepare(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
  ).run(userId, endpoint);
}

async function getPushSubscriptionsForUser(userId, limit = PUSH_MAX_PER_USER) {
  return await db.prepare(`
    SELECT id, endpoint, p256dh, auth, expiration_time
      FROM push_subscriptions
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT ?
  `).all(userId, Math.max(1, limit));
}

async function handlePushDeliveryFailure(row, error) {
  try {
    const statusCode = Number(error?.statusCode || error?.status || error?.code || 0);
    const body = typeof error?.body === 'string' ? error.body : '';
    const message = String(error?.message || body || statusCode || 'unknown');
    const fatal = statusCode === 404 || statusCode === 410 || /gone|expired|unsubscribed/i.test(message) || /410/.test(body);

    if (fatal) {
      await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
      return;
    }

    await db.prepare(`
      UPDATE push_subscriptions
         SET fail_count = fail_count + 1,
             last_failed_at = @ts,
             last_error = @err
       WHERE id = @id
    `).run({ id: row.id, ts: nowIso(), err: message.slice(0, 255) });
  } catch (err) {
    console.warn('[push] failed to mark delivery error:', err);
  }
}

async function deliverPushRows(rows, payload, options = {}) {
  if (!PUSH_AVAILABLE || !Array.isArray(rows) || rows.length === 0) return;
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);

  for (const row of rows) {
    const subscription = {
      endpoint: row.endpoint,
      keys: {
        auth: row.auth,
        p256dh: row.p256dh
      }
    };
    if (row.expiration_time != null) {
      subscription.expirationTime = Number(row.expiration_time);
    }

    try {
      await webPush.sendNotification(subscription, body, options);
    } catch (err) {
      await handlePushDeliveryFailure(row, err);
    }
  }
}

async function sendPushToUser(userId, payload, options = {}) {
  if (!PUSH_AVAILABLE) return;
  const rows = await getPushSubscriptionsForUser(userId, options.limit || PUSH_MAX_PER_USER);
  await deliverPushRows(rows, payload, options);
}

async function broadcastPushNotification(payload, options = {}) {
  if (!PUSH_AVAILABLE) return;
  const limit = Math.max(1, Number(options.limit || PUSH_BROADCAST_LIMIT));
  const excludeUserId = options.excludeUserId ?? null;
  const rows = await db.prepare(`
    SELECT id, user_id, endpoint, p256dh, auth, expiration_time
      FROM push_subscriptions
     WHERE (@exclude IS NULL OR user_id <> @exclude)
     ORDER BY updated_at DESC
     LIMIT @limit
  `).all({ exclude: excludeUserId, limit });
  await deliverPushRows(rows, payload, options);
}

async function notifyNearbyListing(listing) {
  if (!PUSH_AVAILABLE) return;
  if (!listing || !listing.enable_nearby) return;
  const lat = Number(listing.lat);
  const lon = Number(listing.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const payload = {
    type: 'nearby_listing',
    listing_id: listing.id,
    title: listing.title,
    location: listing.location,
    price: listing.price,
    created_at: listing.created_at,
    lat,
    lon,
    image: listing.image_data || null
  };

  await broadcastPushNotification(payload, { excludeUserId: listing.user_id });
}

async function cleanupStalePushSubscriptions() {
  if (!PUSH_AVAILABLE) return;
  const errorCutoff = new Date(Date.now() - PUSH_FAILURE_TTL_DAYS * 86400000).toISOString();
  const staleCutoff = new Date(Date.now() - PUSH_STALE_TTL_DAYS * 86400000).toISOString();
  try {
    await db.prepare(`
      DELETE FROM push_subscriptions
       WHERE fail_count >= @maxFails
          OR (last_failed_at IS NOT NULL AND last_failed_at < @errorCutoff)
          OR updated_at < @staleCutoff
    `).run({ maxFails: PUSH_FAILURE_MAX, errorCutoff, staleCutoff });
  } catch (err) {
    console.warn('[push] cleanup failed:', err?.message || err);
  }
}

if (PUSH_AVAILABLE && !IS_TEST) {
  cleanupStalePushSubscriptions().catch((err) => {
    console.warn('[push] initial cleanup failed:', err?.message || err);
  });
  const pushCleanupTimer = setInterval(() => {
    cleanupStalePushSubscriptions().catch((err) => {
      console.warn('[push] scheduled cleanup failed:', err?.message || err);
    });
  }, PUSH_CLEANUP_INTERVAL_MS);
  if (typeof pushCleanupTimer.unref === 'function') {
    pushCleanupTimer.unref();
  }
}

module.exports = {
  isPushAvailable: () => Boolean(PUSH_AVAILABLE),
  publicPushMeta,
  normalizePushSubscriptionInput,
  savePushSubscription,
  deletePushSubscription,
  sendPushToUser,
  broadcastPushNotification,
  notifyNearbyListing,
  cleanupStalePushSubscriptions
};

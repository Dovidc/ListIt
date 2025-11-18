/* server.js — ListIt (PostgreSQL-ready with S3-only image storage) */



const express = require('express');

const fs = require('fs');

const path = require('path');

const ENV_CANDIDATES = ['.env.local', '.env'];
for (const envFile of ENV_CANDIDATES) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) continue;

  try {
    const contents = fs.readFileSync(envPath, 'utf8');
    const lines = contents.split(/\r?\n/);
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const line = trimmed.startsWith('export ')
        ? trimmed.slice('export '.length)
        : trimmed;

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const key = line.slice(0, eqIndex).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

      let value = line.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[env] Loaded environment from ${envFile}`);
    }
    break;
  } catch (err) {
    console.warn(`[env] Failed to load ${envFile}:`, err?.message || err);
  }
}

const crypto = require('crypto');

const db = require('./db-wrapper');

const bcrypt = require('bcryptjs');

const cookieParser = require('cookie-parser');

const jwt = require('jsonwebtoken');


const { versionMiddleware } = require('./contracts/versioning');
const { validateBody, sendSchema } = require('./contracts/validation');
const {
  validateRegisterRequest,
  validateLoginRequest,
  validateCreateListingRequest,
  validateUpdateListingRequest,
  validateSendMessageRequest,
  validateVerifyRegistrationRequest,
  validatePasswordResetRequest,
  validatePasswordResetConfirmRequest,
  validateAuthResponse,
  validateListingResponse,
  validateMessageEnvelopeResponse
} = require('./contracts/http-schemas');

const mailService = require('./mail-service');
const { createMessageBus, TOPICS } = require('./lib/message-bus');
const pushService = require('./lib/push-service');
const { runMigrations } = require('./lib/run-migrations');
const { createSharedCache } = require('./lib/shared-cache');
const { createRateLimitStore } = require('./lib/redis-rate-limit-store');
const {
  isPushAvailable,
  publicPushMeta,
  normalizePushSubscriptionInput,
  savePushSubscription,
  deletePushSubscription
} = pushService;
const {
  SUPPORTER_BADGE_CODE,
  SUPPORTER_BADGE_CODE_PREMIUM,
  SUPPORTER_DONATION_AMOUNT,
  SUPPORTER_PREMIUM_AMOUNT,
  SUPPORTER_DONATION_CURRENCY,
  SUPPORTER_SUCCESS_PATH,
  SUPPORTER_CANCEL_PATH
} = require('./lib/supporter-config');



let cors; try { cors = require('cors'); } catch {}

let compression; try { compression = require('compression'); } catch {}

let helmet; try { helmet = require('helmet'); } catch {}

let rateLimit; try { rateLimit = require('express-rate-limit'); } catch {}

let OpenAI; try { OpenAI = require('openai'); } catch {}
let cachedOpenAIClient = null;

let Stripe;
try {
  Stripe = require('stripe');
} catch {}

const stripe = (Stripe && process.env.STRIPE_SECRET_KEY)
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: process.env.STRIPE_API_VERSION || '2024-06-20'
    })
  : null;

function getOpenAIClient() {

  if (!process.env.OPENAI_API_KEY || !OpenAI) return null;

  if (!cachedOpenAIClient) {

    cachedOpenAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  }

  return cachedOpenAIClient;

}

const app = express();

app.disable('x-powered-by');

app.set('trust proxy', 1);



const IS_TEST = process.env.NODE_ENV === 'test';

const IS_PROD = process.env.NODE_ENV === 'production';



const fallbackMessageBus = createMessageBus({ type: 'memory', name: 'server-fallback' });
app.locals.messageBus = fallbackMessageBus;
app.use((req, _res, next) => {
  if (!req.messageBus) {
    req.messageBus = app.locals.messageBus || fallbackMessageBus;
  }
  next();
});

const EMBED_WEBSOCKET = process.env.EMBED_WEBSOCKET !== 'false';

function getAppMessageBus(req) {
  if (req && req.messageBus) return req.messageBus;
  return app.locals.messageBus || fallbackMessageBus;
}

async function publishBackgroundEvent(topic, payload, { req = null, failOnError = false } = {}) {
  const bus = req?.messageBus || getAppMessageBus();
  if (!bus) {
    if (failOnError) {
      throw new Error('message_bus_unavailable');
    }
    return;
  }
  try {
    await bus.publish(topic, payload);
  } catch (err) {
    console.error(`[bus] Failed to publish "${topic}":`, err);
    if (failOnError) {
      throw err;
    }
  }
}

if (IS_TEST && process.env.EMBED_WORKER !== 'false') {
  const { createWorkerService } = require('./services/worker-service');
  (async () => {
    try {
      const embeddedWorker = await createWorkerService(
        { NODE_ENV: process.env.NODE_ENV || 'test', IS_TEST: true },
        fallbackMessageBus,
        { stripe, mailService, pushService }
      );
      await embeddedWorker.start();
      app._embeddedWorker = embeddedWorker;
    } catch (err) {
      console.error('[worker] Failed to start embedded worker:', err);
    }
  })();
}









// S3 presign module

let presignUpload;
let presignDownload;

try {

  ({ presignUpload, presignDownload } = require('./s3'));

  console.log('[S3] s3.js loaded:', typeof presignUpload === 'function', 'bucket=', process.env.S3_BUCKET);

} catch (e) {

  console.error('[S3] require("./s3") failed:', e && e.message);

}



const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_change_me';

function normalizeOrigin(value) {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.host) {
      return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, '');
    }
  } catch (err) {
    // Fallback to manual normalization below.
  }

  return trimmed.replace(/\/$/, '');
}

const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const FRONTEND_ORIGIN = FRONTEND_ORIGINS.length > 0 ? FRONTEND_ORIGINS[0] : null;
const HAS_FRONTEND_ORIGIN = FRONTEND_ORIGINS.length > 0;
const FRONTEND_ORIGIN_SET = new Set(FRONTEND_ORIGINS);

const PUBLIC_APP_BASE_URL = process.env.PUBLIC_APP_BASE_URL || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PREMIUM_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID || '';

function resolveAppBaseUrl(req) {
  if (HAS_FRONTEND_ORIGIN) return FRONTEND_ORIGIN;
  if (PUBLIC_APP_BASE_URL) return PUBLIC_APP_BASE_URL;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (host) return `${proto}://${host}`;
  return '';
}

function resolveSupporterReturnUrl(req, template) {
  if (!template) return resolveAppBaseUrl(req);
  if (/^https?:/i.test(template)) return template;
  const base = resolveAppBaseUrl(req) || '';
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedPath = template.startsWith('/') ? template : `/${template}`;
  return `${normalizedBase}${normalizedPath}`;
}

function isAllowedFrontendOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return FRONTEND_ORIGIN_SET.has(normalized);
}

const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

const PUBLIC_ASSET_BASE = (process.env.PUBLIC_ASSET_BASE || '').trim();

const MAPBOX_ACCESS_TOKEN = (process.env.MAPBOX_ACCESS_TOKEN || '').trim();

const S3_ORIGIN = (process.env.S3_BUCKET && process.env.S3_REGION)

  ? `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com`

  : null;

const ASSET_ORIGIN = PUBLIC_ASSET_BASE || S3_ORIGIN || null;



const S3_BUCKET = (process.env.S3_BUCKET || '').trim();

const S3_REGION = (process.env.S3_REGION || '').trim();

const CDN_BASE = PUBLIC_ASSET_BASE ? PUBLIC_ASSET_BASE.replace(/\/+$/, '') : null;



function trimTrailingSlash(str) {

  return typeof str === 'string' ? str.replace(/\/+$/, '') : str;

}



const LEGACY_S3_PREFIXES = (() => {

  const prefixes = new Set();

  if (!S3_BUCKET) return [];

  if (S3_REGION) {

    prefixes.add(`https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`);

    prefixes.add(`https://s3.${S3_REGION}.amazonaws.com/${S3_BUCKET}`);

  }

  prefixes.add(`https://${S3_BUCKET}.s3.amazonaws.com`);

  prefixes.add(`https://s3.amazonaws.com/${S3_BUCKET}`);

  return Array.from(prefixes).map(trimTrailingSlash);

})();



const ALLOWED_ASSET_PREFIXES = [

  ...(CDN_BASE ? [CDN_BASE] : []),

  ...LEGACY_S3_PREFIXES

];

if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev_jwt_change_me')) {

  console.error('FATAL: JWT_SECRET must be set to a strong value in production.');

  process.exit(1);

}



const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB || 20);
const SUPPORTED_BANNER_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

const B64_SLOP = 1.6;



const NEARBY_MAX_RADIUS_M = Number(process.env.NEARBY_MAX_RADIUS_M || 1609);

const NEARBY_RESULT_LIMIT = Number(process.env.NEARBY_RESULT_LIMIT || 120);

const NEARBY_CACHE_TTL_MS = Number(process.env.NEARBY_CACHE_TTL_MS || 20000);

const NEARBY_CACHE_MAX = Number(process.env.NEARBY_CACHE_MAX || 200);

const nearbyCache = createSharedCache({
  prefix: 'nearby-listings',
  ttlMs: NEARBY_CACHE_TTL_MS,
  maxSize: NEARBY_CACHE_MAX
});

const ADMIN_REPORT_MIN = Math.max(1, Number(process.env.ADMIN_REPORT_MIN || 1));

const IS_POSTGRES = true;

const GEO_FEATURES = {
  postgisNearby: false,
  reason: 'uninitialized'
};

async function configureSpatialFeatures() {
  GEO_FEATURES.postgisNearby = false;
  GEO_FEATURES.reason = IS_POSTGRES ? 'postgis_unavailable' : 'sqlite_dialect';

  if (!IS_POSTGRES) {
    return;
  }

  try {
    await db.exec('CREATE EXTENSION IF NOT EXISTS postgis');
  } catch (err) {
    GEO_FEATURES.reason = `extension_failed:${err?.code || err?.message || 'unknown'}`;
    return;
  }

  let version;
  try {
    const row = await db.prepare('SELECT PostGIS_Version() AS version').get();
    version = row?.version;
  } catch (err) {
    GEO_FEATURES.reason = `version_failed:${err?.code || err?.message || 'unknown'}`;
    return;
  }

  if (!version) {
    GEO_FEATURES.reason = 'version_missing';
    return;
  }

  GEO_FEATURES.postgisNearby = true;
  GEO_FEATURES.reason = version;

  try {
    await db.exec('ALTER TABLE listings ADD COLUMN geog GEOGRAPHY(Point, 4326)');
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (!msg.includes('already exists')) {
      console.warn('[postgis] failed adding geography column:', err);
    }
  }

  try {
    await db.exec(`
      UPDATE listings
         SET geog = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
       WHERE lat IS NOT NULL
         AND lon IS NOT NULL
         AND (geog IS NULL OR ST_IsEmpty(geog));
    `);
  } catch (err) {
    console.warn('[postgis] failed to backfill geography column:', err);
  }

  try {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_listings_geog
        ON listings
        USING GIST (
          COALESCE(
            geog,
            ST_GeographyFromText('SRID=4326;POINT(' || lon || ' ' || lat || ')')
          )
        );
    `);
  } catch (err) {
    console.warn('[postgis] failed creating geography index:', err);
  }
}

async function maybeUpdateListingGeography(id, lat, lon) {
  if (!GEO_FEATURES.postgisNearby) return;
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return;
  try {
    await db.prepare(`
      UPDATE listings
         SET geog = ST_SetSRID(ST_MakePoint(@lon, @lat), 4326)::geography
       WHERE id = @id
    `).run({ id, lat: latNum, lon: lonNum });
  } catch (err) {
    console.warn('[postgis] failed updating listing geography:', err);
    GEO_FEATURES.postgisNearby = false;
    GEO_FEATURES.reason = `update_failed:${err?.code || err?.message || 'unknown'}`;
  }
}

function quantizeCoord(value, precision) {

  return Math.round(value * precision) / precision;

}

function makeNearbyCacheKey(lat, lon, radius) {

  const precision = 5000; // ~22m increments

  const latKey = quantizeCoord(lat, precision).toFixed(4);

  const lonKey = quantizeCoord(lon, precision).toFixed(4);

  const radiusBucket = Math.max(1, Math.round(radius / 25));

  return `${latKey}|${lonKey}|${radiusBucket}`;

}

async function getNearbyCache(key) {
  try {
    return (await nearbyCache.get(key)) || null;
  } catch (err) {
    console.warn('[nearby-cache] get failed:', err?.message || err);
    return null;
  }
}

async function setNearbyCache(key, value) {
  try {
    await nearbyCache.set(key, value);
  } catch (err) {
    console.warn('[nearby-cache] set failed:', err?.message || err);
  }
}

async function invalidateNearbyCache() {
  try {
    await nearbyCache.clear();
  } catch (err) {
    console.warn('[nearby-cache] clear failed:', err?.message || err);
  }
}



/* ------------------------------------------------------------------ */

/* Core parsers                                                        */

/* ------------------------------------------------------------------ */

app.use(cookieParser());

// Stripe webhook must come BEFORE express.json() to receive raw body
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'stripe_unavailable' });
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'webhook_not_configured' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Received Stripe webhook event:', event.type);

  try {
    await publishBackgroundEvent(TOPICS.STRIPE_WEBHOOK, {
      type: event.type,
      data: event.data?.object || null,
      id: event.id,
      created: event.created,
      livemode: event.livemode
    }, { req, failOnError: true });
  } catch (err) {
    console.error('Error processing webhook:', err);
    return res.status(500).json({ error: 'webhook_processing_failed' });
  }

  res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((err, req, res, next) => {

  if (err instanceof SyntaxError && 'body' in err) {

    return res.status(400).json({ error: 'invalid_json' });

  }

  next(err);

});

app.use(versionMiddleware);



/* ------------------------------------------------------------------ */

/* CORS                                                                */

/* ------------------------------------------------------------------ */

if (HAS_FRONTEND_ORIGIN && cors) {

  const corsCfg = {

    origin(origin, callback) {
      if (!origin) {
        // Requests originating from curl or server-side scripts might not
        // include the Origin header. Permit them to pass through.
        return callback(null, true);
      }

      if (isAllowedFrontendOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'), false);
    },

    credentials: true,

    methods: ['GET','POST','PUT','DELETE','OPTIONS'],

    allowedHeaders: ['Content-Type', 'Authorization'],

    optionsSuccessStatus: 204,

  };

   // Must come before your routes
  app.use(cors(corsCfg));

  // Enable preflight across-the-board (fixes the path-to-regexp error)
  // app.options('*', cors(corsCfg));    // ← changed from '/*' to '*'
  // or: app.options('/:splat(*)', cors(corsCfg));

}



/* ------------------------------------------------------------------ */

/* Security headers                                                    */

/* ------------------------------------------------------------------ */

if (helmet) {

  app.use(helmet({

    frameguard: { action: 'deny' },

    referrerPolicy: { policy: 'no-referrer' },

    crossOriginResourcePolicy: { policy: 'cross-origin' },

  }));



  app.use(helmet.contentSecurityPolicy({

    useDefaults: true,

    directives: {

      "default-src": ["'self'"],

      "img-src": ["'self'", "data:", "https:", "blob:"],

      "script-src": ["'self'", "https://unpkg.com"],

      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],

      "font-src": ["https://fonts.gstatic.com"],

      "connect-src": [

        "'self'", 

        "https://nominatim.openstreetmap.org", 

        "https:", 

        "wss:",

        // Add ws: for development WebSocket connections

        IS_PROD ? null : "ws:",

        // Optionally, be more specific for development

        IS_PROD ? null : "ws://localhost:*"

      ].filter(Boolean),

      "frame-ancestors": ["'none'"],

      "object-src": ["'none'"]

    }

  }));



  if (IS_PROD) app.use(helmet.hsts({ maxAge: 15552000 }));

}



/* ------------------------------------------------------------------ */

/* Compression + static                                               */

/* ------------------------------------------------------------------ */

if (compression) app.use(compression());

const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.static(PUBLIC_DIR, { maxAge: '7d', immutable: true }));



/* ------------------------------------------------------------------ */

/* CSRF Origin/Referer guard                                          */

/* ------------------------------------------------------------------ */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originGuard(req, res, next) {

  if (SAFE_METHODS.has(req.method)) return next();

  if (!HAS_FRONTEND_ORIGIN) return next();

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (!origin && !referer) return next();

  const matchesOrigin = isAllowedFrontendOrigin(origin);
  const matchesReferer = isAllowedFrontendOrigin(referer);

  if (!matchesOrigin && !matchesReferer) {
    return res.status(403).json({ error: 'bad_origin' });
  }

  next();

}

app.use(originGuard);



/* ------------------------------------------------------------------ */

/* Schema initialization (async)                                       */

/* ------------------------------------------------------------------ */

// Schema migrations are managed via Knex (see migrations directory).



/* ------------------------------------------------------------------ */

/* Utils                                                              */

/* ------------------------------------------------------------------ */

function safeJsonParse(str, fallback) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function normalizeFlaggedDetailObject(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;

  const wrapperKeys = ['flagged', 'details', 'entries', 'items', 'data', 'results'];
  const hasWrapperChildren = wrapperKeys.some((key) => {
    const value = detail[key];
    return Array.isArray(value) || typeof value === 'string';
  });

  const pickString = (...candidates) => {
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
      }
    }
    return '';
  };

  const type = (() => {
    const rawType = pickString(detail.type, detail.kind, detail.category, detail.label);
    if (rawType) return rawType;
    const guessTarget = pickString(detail.target, detail.value, detail.text, detail.body, detail.content, detail.url, detail.image_url);
    if (guessTarget && /^https?:\/\//i.test(guessTarget)) return 'image';
    return guessTarget ? 'content' : '';
  })();

  const target = pickString(detail.target, detail.value, detail.text, detail.body, detail.content, detail.url, detail.image_url);

  const categories = (() => {
    if (Array.isArray(detail.categories)) {
      return detail.categories.map((cat) => pickString(cat)).filter(Boolean);
    }
    if (Array.isArray(detail.labels)) {
      return detail.labels.map((cat) => pickString(cat)).filter(Boolean);
    }
    if (Array.isArray(detail.flags)) {
      return detail.flags.map((cat) => pickString(cat)).filter(Boolean);
    }
    const single = pickString(detail.category, detail.label);
    return single ? [single] : [];
  })();

  const scoreSource = (() => {
    const candidates = [detail.category_scores, detail.scores, detail.confidence, detail.score];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate;
      }
    }
    return null;
  })();

  const category_scores = {};
  if (scoreSource) {
    for (const [key, value] of Object.entries(scoreSource)) {
      const trimmedKey = pickString(key);
      if (!trimmedKey) continue;
      const numeric = Number(value);
      if (Number.isFinite(numeric)) category_scores[trimmedKey] = numeric;
    }
  }

  if (!type && !target && !categories.length && !Object.keys(category_scores).length && hasWrapperChildren) {
    return null;
  }

  const resolvedType = type || (target && /^https?:\/\//i.test(target) ? 'image' : 'content');

  return {
    type: resolvedType || 'content',
    target,
    categories,
    category_scores
  };
}

function normalizeFlaggedDetails(raw) {
  if (raw == null) return [];

  const stack = [raw];
  const seenStrings = new Set();
  const results = [];

  while (stack.length) {
    const current = stack.pop();
    if (current == null) continue;

    if (typeof current === 'string') {
      const trimmed = current.trim();
      if (!trimmed) continue;
      if (!seenStrings.has(trimmed)) {
        seenStrings.add(trimmed);
        const parsed = safeJsonParse(trimmed, null);
        if (parsed !== null && parsed !== trimmed) {
          stack.push(parsed);
          continue;
        }
      }
      results.push({
        type: 'content',
        target: trimmed,
        categories: [],
        category_scores: {}
      });
      continue;
    }

    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i -= 1) {
        stack.push(current[i]);
      }
      continue;
    }

    if (typeof current === 'object') {
      const wrapperKeys = ['flagged', 'details', 'entries', 'items', 'data', 'results'];
      for (const key of wrapperKeys) {
        const value = current[key];
        if (Array.isArray(value) || typeof value === 'string') {
          stack.push(value);
        }
      }

      const normalized = normalizeFlaggedDetailObject(current);
      if (normalized) {
        results.push(normalized);
      }
    }
  }

  const unique = [];
  const seenObjects = new Set();
  for (const detail of results) {
    if (!detail) continue;
    const key = JSON.stringify(detail);
    if (seenObjects.has(key)) continue;
    seenObjects.add(key);
    unique.push(detail);
    if (unique.length >= 20) break;
  }

  return unique;
}

let flaggedSchemaReady = false;
let flaggedSchemaPromise = null;
async function ensureFlaggedAttemptsSchema() {
  if (flaggedSchemaReady) return;
  if (flaggedSchemaPromise) return flaggedSchemaPromise;

  flaggedSchemaPromise = (async () => {
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS flagged_attempts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
          listing_title TEXT,
          details TEXT,
          flagged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      try {
        await db.exec('ALTER TABLE flagged_attempts ADD COLUMN listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL');
      } catch {}
      try { await db.exec('ALTER TABLE flagged_attempts ADD COLUMN listing_title TEXT'); } catch {}
      try { await db.exec('ALTER TABLE flagged_attempts ADD COLUMN details TEXT'); } catch {}
      try {
        await db.exec('ALTER TABLE flagged_attempts ADD COLUMN flagged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
      } catch {}
      try {
        await db.exec('CREATE INDEX IF NOT EXISTS idx_flagged_attempts_flagged_at ON flagged_attempts(flagged_at DESC, id DESC)');
      } catch {}
      flaggedSchemaReady = true;
    } catch (err) {
      flaggedSchemaReady = false;
      console.error('Failed to ensure flagged_attempts schema:', err);
      throw err;
    } finally {
      flaggedSchemaPromise = null;
    }
  })();

  return flaggedSchemaPromise;
}

async function recordFlaggedAttempt({ userId, listingId = null, title = '', flagged = [] } = {}) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return;
  const lid = Number(listingId);
  const hasListingId = Number.isFinite(lid) ? lid : null;
  const cleanTitle = (() => {
    const raw = typeof title === 'string' ? title : (title == null ? '' : String(title));
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 160);
  })();
  let detailsJson = null;
  if (Array.isArray(flagged) && flagged.length) {
    const normalized = normalizeFlaggedDetails(flagged);
    if (normalized.length) {
      try { detailsJson = JSON.stringify(normalized); } catch {}
    }
  }
  try {
    await ensureFlaggedAttemptsSchema();
    await db.prepare(`
      INSERT INTO flagged_attempts (user_id, listing_id, listing_title, details, flagged_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(uid, hasListingId, cleanTitle, detailsJson, nowIso());
  } catch (err) {
    console.warn('Failed to record flagged attempt:', err?.message || err);
  }
}

function nowIso() { return new Date().toISOString(); }

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeCompare(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function generateVerificationCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

async function issueEmailVerification(user) {
  if (!user || !user.id || !user.email) return null;
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const hash = hashValue(code);
  const currentStatus = typeof user.account_status === 'string' && user.account_status.trim()
    ? user.account_status.trim()
    : 'pending_verification';
  const nextStatus = currentStatus === 'banned' ? 'banned' : 'pending_verification';

  await db.prepare(`
    UPDATE users
       SET email_verification_code_hash = ?,
           email_verification_expires_at = ?,
           account_status = ?
     WHERE id = ?
  `).run(hash, expiresAt, nextStatus, user.id);

  await publishBackgroundEvent(TOPICS.USER_REGISTERED, {
    userId: user.id,
    email: user.email,
    verificationCode: code
  });
  return { code, expiresAt };
}

function normalizePair(u1, u2) {

  const a = Math.min(Number(u1), Number(u2));

  const b = Math.max(Number(u1), Number(u2));

  return { a, b };

}



function normalizeTags(input) {

  if (!input) return '';

  let arr = Array.isArray(input) ? input : String(input).split(',');

  arr = arr.map(s => String(s).trim().toLowerCase()).filter(Boolean);

  const seen = new Set();

  const clean = [];

  for (let t of arr) {

    t = t.replace(/[^a-z0-9 \-]/g, '').trim();

    if (!t || t.length > 32) continue;

    if (seen.has(t)) continue;

    clean.push(t);

    seen.add(t);

    if (clean.length >= 20) break;

  }

  return clean.join(',');

}



function shortTitle(str) {

  const s = String(str || '').trim();

  if (!s) return '';

  const t = s.replace(/\s+/g, ' ').slice(0, 80);

  return t.charAt(0).toUpperCase() + t.slice(1);

}



function fallbackTagsFromTitleDesc(title, desc) {

  const s = `${title || ''} ${desc || ''}`.toLowerCase();

  const words = (s.match(/[a-z0-9\-]{3,}/g) || []).slice(0, 80);

  const freq = {};

  for (const w of words) { freq[w] = (freq[w] || 1) + 1; }

  const base = Object.entries(freq).sort((a,b)=>b[1]-a[1]).map(([w])=>w).slice(0,10);

  const generic = ['sale','buy','deal','used','second hand','good','condition','local','pickup','cheap','discount','shop','offer'];

  return [...new Set([...base, ...generic])].slice(0, 20);

}

function synthesizeListingDescription(title, hint) {

  const cleanHint = (hint || '').toString().trim().replace(/\s+/g, ' ');

  if (cleanHint) {

    return cleanHint.slice(0, 200);

  }

  const base = shortTitle(title || 'Item for sale');

  return `${base}. Condition unclear; please verify details.`.slice(0, 200);

}

function tokenizeSearchInput(str) {

  if (!str) return [];

  const rawTokens = String(str)

    .toLowerCase()

    .split(/[^a-z0-9]+/)

    .map((tok) => tok.trim())

    .filter(Boolean);

  const tokens = [];

  for (const tok of rawTokens) {

    if (tok.length === 1 && !/[0-9]/.test(tok)) continue;

    tokens.push(tok);

    if (tokens.length >= 6) break;

  }

  return Array.from(new Set(tokens));

}

function stemSearchToken(token) {

  if (!token || token.length < 3) return token;

  if (token.endsWith('ies') && token.length > 4) return token.slice(0, -3) + 'y';

  if (token.endsWith('ves') && token.length > 4) return token.slice(0, -3) + 'f';

  if (token.endsWith('ses') && token.length > 4) return token.slice(0, -2);

  if (token.endsWith('es') && token.length > 3) return token.slice(0, -2);

  if (token.endsWith('s') && token.length > 3 && !token.endsWith('ss')) return token.slice(0, -1);

  return token;

}

function applyListingSearchTokens(where, params, tokens, alias = 'l') {

  if (!Array.isArray(tokens) || tokens.length === 0) return;

  tokens.forEach((token, idx) => {

    const variants = new Set([token]);

    const stem = stemSearchToken(token);

    if (stem && stem !== token) variants.add(stem);

    const likeClauses = [];

    Array.from(variants).forEach((variant, vIdx) => {

      const param = `q_${idx}_${vIdx}`;

      params[param] = `%${variant}%`;

      likeClauses.push(`LOWER(${alias}.title) LIKE @${param}`);

      likeClauses.push(`LOWER(${alias}.description) LIKE @${param}`);

      likeClauses.push(`LOWER(COALESCE(${alias}.tags, '')) LIKE @${param}`);

      likeClauses.push(`LOWER(${alias}.location) LIKE @${param}`);

    });

    where.push(`(${likeClauses.join(' OR ')})`);

  });

}



function normLetters(s) { return String(s||'').toLowerCase().replace(/[^a-z]/g,''); }

function cityOf(location) { return String(location||'').split(',')[0].trim(); }

function normalizeCitySlug(city) {

  return normLetters(String(city || '').toLowerCase()).replace(/[^a-z0-9]/g, '');

}



function levenshtein(a,b) {

  a = String(a); b = String(b);

  const m = a.length, n = b.length;

  if (m===0) return n; if (n===0) return m;

  const dp = new Array(n+1);

  for (let j=0;j<=n;j++) dp[j]=j;

  for (let i=1;i<=m;i++){

    let prev = i-1;

    dp[0]=i;

    for (let j=1;j<=n;j++){

      const tmp = dp[j];

      const cost = a[i-1]===b[j-1]?0:1;

      dp[j] = Math.min(dp[j]+1, dp[j-1]+1, prev+cost);

      prev = tmp;

    }

  }

  return dp[n];

}



function pickMatchingCities(allCities, query) {

  const out = new Set();

  const q = (query||'').trim();

  const qn = normLetters(q);

  if (!q) return out;

  for (const c of allCities){

    const cn = normLetters(c);

    if (!cn) continue;

    if (c.toLowerCase().includes(q.toLowerCase()) || cn.includes(qn) || cn.startsWith(qn)) { out.add(c); continue; }

    const d = levenshtein(cn, qn);

    if (d <= 2) { out.add(c); continue; }

  }

  return out;

}



async function incrementCityCount(cityRaw) {

  const city = cityOf(cityRaw);

  const slug = normalizeCitySlug(city);

  if (!city || !slug) return;

  await db.prepare(`

    INSERT INTO listing_cities (city, slug, count)

    VALUES (?, ?, 1)

    ON CONFLICT(city)

    DO UPDATE SET count = listing_cities.count + 1, slug = excluded.slug

  `).run(city, slug);

}



async function decrementCityCount(cityRaw) {

  const city = cityOf(cityRaw);

  const slug = normalizeCitySlug(city);

  if (!city || !slug) return;

  await db.prepare('UPDATE listing_cities SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END WHERE city = ?').run(city);

  await db.prepare('DELETE FROM listing_cities WHERE city = ? AND count <= 0').run(city);

}



function startsWithAssetPrefix(url, prefix) {

  if (!url || !prefix) return false;

  if (!url.startsWith(prefix)) return false;

  const next = url.charAt(prefix.length);

  return next === '' || next === '/' || next === '?' || next === '#';

}



function canonicalAssetUrl(value) {

  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  if (!trimmed) return trimmed;

  if (trimmed.startsWith('data:')) return trimmed;

  if (CDN_BASE) {

    if (startsWithAssetPrefix(trimmed, CDN_BASE)) {

      return trimmed;

    }

    for (const prefix of LEGACY_S3_PREFIXES) {

      if (startsWithAssetPrefix(trimmed, prefix)) {

        const suffix = trimmed.slice(prefix.length);

        const normalizedSuffix = suffix && suffix.startsWith('/') ? suffix : (suffix ? '/' + suffix : '');

        return `${CDN_BASE}${normalizedSuffix}`;

      }

    }

    if (!/^https?:\/\//i.test(trimmed)) {

      const key = trimmed.replace(/^\/+/, '');

      return key ? `${CDN_BASE}/${key}` : CDN_BASE;

    }

  }

  return trimmed;

}



function assetKeyFromUrl(value) {

  if (!S3_BUCKET) return null;

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (!trimmed || trimmed.startsWith('data:')) return null;

  const prefixes = [];

  if (CDN_BASE) prefixes.push(CDN_BASE);

  prefixes.push(...LEGACY_S3_PREFIXES);

  for (const prefix of prefixes) {

    if (startsWithAssetPrefix(trimmed, prefix)) {

      let suffix = trimmed.slice(prefix.length);

      if (suffix.startsWith('/')) suffix = suffix.slice(1);

      suffix = suffix.split('?')[0].split('#')[0];

      return suffix || null;

    }

  }

  if (!/^https?:\/\//i.test(trimmed)) {

    const normalized = trimmed.replace(/^\/+/, '').split('?')[0].split('#')[0];

    return normalized || null;

  }

  return null;

}



async function toOpenAIImageUrl(value) {

  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  if (!trimmed) return trimmed;

  // Use CloudFront URL if available (publicly accessible, works with OpenAI)
  const cdnUrl = canonicalAssetUrl(trimmed);

  if (typeof cdnUrl === 'string' && cdnUrl) {
    return cdnUrl;
  }

  // Fallback to original URL if no CDN conversion available
  return trimmed;

}



function assetVariants(value) {

  if (typeof value !== 'string') return [];

  const trimmed = value.trim();

  if (!trimmed) return [];

  const variants = new Set([trimmed]);

  const normalized = canonicalAssetUrl(trimmed);

  if (typeof normalized === 'string' && normalized) variants.add(normalized);

  if (CDN_BASE && typeof normalized === 'string' && normalized && normalized.startsWith(CDN_BASE)) {

    const suffix = normalized.slice(CDN_BASE.length);

    const normalizedSuffix = suffix && suffix.startsWith('/') ? suffix : (suffix ? '/' + suffix : '');

    for (const prefix of LEGACY_S3_PREFIXES) {

      variants.add(prefix + normalizedSuffix);

    }

  }

  return Array.from(variants);

}



function isAllowedPublicUrl(u) {

  if (typeof u !== 'string') return false;

  const trimmed = u.trim();

  if (!trimmed) return false;



  const normalized = canonicalAssetUrl(trimmed);

  const candidate = (typeof normalized === 'string' && normalized.length) ? normalized : trimmed;



  for (const prefix of ALLOWED_ASSET_PREFIXES) {

    if (startsWithAssetPrefix(candidate, prefix)) {

      return true;

    }

  }



  try {

    const parsed = new URL(candidate);

    return parsed.protocol === 'https:' &&

      (parsed.hostname.endsWith('.amazonaws.com') || parsed.hostname.endsWith('.cloudfront.net'));

  } catch {

    return false;

  }

}


function hasAllowedBannerImageExtension(u) {

  if (typeof u !== 'string') return false;

  const clean = u.split('?')[0]?.trim().toLowerCase();

  if (!clean) return false;

  return SUPPORTED_BANNER_IMAGE_EXTS.some((ext) => clean.endsWith(ext));

}


function isAllowedBannerImageUrl(u) {

  return isAllowedPublicUrl(u) && hasAllowedBannerImageExtension(u);

}



function validateImages(images) {

  if (!Array.isArray(images) || images.length === 0) return 'At least one image is required';

  if (images.length > 10) return 'Too many images (max 10)';

  const maxB64Len = MAX_IMAGE_MB * 1024 * 1024 * B64_SLOP;

  for (const img of images) {

    if (typeof img !== 'string' || !img.startsWith('data:image')) return 'Each image must be a data URL';

    if (img.length > maxB64Len) return `Each image must be <= ~${MAX_IMAGE_MB}MB`;

  }

  return null;

}



function validateMsgImages(images) {

  if (!images) return null;

  if (!Array.isArray(images)) return 'images must be an array';

  if (images.length > 5) return 'Too many images (max 5)';

  const maxB64Len = MAX_IMAGE_MB * 1024 * 1024 * B64_SLOP;

  for (const img of images) {

    if (typeof img !== 'string') return 'Each image must be a string';

    if (img.startsWith('data:image/') && img.length > maxB64Len) return `Each image must be <= ~${MAX_IMAGE_MB}MB`;

    if (img.startsWith('https://') && !isAllowedPublicUrl(img)) return 'Invalid image URL';

  }

  return null;

}



async function moderateListingContent({ title, description, imageUrls }) {

  const client = getOpenAIClient();

  if (!client) return [];

  const entries = [];

  if (typeof title === 'string') {

    const trimmed = title.trim();

    if (trimmed) entries.push({ type: 'title', value: trimmed });

  }

  if (typeof description === 'string') {

    const trimmed = description.trim();

    if (trimmed) entries.push({ type: 'description', value: trimmed });

  }

  if (Array.isArray(imageUrls)) {

    for (const raw of imageUrls) {

      if (typeof raw !== 'string') continue;

      const trimmed = raw.trim();

      if (!trimmed) continue;

      const canonical = canonicalAssetUrl(trimmed);

      const normalized = (typeof canonical === 'string' && canonical) ? canonical : trimmed;

      entries.push({ type: 'image', value: normalized });

    }

  }

  if (!entries.length) return [];

  let moderation;

  try {

    moderation = await client.moderations.create({

      model: 'omni-moderation-latest',

      input: entries.map((entry) => entry.value)

    });

  } catch (err) {

    const error = new Error('moderation_failed');

    error.code = 'moderation_failed';

    error.cause = err;

    throw error;

  }

  const flagged = [];

  moderation.results?.forEach((result, index) => {

    if (!result?.flagged) return;

    const entry = entries[index];

    flagged.push({

      type: entry.type,

      target: entry.value,

      categories: Object.keys(result.categories || {}).filter((key) => result.categories[key]),

      category_scores: result.category_scores || {}

    });

  });

  return flagged;

}



function normalizeHttpUrl(input, { allowEmpty = false } = {}) {

  let str = (input ?? '').toString().trim();

  if (!str) {

    return allowEmpty ? '' : null;

  }

  if (!/^https?:\/\//i.test(str)) {

    str = `https://${str}`;

  }

  try {

    const url = new URL(str);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    return url.toString();

  } catch {

    return null;

  }

}



function formatAdRow(row) {

  if (!row) return null;

  return {

    id: row.id,

    title: row.title || '',

    subtitle: row.subtitle || '',

    target_url: row.target_url || '',

    image_url: canonicalAssetUrl(row.image_url || ''),

    cta_label: row.cta_label || '',

    background: row.background || '',

    is_active: row.is_active ? 1 : 0,

    position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,

    created_at: row.created_at || null,

    updated_at: row.updated_at || null

  };

}





/* ------------------------------------------------------------------ */

/* Auth helpers                                                        */

/* ------------------------------------------------------------------ */

function setAuthCookie(res, payload) {

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

  const sameSitePolicy = HAS_FRONTEND_ORIGIN ? 'none' : 'lax';
  const securePolicy = HAS_FRONTEND_ORIGIN ? true : IS_PROD;

  res.cookie('token', token, {

    httpOnly: true,

    sameSite: sameSitePolicy,

    secure: securePolicy,

    domain: COOKIE_DOMAIN,

    maxAge: 7*24*60*60*1000,

    path: '/'

  });

  return token;

}



function clearAuthCookie(res) {

  res.clearCookie('token', {

    httpOnly: true,

    sameSite: HAS_FRONTEND_ORIGIN ? 'none' : 'lax',

    secure: HAS_FRONTEND_ORIGIN ? true : IS_PROD,

    domain: COOKIE_DOMAIN,

    path: '/'

  });

}



function authFromReq(req) {

  let t = req.cookies?.token;

  const hdr = req.headers?.authorization || '';

  if (!t && hdr.startsWith('Bearer ')) t = hdr.slice(7);

  if (!t) return null;

  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }

}



async function getUserWithStatus(userId) {

  if (!Number.isFinite(Number(userId))) return null;

  try {

    return await db.prepare(`

      SELECT id, email, username, is_admin,

             COALESCE(account_status, 'active') AS account_status,

             status_note,

             status_updated_at,

             created_at,

             last_login_at,

             profile_picture_url,

             profile_avatar_border_color,

             profile_avatar_border_style,

             profile_bg_image_url,

             profile_bg_video_url,
             profile_about,

             supporter_badge,

             supporter_since,

             supporter_tier,

             stripe_subscription_id,

             subscription_status,

             subscription_current_period_end,

             stripe_customer_id,

             karma

        FROM users

       WHERE id = ?

    `).get(Number(userId));

  } catch (err) {

    console.error('getUserWithStatus failed:', err);

    return null;

  }

}



function mapUserRow(row, extra = {}) {

  if (!row) return null;

  const imageUrl = row.profile_bg_image_url || null;
  const videoUrl = row.profile_bg_video_url || null;

  return {

    id: row.id,

    email: row.email,

    username: row.username,

    is_admin: !!row.is_admin,

    profile_picture_url: row.profile_picture_url,

    profile_avatar_border_color: row.profile_avatar_border_color || '#ffffff',

    profile_avatar_border_style: row.profile_avatar_border_style || 'solid',

    profile_bg_image_url: imageUrl || videoUrl || null,

    profile_bg_video_url: videoUrl,
    profile_about: row.profile_about || '',

    account_status: row.account_status || 'active',

    status_note: row.status_note,

    status_updated_at: row.status_updated_at,

    created_at: row.created_at,

    last_login_at: row.last_login_at,

    supporter_badge: row.supporter_badge || null,

    supporter_since: row.supporter_since || null,

    supporter_tier: row.supporter_tier || null,

    stripe_subscription_id: row.stripe_subscription_id || null,

    subscription_status: row.subscription_status || null,

    subscription_current_period_end: row.subscription_current_period_end || null,

    stripe_customer_id: row.stripe_customer_id || null,

    karma: row.karma || 0,

    ...extra

  };

}



function isLockedAccount(user) {

  return !!user && user.account_status === 'locked';

}



async function isAdminUserId(userId) {

  if (!Number.isFinite(Number(userId))) return false;

  try {

    const row = await db.prepare('SELECT is_admin FROM users WHERE id = ?').get(Number(userId));

    return !!(row && row.is_admin);

  } catch (err) {

    console.error('isAdminUserId failed:', err);

    return false;

  }

}



function respondLocked(res) {

  return res.status(423).json({ error: 'account_locked' });

}



async function auth(req, res, next) {

  const session = authFromReq(req);

  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  try {

    const row = await getUserWithStatus(session.id);

    if (!row) {

      clearAuthCookie(res);

      return res.status(401).json({ error: 'Not authenticated' });

    }



    if (row.account_status === 'banned') {

      clearAuthCookie(res);

      return res.status(403).json({ error: 'account_banned' });

    }



    req.user = mapUserRow(row);

    next();

  } catch (err) {

    console.error('Auth middleware failed:', err);

    return res.status(500).json({ error: 'auth_failed' });

  }

}



function requireAdmin(req, res, next) {

  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });

  next();

}



/* ------------------------------------------------------------------ */

/* Rate limiters                                                       */

/* ------------------------------------------------------------------ */

function mkLimiter(cfg, name) {

  if (!rateLimit) return (req, res, next) => next();

  const options = { ...cfg, standardHeaders: true, legacyHeaders: false };
  const store = createRateLimitStore({ name, windowMs: cfg.windowMs });
  if (store) {
    options.store = store;
  }
  return rateLimit(options);

}

const loginLimiter = mkLimiter({ windowMs: 15*60*1000, max: 20 }, 'login');

const writeLimiter = mkLimiter({ windowMs: 60*1000, max: 60 }, 'write');

const uploadLimiter = mkLimiter({ windowMs: 10*60*1000, max: 120 }, 'upload');

const geocodeLimiter = mkLimiter({ windowMs: 60*1000, max: 30 }, 'geocode');



const REPORT_REASON_CODES = new Set([

  'fraud',

  'spam',

  'inappropriate',

  'harassment',

  'other'

]);



/* ------------------------------------------------------------------ */

/* Optional admin bootstrap                                           */

/* ------------------------------------------------------------------ */

async function maybeCreateAdmin() {

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

  const username = (process.env.ADMIN_USERNAME || '').trim();

  const password = process.env.ADMIN_PASSWORD || '';

  if (!email || !username || !password) return;

  

  try {

    const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);

    if (exists) { 

      console.log('Admin exists:', email); 

      return; 

    }

    const hash = await bcrypt.hash(password, 10);

    await db.prepare('INSERT INTO users (email, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, 1)')

      .run(email, username, hash, nowIso());

    console.log('Admin created:', email, 'username:', username);

  } catch (e) {

    console.error('Admin creation failed:', e);

  }

}

const userListingsLimiter = mkLimiter({ windowMs: 60*1000, max: 30 }, 'user-listings');

/* ------------------------------------------------------------------ */

/* Auth routes                                                         */

/* ------------------------------------------------------------------ */

app.post('/api/register', writeLimiter, validateBody(validateRegisterRequest), async (req, res) => {

  try {

    const { username, email, password } = req.body;

    const hash = await bcrypt.hash(password, 10);

    const createdAt = nowIso();

    const accountStatus = 'pending_verification';

    const info = await db.prepare(`
      INSERT INTO users (email, username, password_hash, created_at, account_status, is_admin)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(email, username, hash, createdAt, accountStatus);

    await issueEmailVerification({
      id: info.lastInsertRowid,
      email,
      account_status: accountStatus
    });

    return res.json({ status: 'verification_required', email });

  } catch (e) {

    const msg = String(e);

    if (msg.includes('users.email')) return res.status(409).json({ error: 'Email already registered' });

    if (msg.includes('users.username')) return res.status(409).json({ error: 'Username already taken' });

    console.error(e);

    return res.status(500).json({ error: 'Registration failed' });

  }

});




app.post('/api/register/verify', writeLimiter, validateBody(validateVerifyRegistrationRequest), async (req, res) => {

  try {

    const { email, code } = req.body;

    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!row) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    if (row.account_status === 'banned') {
      clearAuthCookie(res);
      return res.status(403).json({ error: 'account_banned' });
    }

    if (row.account_status !== 'pending_verification' && !row.email_verification_code_hash && !row.email_verification_expires_at) {
      const now = nowIso();
      await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);

      const user = mapUserRow(row, { last_login_at: now });
      const token = setAuthCookie(res, { id: user.id, email: user.email, username: user.username, is_admin: user.is_admin, account_status: user.account_status });
      return sendSchema(res, validateAuthResponse, { ...user, token, push_meta: publicPushMeta() });
    }

    if (!row.email_verification_code_hash || !row.email_verification_expires_at) {
      await issueEmailVerification(row);
      return res.status(400).json({ error: 'verification_not_requested' });
    }

    const expiresTs = Date.parse(row.email_verification_expires_at);
    if (!Number.isFinite(expiresTs) || expiresTs < Date.now()) {
      await issueEmailVerification(row);
      return res.status(400).json({ error: 'verification_expired' });
    }

    const expectedHash = row.email_verification_code_hash;
    const actualHash = hashValue(code);

    if (!safeCompare(expectedHash, actualHash)) {
      return res.status(400).json({ error: 'invalid_code' });
    }

    const now = nowIso();
    const accountStatus = row.account_status === 'banned' ? 'banned' : 'active';

    await db.prepare(`
      UPDATE users
         SET email_verification_code_hash = NULL,
             email_verification_expires_at = NULL,
             account_status = ?,
             last_login_at = ?
       WHERE id = ?
    `).run(accountStatus, now, row.id);

    if (accountStatus === 'banned') {
      clearAuthCookie(res);
      return res.status(403).json({ error: 'account_banned' });
    }

    const user = mapUserRow(row, {
      account_status: accountStatus,
      last_login_at: now
    });

    const token = setAuthCookie(res, { id: user.id, email: user.email, username: user.username, is_admin: user.is_admin, account_status: accountStatus });

    return sendSchema(res, validateAuthResponse, { ...user, token, push_meta: publicPushMeta() });

  } catch (err) {

    console.error('Verification error:', err);
    return res.status(400).json({ error: 'invalid_code' });

  }

});

app.post('/api/login', loginLimiter, validateBody(validateLoginRequest), async (req, res) => {

  try {

    const { email, password } = req.body;

    

    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!row || !row.password_hash) {

      return res.status(401).json({ error: 'Invalid credentials' });

    }



    const ok = await bcrypt.compare(password, row.password_hash);

    if (!ok) {

      return res.status(401).json({ error: 'Invalid credentials' });

    }



    const accountStatus = row.account_status || 'active';

    if (accountStatus === 'banned') {

      clearAuthCookie(res);

      return res.status(403).json({ error: 'account_banned' });

    }

    if (accountStatus === 'pending_verification') {
      await issueEmailVerification(row);
      return res.status(403).json({ error: 'email_unverified' });
    }


    const now = nowIso();

    try {

      await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);

    } catch (err) {

      console.error('Failed to update last_login_at:', err);

    }



    const user = mapUserRow(row, {

      account_status: accountStatus,

      last_login_at: now

    });

    const token = setAuthCookie(res, { id: user.id, email: user.email, username: user.username, is_admin: user.is_admin, account_status: accountStatus });

    return sendSchema(res, validateAuthResponse, { ...user, token, push_meta: publicPushMeta() });

  } catch (e) {

    console.error('Login error:', e);

    return res.status(401).json({ error: 'Invalid credentials' });

  }

});




app.post('/api/password/reset/request', writeLimiter, validateBody(validatePasswordResetRequest), async (req, res) => {

  const { email } = req.body;

  try {
    const row = await db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);

    if (row) {
      const resetDigits = generateVerificationCode();
      const token = `${resetDigits.slice(0, 3)} ${resetDigits.slice(3)}`;
      const tokenHash = hashValue(resetDigits);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await db.prepare(`
        UPDATE users
           SET reset_token_hash = ?,
               reset_token_expires_at = ?
         WHERE id = ?
      `).run(tokenHash, expiresAt, row.id);

      await publishBackgroundEvent(TOPICS.USER_PASSWORD_RESET, {
        userId: row.id,
        email: row.email,
        token
      }, { req });
    }
  } catch (err) {
    console.error('Password reset request failed:', err);
  }

  return res.json({ ok: true });

});

app.post('/api/password/reset/confirm', writeLimiter, validateBody(validatePasswordResetConfirmRequest), async (req, res) => {

  const { email, token, password } = req.body;
  const normalizedToken = String(token ?? '').replace(/\D/g, '');

  try {
    const row = await db.prepare(`
      SELECT id, reset_token_hash, reset_token_expires_at
      FROM users
      WHERE email = ?
    `).get(email);

    if (!row || !row.reset_token_hash) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    const expiresTs = Date.parse(row.reset_token_expires_at || '');
    if (!Number.isFinite(expiresTs) || expiresTs < Date.now()) {
      await db.prepare('UPDATE users SET reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = ?').run(row.id);
      return res.status(400).json({ error: 'token_expired' });
    }

    if (normalizedToken.length !== 6) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    if (!safeCompare(row.reset_token_hash, hashValue(normalizedToken))) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    const newHash = await bcrypt.hash(password, 10);

    await db.prepare(`
      UPDATE users
         SET password_hash = ?,
             reset_token_hash = NULL,
             reset_token_expires_at = NULL
       WHERE id = ?
    `).run(newHash, row.id);

    return res.json({ ok: true });
  } catch (err) {
    console.error('Password reset confirm failed:', err);
    return res.status(500).json({ error: 'reset_failed' });
  }

});

app.post('/api/logout', (_req, res) => {

  clearAuthCookie(res);

  return res.json({ ok: true });

});



app.get('/api/me', async (req, res) => {

  try {

    const u = authFromReq(req);

    if (!u) return res.json(null);



    const row = await db.prepare(`

      SELECT id, email, username, is_admin,

             COALESCE(paypal_email, '') AS paypal_email,

             COALESCE(location_preset, '') AS location_preset,

             profile_picture_url,

             profile_avatar_border_color,

             profile_avatar_border_style,

             profile_bg_image_url,

             profile_bg_video_url,

             created_at,

             COALESCE(account_status, 'active') AS account_status,

             status_note,

             status_updated_at,

             last_login_at,

             supporter_badge,

             supporter_since,

             supporter_tier,

             stripe_subscription_id,

             subscription_status,

             subscription_current_period_end,

             stripe_customer_id,

             karma

      FROM users

      WHERE id = ?

    `).get(u.id);



    if (!row) return res.json(null);

    

    const user = mapUserRow(row, {
      paypal_email: row.paypal_email,
      location_preset: row.location_preset,
      push_meta: publicPushMeta()
    });

    return res.json(user);

  } catch (e) {

    console.error('GET /api/me failed:', e);

    return res.status(500).json({ error: 'me_failed' });

  }

});



app.put('/api/me/paypal', auth, writeLimiter, async (req, res) => {

  try {

    const paymentInfo = String(req.body?.paypal_email ?? '').trim();

    if (paymentInfo.length > 240) {

      return res.status(400).json({ error: 'Payment info too long' });

    }

    const sanitized = paymentInfo.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();

    await db.prepare('UPDATE users SET paypal_email = ? WHERE id = ?').run(sanitized || null, req.user.id);

    return res.json({ ok: true, paypal_email: sanitized || '' });

  } catch (e) {

    console.error('Update PayPal failed:', e);

    return res.status(500).json({ error: 'update_failed' });

  }

});

app.put('/api/me/location-preset', auth, writeLimiter, async (req, res) => {

  try {

    const address = String(req.body?.location_preset || '').trim();

    if (address.length > 240) {

      return res.status(400).json({ error: 'Address too long' });

    }

    await db.prepare('UPDATE users SET location_preset = ? WHERE id = ?').run(address || null, req.user.id);

    return res.json({ ok: true, location_preset: address });

  } catch (e) {

    console.error('Update location preset failed:', e);

    return res.status(500).json({ error: 'update_failed' });

  }

});

app.put('/api/me/profile-about', auth, writeLimiter, async (req, res) => {

  try {

    const rawAbout = typeof req.body?.profile_about === 'string' ? req.body.profile_about : '';
    const normalized = rawAbout.replace(/\r\n/g, '\n').replace(/\u0000/g, '');
    const trimmed = normalized.trim();

    if (trimmed.length > 600) {
      return res.status(400).json({ error: 'About text is too long (max 600 characters)' });
    }

    await db.prepare('UPDATE users SET profile_about = ? WHERE id = ?').run(trimmed || null, req.user.id);

    return res.json({ ok: true, profile_about: trimmed });

  } catch (e) {

    console.error('PUT /api/me/profile-about failed:', e);
    return res.status(500).json({ error: 'profile_about_failed' });

  }

});

app.put('/api/me/profile-picture', auth, writeLimiter, async (req, res) => {

  try {

    const url = String(req.body?.profile_picture_url || '').trim();

    if (url && url.length > 500) {

      return res.status(400).json({ error: 'URL too long' });

    }

    // Validate URL is from allowed S3 bucket if provided
    if (url) {
      const allowedBase = process.env.S3_BASE_URL || '';
      if (allowedBase && !url.startsWith(allowedBase)) {
        return res.status(400).json({ error: 'Invalid image URL' });
      }
    }

    await db.prepare('UPDATE users SET profile_picture_url = ? WHERE id = ?').run(url || null, req.user.id);

    return res.json({ ok: true, profile_picture_url: url });

  } catch (e) {

    console.error('Update profile picture failed:', e);

    return res.status(500).json({ error: 'update_failed' });

  }

});

app.put('/api/me/profile-customization', auth, writeLimiter, async (req, res) => {

  try {

    const borderColor = String(req.body?.profile_avatar_border_color || '#ffffff').trim();
    const borderStyle = String(req.body?.profile_avatar_border_style || 'solid').trim();
    const rawBannerUrl = req.body?.profile_bg_image_url ?? req.body?.profile_bg_video_url ?? '';
    const bgImageUrl = String(rawBannerUrl || '').trim();

    // Check if user is premium subscriber
    const userRow = await db.prepare('SELECT subscription_status, supporter_tier FROM users WHERE id = ?').get(req.user.id);
    const isPremium = userRow?.subscription_status === 'active' || userRow?.supporter_tier === 'premium';

    if (!isPremium) {
      return res.status(403).json({ error: 'Profile customization is only available for premium subscribers' });
    }

    // Validate border color format (hex)
    if (!borderColor.match(/^#[0-9A-F]{6}$/i)) {
      return res.status(400).json({ error: 'Invalid border color format' });
    }

    // Validate border style
    if (!['solid', 'dashed'].includes(borderStyle)) {
      return res.status(400).json({ error: 'Invalid border style' });
    }

    // Validate banner image URL if provided
    if (bgImageUrl) {
      if (bgImageUrl.length > 500) {
        return res.status(400).json({ error: 'Image URL too long' });
      }
      if (!isAllowedBannerImageUrl(bgImageUrl)) {
        return res.status(400).json({ error: 'Image must be uploaded through Trovelr' });
      }
    }

    await db.prepare(`
      UPDATE users
      SET profile_avatar_border_color = ?,
          profile_avatar_border_style = ?,
          profile_bg_image_url = ?,
          profile_bg_video_url = NULL
      WHERE id = ?
    `).run(borderColor, borderStyle, bgImageUrl || null, req.user.id);

    return res.json({
      ok: true,
      profile_avatar_border_color: borderColor,
      profile_avatar_border_style: borderStyle,
      profile_bg_image_url: bgImageUrl,
      profile_bg_video_url: null
    });

  } catch (e) {

    console.error('Update profile customization failed:', e);

    return res.status(500).json({ error: 'update_failed' });

  }

});

// Get potential buyers for a listing (users who messaged about it)
app.get('/api/listings/:id/potential-buyers', auth, async (req, res) => {
  try {
    const listingId = Number(req.params.id);

    // Verify user owns this listing
    const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').get(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (listing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your listing' });
    }

    // Get all conversations for this listing
    const conversations = await db.prepare(`
      SELECT DISTINCT c.id as conversation_id, c.a_user_id, c.b_user_id
      FROM conversations c
      WHERE c.listing_id = ?
        AND (c.a_user_id = ? OR c.b_user_id = ?)
    `).all(listingId, req.user.id, req.user.id);

    if (!conversations || conversations.length === 0) {
      return res.json({ buyers: [] });
    }

    // Get the other user (buyer) from each conversation and their last message time
    const buyerPromises = conversations.map(async (conv) => {
      const buyerId = conv.a_user_id === req.user.id ? conv.b_user_id : conv.a_user_id;

      // Get buyer info
      const buyer = await db.prepare(`
        SELECT id, username, profile_picture_url, supporter_badge
        FROM users
        WHERE id = ?
      `).get(buyerId);

      if (!buyer) return null;

      // Get last message from this buyer in this conversation
      const lastMessage = await db.prepare(`
        SELECT created_at
        FROM messages
        WHERE conversation_id = ?
          AND sender_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(conv.conversation_id, buyerId);

      return {
        id: buyer.id,
        username: buyer.username,
        profile_picture_url: buyer.profile_picture_url,
        supporter_badge: buyer.supporter_badge,
        last_message_at: lastMessage?.created_at || null
      };
    });

    let buyers = await Promise.all(buyerPromises);
    buyers = buyers.filter(b => b !== null);

    // Sort by most recent message first
    buyers.sort((a, b) => {
      if (!a.last_message_at) return 1;
      if (!b.last_message_at) return -1;
      return b.last_message_at.localeCompare(a.last_message_at);
    });

    res.json({ buyers });
  } catch (err) {
    console.error('Get potential buyers error:', err);
    res.status(500).json({ error: 'Failed to get potential buyers' });
  }
});

// Award karma for a transaction
app.post('/api/listings/:id/award-karma', auth, async (req, res) => {
  try {
    const listingId = Number(req.params.id);
    const buyerId = Number(req.body.buyer_id);

    if (!buyerId) {
      return res.status(400).json({ error: 'buyer_id required' });
    }

    // Verify user owns this listing
    const listing = await db.prepare('SELECT user_id, sold FROM listings WHERE id = ?').get(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (listing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your listing' });
    }

    // Check if karma already awarded for this listing
    const existing = await db.prepare('SELECT id FROM karma_transactions WHERE listing_id = ?').get(listingId);
    if (existing) {
      return res.status(400).json({ error: 'Karma already awarded for this listing' });
    }

    // Get buyer info
    const buyer = await db.prepare('SELECT id, supporter_tier FROM users WHERE id = ?').get(buyerId);
    if (!buyer) {
      return res.status(404).json({ error: 'Buyer not found' });
    }

    // Check if both users are premium subscribers
    const sellerIsPremium = req.user.supporter_tier === 'premium';
    const buyerIsPremium = buyer.supporter_tier === 'premium';
    const shouldAward = sellerIsPremium && buyerIsPremium;

    const sellerPoints = 1;
    const buyerPoints = 2;

    // Create karma transaction record
    await db.prepare(`
      INSERT INTO karma_transactions (listing_id, seller_id, buyer_id, seller_points, buyer_points, awarded, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(listingId, req.user.id, buyerId, sellerPoints, buyerPoints, shouldAward ? 1 : 0, nowIso());

    // If both are premium, award karma
    if (shouldAward) {
      await db.prepare('UPDATE users SET karma = karma + ? WHERE id = ?').run(sellerPoints, req.user.id);
      await db.prepare('UPDATE users SET karma = karma + ? WHERE id = ?').run(buyerPoints, buyerId);
    }

    // Get updated user
    const refreshed = await getUserWithStatus(req.user.id);
    const user = mapUserRow(refreshed);

    res.json({
      success: true,
      awarded: shouldAward,
      user,
      message: shouldAward ? 'Karma awarded!' : 'Transaction recorded (one or both users not premium)'
    });
  } catch (err) {
    console.error('Award karma error:', err);
    res.status(500).json({ error: 'Failed to award karma' });
  }
});

/* ------------------------------------------------------------------ */

/* Supporter Routes                                                   */

/* ------------------------------------------------------------------ */

app.post('/api/supporters/checkout', auth, async (req, res) => {

  if (!stripe) {

    return res.status(503).json({ error: 'stripe_unavailable' });

  }

  try {

    const tier = String(req.body?.tier || 'basic').toLowerCase();

    if (!['basic', 'premium'].includes(tier)) {

      return res.status(400).json({ error: 'invalid_tier' });

    }

    const successUrl = resolveSupporterReturnUrl(req, SUPPORTER_SUCCESS_PATH);

    const cancelUrl = resolveSupporterReturnUrl(req, SUPPORTER_CANCEL_PATH);

    const sessionConfig = {

      client_reference_id: String(req.user.id),

      customer_email: req.user.email,

      success_url: successUrl,

      cancel_url: cancelUrl,

      payment_method_types: ['card'],

      metadata: {

        user_id: String(req.user.id),

        tier: tier

      }

    };

    if (tier === 'premium') {

      // Subscription mode for premium tier

      if (!STRIPE_PREMIUM_PRICE_ID) {

        return res.status(503).json({ error: 'premium_tier_not_configured' });

      }

      sessionConfig.mode = 'subscription';

      sessionConfig.line_items = [

        {

          quantity: 1,

          price: STRIPE_PREMIUM_PRICE_ID

        }

      ];

      // Store user_id in subscription metadata too

      sessionConfig.subscription_data = {

        metadata: {

          user_id: String(req.user.id)

        }

      };

    } else {

      // One-time payment mode for basic tier

      sessionConfig.mode = 'payment';

      sessionConfig.line_items = [

        {

          quantity: 1,

          price_data: {

            currency: SUPPORTER_DONATION_CURRENCY,

            unit_amount: SUPPORTER_DONATION_AMOUNT,

            product_data: {

              name: 'Trovelr Supporter Badge',

              description: 'One-time donation to support Trovelr'

            }

          }

        }

      ];

    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    if (!session?.url) {

      return res.status(500).json({ error: 'checkout_unavailable' });

    }

    try {

      await db.prepare('UPDATE users SET supporter_checkout_id = ? WHERE id = ?').run(session.id, req.user.id);

    } catch (err) {

      console.warn('Failed to persist supporter checkout id:', err);

    }

    const amount = tier === 'premium' ? SUPPORTER_PREMIUM_AMOUNT : SUPPORTER_DONATION_AMOUNT;

    return res.json({

      url: session.url,

      session_id: session.id,

      tier: tier,

      amount: amount,

      currency: SUPPORTER_DONATION_CURRENCY

    });

  } catch (err) {

    console.error('Supporter checkout failed:', err);

    return res.status(500).json({ error: 'checkout_failed' });

  }

});

app.post('/api/supporters/confirm', auth, async (req, res) => {

  if (!stripe) {

    return res.status(503).json({ error: 'stripe_unavailable' });

  }

  const sessionId = String(req.body?.session_id || '').trim();

  if (!sessionId) {

    return res.status(400).json({ error: 'session_required' });

  }

  try {

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {

      return res.status(404).json({ error: 'session_not_found' });

    }

    const clientRef = session.client_reference_id || session.metadata?.user_id;

    if (clientRef && Number(clientRef) !== Number(req.user.id)) {

      return res.status(403).json({ error: 'not_authorized' });

    }

    const isPaid = session.payment_status === 'paid' || session.status === 'complete';

    if (!isPaid) {

      return res.status(400).json({ error: 'payment_incomplete' });

    }

    const rawTier = session.metadata?.tier || (session.mode === 'subscription' ? 'premium' : 'basic');
    const tier = String(rawTier || 'basic').toLowerCase() === 'premium' ? 'premium' : 'basic';
    const supporterSince = nowIso();
    const badgeCode = tier === 'premium' ? SUPPORTER_BADGE_CODE_PREMIUM : SUPPORTER_BADGE_CODE;

    let subscriptionId = null;
    let subscriptionStatus = null;
    let subscriptionPeriodEnd = null;
    let stripeCustomerId = session.customer || null;

    if (tier === 'premium' && session.subscription && stripe?.subscriptions?.retrieve) {
      try {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        if (subscription) {
          subscriptionId = subscription.id || session.subscription;
          subscriptionStatus = subscription.status || null;
          if (subscription.current_period_end) {
            subscriptionPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
          }
          if (subscription.customer) {
            stripeCustomerId = subscription.customer;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch subscription after supporter confirmation:', err?.message || err);
        subscriptionId = session.subscription;
        subscriptionStatus = session.status === 'complete' ? 'active' : (session.status || 'active');
      }
    }

    const updateSql = tier === 'premium'
      ? `
      UPDATE users
         SET supporter_badge = ?,
             supporter_since = COALESCE(supporter_since, ?),
             supporter_tier = ?,
             supporter_checkout_id = NULL,
             stripe_subscription_id = COALESCE(?, stripe_subscription_id),
             subscription_status = COALESCE(?, subscription_status),
             subscription_current_period_end = COALESCE(?, subscription_current_period_end),
             stripe_customer_id = COALESCE(?, stripe_customer_id)
       WHERE id = ?
    `
      : `
      UPDATE users
         SET supporter_badge = ?,
             supporter_since = COALESCE(supporter_since, ?),
             supporter_tier = ?,
             supporter_checkout_id = NULL
       WHERE id = ?
    `;

    const params = tier === 'premium'
      ? [
          badgeCode,
          supporterSince,
          tier,
          subscriptionId,
          subscriptionStatus,
          subscriptionPeriodEnd,
          stripeCustomerId,
          req.user.id
        ]
      : [
          badgeCode,
          supporterSince,
          tier,
          req.user.id
        ];

    await db.prepare(updateSql).run(...params);

    const refreshed = await getUserWithStatus(req.user.id);

    const user = mapUserRow(refreshed);

    req.user = user;

    return res.json(user);

  } catch (err) {

    console.error('Supporter confirm failed:', err);

    return res.status(500).json({ error: 'confirmation_failed' });

  }

});

app.post('/api/supporters/cancel', auth, async (req, res) => {

  if (!stripe) {

    return res.status(503).json({ error: 'stripe_unavailable' });

  }

  try {

    const subscriptionId = req.user.stripe_subscription_id;

    if (!subscriptionId) {

      return res.status(400).json({ error: 'no_active_subscription' });

    }

    // Cancel the subscription at period end (user keeps benefits until then)
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });

    // Update user record to reflect cancellation status
    await db.prepare(`
      UPDATE users
      SET subscription_status = 'canceling'
      WHERE id = ?
    `).run(req.user.id);

    const refreshed = await getUserWithStatus(req.user.id);

    const user = mapUserRow(refreshed);

    return res.json({ success: true, user });

  } catch (err) {

    console.error('Cancel subscription failed:', err);

    return res.status(500).json({ error: 'cancellation_failed' });

  }

});

app.delete('/api/me', auth, async (req, res) => {
  try {
    console.log('Delete account request body:', req.body);
    const { confirmation } = req.body;

    if (confirmation !== 'confirm') {
      console.log('Invalid confirmation:', confirmation);
      return res.status(400).json({ error: 'Invalid confirmation' });
    }

    const userId = req.user.id;
    console.log('Deleting account for user:', userId);

    // Delete in proper order to handle foreign key constraints
    // PostgreSQL (and SQLite with FK enabled) require child records deleted first

    // Get all listing IDs for this user first
    const userListings = await db.prepare('SELECT id FROM listings WHERE user_id = ?').all(userId);
    const listingIds = userListings.map(l => l.id);
    console.log('Found listings:', listingIds);

    // Delete listing images (child of listings)
    if (listingIds.length > 0) {
      const placeholders = listingIds.map(() => '?').join(',');
      await db.prepare(`DELETE FROM listing_images WHERE listing_id IN (${placeholders})`).run(...listingIds);
      console.log('Deleted listing images');
    }

    // Get all conversations for this user
    const userConversations = await db.prepare('SELECT id FROM conversations WHERE a_user_id = ? OR b_user_id = ?').all(userId, userId);
    const conversationIds = userConversations.map(c => c.id);
    console.log('Found conversations:', conversationIds.length);

    // Get all message IDs from user's conversations
    let messageIds = [];
    if (conversationIds.length > 0) {
      const placeholders = conversationIds.map(() => '?').join(',');
      const userMessages = await db.prepare(`SELECT id FROM messages WHERE conversation_id IN (${placeholders})`).all(...conversationIds);
      messageIds = userMessages.map(m => m.id);
      console.log('Found messages:', messageIds.length);

      // Delete message images (child of messages)
      if (messageIds.length > 0) {
        const msgPlaceholders = messageIds.map(() => '?').join(',');
        await db.prepare(`DELETE FROM message_images WHERE message_id IN (${msgPlaceholders})`).run(...messageIds);
        console.log('Deleted message images');
      }

      // Delete all messages in user's conversations
      await db.prepare(`DELETE FROM messages WHERE conversation_id IN (${placeholders})`).run(...conversationIds);
      console.log('Deleted messages');
    }

    // Delete all user's conversations
    await db.prepare('DELETE FROM conversations WHERE a_user_id = ? OR b_user_id = ?').run(userId, userId);
    console.log('Deleted conversations');

    // Delete listing upload drafts
    await db.prepare('DELETE FROM listing_upload_drafts WHERE user_id = ?').run(userId);
    console.log('Deleted upload drafts');

    // Delete all user's listings
    await db.prepare('DELETE FROM listings WHERE user_id = ?').run(userId);
    console.log('Deleted listings');

    // Delete all user's reports (both made and received)
    await db.prepare('DELETE FROM seller_reports WHERE reporter_user_id = ? OR reported_user_id = ?').run(userId, userId);
    console.log('Deleted reports');

    // Delete user's push subscriptions
    await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    console.log('Deleted push subscriptions');

    // Delete the user account
    await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    console.log('Deleted user account');

    // Clear auth cookie
    clearAuthCookie(res);

    return res.json({ ok: true });

  } catch (e) {
    console.error('Delete account failed:', e);
    console.error('Error stack:', e.stack);
    return res.status(500).json({ error: 'delete_failed', message: e.message });
  }
});

app.post('/api/push/subscribe', auth, async (req, res) => {
  try {
    if (!isPushAvailable()) {
      return res.status(503).json({ error: 'push_unavailable' });
    }

    const normalized = normalizePushSubscriptionInput(req.body);
    if (!normalized || normalized.error) {
      return res.status(400).json({ error: normalized?.error || 'invalid_subscription' });
    }

    await savePushSubscription(req.user.id, normalized.value);
    return res.status(204).end();
  } catch (e) {
    console.error('Push subscribe failed:', e);
    return res.status(500).json({ error: 'push_subscribe_failed' });
  }
});


app.delete('/api/push/unsubscribe', auth, async (req, res) => {
  try {
    let endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    if (!endpoint) {
      const normalized = normalizePushSubscriptionInput(req.body);
      if (normalized && !normalized.error) {
        endpoint = normalized.value.endpoint;
      }
    }

    if (!endpoint) {
      return res.status(400).json({ error: 'invalid_endpoint' });
    }

    await deletePushSubscription(req.user.id, endpoint);
    return res.status(204).end();
  } catch (e) {
    console.error('Push unsubscribe failed:', e);
    return res.status(500).json({ error: 'push_unsubscribe_failed' });
  }
});




/* ------------------------------------------------------------------ */

/* Listings                                                            */

/* ------------------------------------------------------------------ */

app.get('/api/listings', async (req, res) => {

  try {

    const qRaw = (req.query.q || '').toString().trim();
    const searchTokens = tokenizeSearchInput(qRaw);
    const hasSearch = searchTokens.length > 0;

    const locRaw = (req.query.loc || '').toString().trim();

    const mine = req.query.mine === '1';

    const noimg = req.query.noimg === '1';

    const sort = String(req.query.sort || 'new').toLowerCase();
    const isCursorById = sort === 'new';



    const limitParam = Number(req.query.limit);

    const pageParam = Number(req.query.page);

    const rawCursorParam = Number(req.query.cursor || req.query.before || req.query.before_id);



    let limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(75, limitParam)) : 75;

    const hasCursor = isCursorById && Number.isFinite(rawCursorParam) && rawCursorParam > 0;

    const cursorParam = hasCursor ? rawCursorParam : null;

    let page = 1;

    if (isCursorById) {

      if (!hasCursor && Number.isFinite(pageParam) && pageParam > 0) {

        page = pageParam;

      }

    } else {

      if (Number.isFinite(rawCursorParam) && rawCursorParam > 0) {

        page = rawCursorParam;

      } else if (Number.isFinite(pageParam) && pageParam > 0) {

        page = pageParam;

      }

    }

    const hasPage = page > 1;

    const offset = hasPage ? (page - 1) * limit : 0;



    const FIELDS_PUBLIC = `

      l.id, l.user_id, ${noimg ? '' : 'l.image_data,'}

      l.title, l.description, l.location, l.price, l.created_at,

      l.inquiry_enabled, l.sold,

      u.username AS owner_username,

      u.supporter_badge AS owner_supporter_badge,

      u.supporter_since AS owner_supporter_since

    `;

    const FIELDS_MINE = `

      l.id, l.user_id, ${noimg ? '' : 'l.image_data,'}

      l.title, l.description, l.location, l.price, l.created_at,

      l.tags, l.lat, l.lon, l.enable_nearby, l.inquiry_enabled, l.sold,

      u.username AS owner_username,

      u.supporter_badge AS owner_supporter_badge,

      u.supporter_since AS owner_supporter_since

    `;



    let orderSQL = 'ORDER BY l.id DESC';

    switch (sort) {

      case 'price_asc':

        orderSQL = 'ORDER BY l.price ASC, l.id DESC';

        break;

      case 'price_desc':

        orderSQL = 'ORDER BY l.price DESC, l.id DESC';

        break;

      case 'city':

        orderSQL = 'ORDER BY LOWER(l.location) ASC, l.id DESC';

        break;

    }



    const itemsForUser = async (userId, withPagination = false) => {

      const fields = FIELDS_MINE;

      const where = ['l.user_id = @uid'];

      const params = { uid: userId };

      

      if (hasSearch) {

        applyListingSearchTokens(where, params, searchTokens);

      }



      const locParams = {};

      if (locRaw) {

        const locCity = (cityOf(locRaw) || locRaw || '').toString().trim().toLowerCase();

        if (locCity && locCity !== 'no location') {

          locParams.loc = `${locCity.replace(/%/g, '')}%`;

          where.push('LOWER(l.location) LIKE @loc');

        }

      }



      const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';



      if (!withPagination) {

        const sql = `

          SELECT ${fields}

          FROM listings l

          JOIN users u ON u.id = l.user_id

          ${whereSQL}

          ${orderSQL}

        `;

        const rows = await db.prepare(sql).all({ ...params, ...locParams });

        return rows.map(r => {

          const out = { ...r, tags: (r.tags ? String(r.tags).split(',') : []) };

          out.image_data = canonicalAssetUrl(out.image_data);

          return out;

        });

      }



      const lim = limit + 1;

      const sql = `

        SELECT ${fields}

        FROM listings l

        JOIN users u ON u.id = l.user_id

        ${whereSQL}

        ${orderSQL}

        LIMIT @lim OFFSET @off

      `;

      const rows = await db.prepare(sql).all({ ...params, ...locParams, lim, off: offset });

      const has_more = rows.length > limit;

      const items = has_more ? rows.slice(0, limit) : rows;

      const next_cursor = items.length ? items[items.length - 1].id : null;

      return { 

        items: items.map(r => {

          const out = { ...r, tags: (r.tags ? String(r.tags).split(',') : []) };

          out.image_data = canonicalAssetUrl(out.image_data);

          return out;

        }), 

        page, 

        limit, 

        has_more, 

        next_cursor 

      };

    };



    if (!mine) {

      const fields = FIELDS_PUBLIC.trim();

      const where = ['l.sold = 0'];

      const params = {};

      

      if (hasSearch) {

        applyListingSearchTokens(where, params, searchTokens);

      }



      const locParams = {};

      if (locRaw) {

        const locCity = (cityOf(locRaw) || locRaw || '').toString().trim().toLowerCase();

        if (locCity && locCity !== 'no location') {

          locParams.loc = `${locCity.replace(/%/g, '')}%`;

          where.push('LOWER(l.location) LIKE @loc');

        }

      }



      if (hasCursor) {

        params.before = cursorParam;

        where.push('l.id < @before');

      }



      const whereSQL = where.length ? ('WHERE ' + where.join(' AND ')) : '';

      const lim = limit + 1;



      let sql = `

        SELECT ${fields}

        FROM listings l

        JOIN users u ON u.id = l.user_id

        ${whereSQL}

        ${orderSQL}

        LIMIT @lim

      `;



      const queryParams = { ...params, ...locParams, lim };

      if (!isCursorById) {

        sql += ' OFFSET @off';

        queryParams.off = offset;

      }



      const rows = await db.prepare(sql).all(queryParams);

      const has_more = rows.length > limit;

      const items = has_more ? rows.slice(0, limit) : rows;

      const next_cursor = isCursorById

        ? (items.length ? items[items.length - 1].id : null)

        : (has_more ? page + 1 : null);

      const normalizedItems = items.map(r => {

        const out = { ...r };

        if (Object.prototype.hasOwnProperty.call(out, 'image_data')) {

          out.image_data = canonicalAssetUrl(out.image_data);

        }

        return out;

      });



      return res.json({ items: normalizedItems, page, limit, has_more, next_cursor });

    }



    const session = authFromReq(req);

    if (!session) return res.status(401).json({ error: 'Not authenticated' });



    const userRow = await getUserWithStatus(session.id);

    if (!userRow) {

      clearAuthCookie(res);

      return res.status(401).json({ error: 'Not authenticated' });

    }

    if (userRow.account_status === 'banned') {

      clearAuthCookie(res);

      return res.status(403).json({ error: 'account_banned' });

    }

    if (userRow.account_status === 'locked') {

      return res.status(423).json({ error: 'account_locked' });

    }



    const wantsPagination = hasCursor || hasPage || Number.isFinite(limitParam);

    if (!wantsPagination) {

      const arr = await itemsForUser(userRow.id, false);

      return res.json(arr);

    }



    const paged = await itemsForUser(userRow.id, true);

    return res.json(paged);

  } catch (e) {

    console.error('GET /api/listings failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.get('/api/listings/covers', async (req, res) => {

  try {

    const idsStr = String(req.query.ids || '').trim();

    if (!idsStr) return res.json([]);

    

    let ids = idsStr.split(',').map(s => Number(s)).filter(Number.isFinite);

    ids = Array.from(new Set(ids)).slice(0, 200);

    if (!ids.length) return res.json([]);

    

    const placeholders = ids.map(()=>'?').join(',');

    const rows = await db.prepare(`

      SELECT l.id,

           COALESCE(

              (SELECT COALESCE(url, image_data)

               FROM listing_images

                WHERE listing_id = l.id

                  AND url IS NOT NULL

               ORDER BY position ASC, id ASC

                 LIMIT 1),

               l.image_data

             ) AS image_data

        FROM listings l

       WHERE l.id IN (${placeholders})

    `).all(...ids);

    

    const normalized = rows.map(row => ({

      ...row,

      image_data: canonicalAssetUrl(row.image_data)

    }));



    res.json(normalized);

  } catch (e) {

    console.error('GET /api/listings/covers failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});

app.post('/api/reports', auth, writeLimiter, async (req, res) => {

  try {

    const reporterId = req.user.id;

    const reportedRaw = req.body?.reported_user_id ?? req.body?.reportedUserId;

    const reportedUserId = Number(reportedRaw);

    const listingRaw = req.body?.listing_id ?? req.body?.listingId;

    const listingId = listingRaw === undefined || listingRaw === null || listingRaw === '' ? null : Number(listingRaw);

    let reasons = req.body?.reasons;

    if (!Array.isArray(reasons)) reasons = [];



    const normalizedReasons = [];

    const seen = new Set();

    for (const code of reasons) {

      if (normalizedReasons.length >= 5) break;

      const val = String(code || '').toLowerCase().trim();

      if (!val) continue;

      if (!REPORT_REASON_CODES.has(val)) continue;

      if (seen.has(val)) continue;

      normalizedReasons.push(val);

      seen.add(val);

    }



    if (!Number.isFinite(reportedUserId) || reportedUserId <= 0) {

      return res.status(400).json({ error: 'invalid_reported_user' });

    }

    if (reportedUserId === reporterId) {

      return res.status(400).json({ error: 'cannot_report_self' });

    }

    if (!normalizedReasons.length) {

      return res.status(400).json({ error: 'invalid_reasons' });

    }



    const detailsRaw = (req.body?.details || '').toString().trim();

    const details = detailsRaw ? detailsRaw.slice(0, 500) : null;



    const captcha = req.body?.captcha || {};

    const a = Number(captcha?.a);

    const b = Number(captcha?.b);

    const answer = Number(captcha?.answer);

    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(answer) || a + b !== answer) {

      return res.status(400).json({ error: 'captcha_invalid' });

    }

    const captchaQuestion = `${a}+${b}`;



    const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(reportedUserId);

    if (!target) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    let finalListingId = null;

    if (listingId !== null) {

      if (!Number.isFinite(listingId) || listingId <= 0) {

        return res.status(400).json({ error: 'invalid_listing' });

      }

      const listing = await db.prepare('SELECT id, user_id FROM listings WHERE id = ?').get(listingId);

      if (!listing) {

        return res.status(404).json({ error: 'listing_not_found' });

      }

      if (listing.user_id !== reportedUserId) {

        return res.status(400).json({ error: 'listing_owner_mismatch' });

      }

      finalListingId = listing.id;

    }



    await db.prepare(`

      INSERT INTO seller_reports (reporter_user_id, reported_user_id, listing_id, reasons, details, captcha_question, created_at)

      VALUES (?, ?, ?, ?, ?, ?, ?)

    `).run(

      reporterId,

      reportedUserId,

      finalListingId,

      JSON.stringify(normalizedReasons),

      details || null,

      captchaQuestion,

      nowIso()

    );



    return res.json({ ok: true });

  } catch (e) {

    console.error('Submit report failed:', e);

    return res.status(500).json({ error: 'report_failed' });

  }

});



app.post(
  '/api/listings',
  auth,
  writeLimiter,
  (req, res, next) => {
    if (isLockedAccount(req.user)) return respondLocked(res);
    return next();
  },
  validateBody(validateCreateListingRequest),
  async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

      const { title, description, location, price, tags, enable_nearby, inquiry_enabled } = req.body || {};

    

    // Since we're using S3 only, we don't handle images here

    // Images will be uploaded separately via /api/uploads/sign and /api/uploads/finalize

    

    const descStr = String(description ?? '').slice(0,400);

    const locStr = String(location ?? '').slice(0,80);

    const pNum = Number(price);

    const safePrice = (Number.isFinite(pNum) && pNum >= 0) ? pNum : 0;

    const tagStr = normalizeTags(tags);

    const safeTitle = shortTitle(title) || shortTitle(description);

    const uploadTokensRaw = Array.isArray(req.body.upload_tokens)

      ? req.body.upload_tokens

      : (Array.isArray(req.body.uploadTokens) ? req.body.uploadTokens : []);

    const uploadTokens = Array.from(new Set(

      uploadTokensRaw

        .map((token) => typeof token === 'string' ? token.trim() : '')

        .filter(Boolean)

    )).slice(0, 12);

    if (!uploadTokens.length) {

      return res.status(400).json({ error: 'image_required' });

    }

    const tokenParams = { userId: req.user.id };

    const placeholders = uploadTokens.map((_, idx) => {

      const key = `t${idx}`;

      tokenParams[key] = uploadTokens[idx];

      return `@${key}`;

    }).join(', ');

    const rows = placeholders

      ? await db.prepare(`

          SELECT token, key, url, width, height, bytes, created_at

            FROM listing_upload_drafts

           WHERE user_id = @userId

             AND token IN (${placeholders})

        `).all(tokenParams)

      : [];

    const rowByToken = new Map((rows || []).map((r) => [r.token, r]));

    const orderedRows = uploadTokens.map((token) => rowByToken.get(token)).filter(Boolean);

    const uploads = orderedRows.map((r) => {

      const safeWidth = Number(r?.width);

      const safeHeight = Number(r?.height);

      const safeBytes = Number(r?.bytes);

      const createdAt = Number.isFinite(Number(r?.created_at)) ? Number(r.created_at) : Math.floor(Date.now() / 1000);

      const url = canonicalAssetUrl(String(r?.url || ''));

      return {

        token: r?.token,

        key: String(r?.key || ''),

        url,

        width: Number.isFinite(safeWidth) ? safeWidth : null,

        height: Number.isFinite(safeHeight) ? safeHeight : null,

        bytes: Number.isFinite(safeBytes) ? safeBytes : null,

        createdAt

      };

    }).filter((item) => typeof item.url === 'string' && item.url && isAllowedPublicUrl(item.url));

    if (!uploads.length) {

      return res.status(400).json({ error: 'image_required' });

    }

    try {

      const flagged = await moderateListingContent({

        title: String(safeTitle || ''),

        description: String(descStr || ''),

        imageUrls: uploads.map((item) => item.url)

      });

      if (flagged?.length) {
        await recordFlaggedAttempt({ userId: req.user?.id, title: safeTitle, flagged });

        return res.status(400).json({ error: 'moderation_flagged', flagged });

      }

    } catch (err) {

      if (err?.code === 'moderation_failed') {

        console.error('Listing moderation failed:', err.cause?.message || err.cause || err);

        return res.status(502).json({ error: 'moderation_failed' });

      }

      throw err;

    }



    let lat = Number(req.body.lat);

    let lon = Number(req.body.lon);

    if (!Number.isFinite(lat)) lat = null;

    if (!Number.isFinite(lon)) lon = null;



    const enNearby = enable_nearby ? 1 : 0;
    const inquiryEnabled = inquiry_enabled ? 1 : 0;



    const info = await db.prepare(`

      INSERT INTO listings (user_id, image_data, title, description, location, price, created_at, tags, lat, lon, enable_nearby, inquiry_enabled)

      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    `).run(

      req.user.id,

      null, // No cover image initially since S3 uploads happen separately

      String(safeTitle),

      String(descStr),

      String(locStr),

      Number(safePrice),

      nowIso(),

      tagStr,

      lat, lon, enNearby, inquiryEnabled

    );



    const listingId = info.lastInsertRowid;

    await maybeUpdateListingGeography(listingId, lat, lon);



    if (uploads.length) {

      const pRow = await db.prepare('SELECT MAX(position) AS maxp FROM listing_images WHERE listing_id = ?').get(listingId);

      let pos = Number.isFinite(pRow?.maxp) ? (pRow.maxp + 1) : 0;

      let coverUrl = null;

      for (const upload of uploads) {

        await db.prepare(`

          INSERT INTO listing_images (listing_id, image_data, position, key, url, width, height, bytes, created_at)

          VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)

        `).run(

          listingId,

          pos,

          upload.key,

          upload.url,

          upload.width,

          upload.height,

          upload.bytes,

          upload.createdAt

        );

        if (!coverUrl) coverUrl = upload.url;

        pos += 1;

      }

      if (coverUrl) {

        await db.prepare(`

          UPDATE listings

             SET image_data = COALESCE(NULLIF(image_data, ''), @url)

           WHERE id = @listingId

        `).run({ listingId, url: coverUrl });

      }

      const tokensToDelete = uploads.map((item) => item.token).filter(Boolean);

      if (tokensToDelete.length) {

        const deleteParams = { userId: req.user.id };

        const deletePlaceholders = tokensToDelete.map((token, idx) => {

          const key = `d${idx}`;

          deleteParams[key] = token;

          return `@${key}`;

        }).join(', ');

        if (deletePlaceholders) {

          await db.prepare(`

            DELETE FROM listing_upload_drafts

             WHERE user_id = @userId

               AND token IN (${deletePlaceholders})

          `).run(deleteParams);

        }

      }

    }



    try { await incrementCityCount(locStr); } catch {}



    // NOTE: Images are NOT inserted here anymore - they come via S3 upload flow

    

    const row = await db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);

    if (row && Object.prototype.hasOwnProperty.call(row, 'image_data')) {

      row.image_data = canonicalAssetUrl(row.image_data);

    }

    await invalidateNearbyCache();

    if (row) {
      await publishBackgroundEvent(TOPICS.NEARBY_LISTING_AVAILABLE, { listing: row }, { req });
    }

    return sendSchema(res, validateListingResponse, row);

  } catch (e) {

    const msg = String(e && e.message || e || 'db_error');

    console.error('Create listing failed:', msg);

    return res.status(500).json({ error: 'server_error', detail: msg });

  }

});



/* ------------------------------------------------------------------ */

/* Get listings by specific user                                      */

/* ------------------------------------------------------------------ */

app.get('/api/users/:userId', async (req, res) => {

  try {

    const userId = Number(req.params.userId);

    if (!Number.isFinite(userId)) {

      return res.status(400).json({ error: 'Invalid user ID' });

    }



    const user = await db.prepare(`
      SELECT id,
             username,
             created_at,
             supporter_badge,
             supporter_since,
             profile_picture_url,
             profile_avatar_border_color,
             profile_avatar_border_style,
             profile_bg_image_url,
             profile_bg_video_url,
             profile_about,
             karma
        FROM users
       WHERE id = ?
    `).get(userId);

    if (!user) {

      return res.status(404).json({ error: 'User not found' });

    }



    return res.json({

      id: user.id,

      username: user.username || null,

      created_at: user.created_at,

      supporter_badge: user.supporter_badge || null,

      supporter_since: user.supporter_since || null,

      profile_picture_url: user.profile_picture_url || null,

      profile_avatar_border_color: user.profile_avatar_border_color || null,

      profile_avatar_border_style: user.profile_avatar_border_style || null,

        profile_bg_image_url: user.profile_bg_image_url || user.profile_bg_video_url || null,

        profile_bg_video_url: user.profile_bg_video_url || user.profile_bg_image_url || null,

        profile_about: user.profile_about || '',

        karma: user.karma || 0

    });

  } catch (e) {

    console.error('GET /api/users/:userId failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.get('/api/users/:userId/listings', userListingsLimiter, async (req, res) => {

  try {

    const userId = Number(req.params.userId);

    if (!Number.isFinite(userId)) {

      return res.status(400).json({ error: 'Invalid user ID' });

    }



    // Check if user exists

    const userExists = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);

    if (!userExists) {

      return res.status(404).json({ error: 'User not found' });

    }



    // Get all public listings for this user

    const rows = await db.prepare(`

      SELECT

        l.id, l.user_id, l.image_data,

        l.title, l.description, l.location, l.price, l.created_at,

        l.sold,

        u.username AS owner_username,

        u.supporter_badge AS owner_supporter_badge,

        u.supporter_since AS owner_supporter_since

      FROM listings l

      JOIN users u ON u.id = l.user_id

      WHERE l.user_id = ?

      ORDER BY l.id DESC

    `).all(userId);



    const normalized = rows.map(row => ({

      ...row,

      image_data: canonicalAssetUrl(row.image_data)

    }));



    return res.json(normalized);

  } catch (e) {

    console.error('GET /api/users/:userId/listings failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});





app.put(
  '/api/listings/:id',
  auth,
  writeLimiter,
  (req, res, next) => {
    if (isLockedAccount(req.user)) return respondLocked(res);
    return next();
  },
  validateBody(validateUpdateListingRequest),
  async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

    const id = Number(req.params.id);

    const existing = await db.prepare('SELECT * FROM listings WHERE id = ?').get(id);

    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (!req.user.is_admin && existing.user_id !== req.user.id) {

      return res.status(403).json({ error: 'Not your listing' });

    }



    const { title, description, location, price, tags, deletedImages } = req.body || {};



    const existingImages = await db.prepare('SELECT url, image_data FROM listing_images WHERE listing_id = ? ORDER BY position, id')

      .all(id);

    const existingImageUrls = existingImages

      .map((img) => canonicalAssetUrl(img?.url || img?.image_data))

      .filter((url) => typeof url === 'string' && url);

    const deleteCanonical = new Set();

    if (Array.isArray(deletedImages) && deletedImages.length > 0) {

      for (const imageUrl of deletedImages) {

        const raw = String(imageUrl ?? '').trim();

        if (!raw) continue;

        const variants = assetVariants(raw);

        const pool = variants.length ? variants : [raw];

        for (const variant of pool) {

          const canonical = canonicalAssetUrl(variant);

          if (typeof canonical === 'string' && canonical) deleteCanonical.add(canonical);

        }

      }

    }

    const remainingImageUrls = existingImageUrls.filter((url) => !deleteCanonical.has(url));

    const newTitle = (title !== undefined) ? shortTitle(title) : (existing.title || '');

    const newDesc = (description !== undefined) ? String(description).slice(0,400) : existing.description;

    const newLoc = (location !== undefined) ? String(location).slice(0,80) : existing.location;

    try {

      const flagged = await moderateListingContent({

        title: String(newTitle || ''),

        description: String(newDesc || ''),

        imageUrls: remainingImageUrls

      });

      if (flagged?.length) {
        await recordFlaggedAttempt({ userId: req.user?.id, listingId: id, title: newTitle, flagged });

        return res.status(400).json({ error: 'moderation_flagged', flagged });

      }

    } catch (err) {

      if (err?.code === 'moderation_failed') {

        console.error('Listing moderation failed:', err.cause?.message || err.cause || err);

        return res.status(502).json({ error: 'moderation_failed' });

      }

      throw err;

    }



    // Handle image deletions

    if (Array.isArray(deletedImages) && deletedImages.length > 0) {

      for (const imageUrl of deletedImages) {

        const raw = String(imageUrl ?? '').trim();

        const variants = assetVariants(raw);

        const pool = variants.length ? variants : (raw ? [raw] : []);

        for (const variant of pool) {

          if (!variant) continue;

          await db.prepare('DELETE FROM listing_images WHERE listing_id = ? AND (url = ? OR image_data = ?)')

            .run(id, variant, variant);

        }

      }



      // Re-index remaining images

      const remaining = await db.prepare('SELECT id FROM listing_images WHERE listing_id = ? ORDER BY position, id')

        .all(id);

      for (let i = 0; i < remaining.length; i++) {

        await db.prepare('UPDATE listing_images SET position = ? WHERE id = ?')

          .run(i, remaining[i].id);

      }



      // Update listing cover if needed

      const firstImage = await db.prepare('SELECT url, image_data FROM listing_images WHERE listing_id = ? ORDER BY position LIMIT 1')

        .get(id);

      if (firstImage) {

        const cover = canonicalAssetUrl(firstImage.url || firstImage.image_data);

        await db.prepare('UPDATE listings SET image_data = ? WHERE id = ?')

          .run(cover, id);

      } else {

        await db.prepare('UPDATE listings SET image_data = NULL WHERE id = ?')

          .run(id);

      }

    }



    let newPrice;

    if (price !== undefined) {

      const p = Number(price);

      newPrice = (Number.isFinite(p) && p >= 0) ? p : 0;

    } else {

      newPrice = existing.price;

    }



    let newLat = null, newLon = null;

    if (existing.lat == null && req.body.enable_nearby) {

      newLat = Number(req.body.lat);

      newLon = Number(req.body.lon);

      if (!Number.isFinite(newLat)) newLat = null;

      if (!Number.isFinite(newLon)) newLon = null;

    }



    await db.prepare('UPDATE listings SET title=?, description=?, location=?, price=?, lat=COALESCE(?, lat), lon=COALESCE(?, lon) WHERE id=?')

      .run(newTitle, newDesc, newLoc, newPrice, newLat, newLon, id);



    if (typeof tags !== 'undefined') {

      const tagStr = normalizeTags(tags);

      await db.prepare('UPDATE listings SET tags=? WHERE id=?').run(tagStr, id);

    }



    if (typeof req.body.enable_nearby !== 'undefined') {

      await db.prepare('UPDATE listings SET enable_nearby=? WHERE id=?').run(req.body.enable_nearby ? 1 : 0, id);

    }

    if (typeof req.body.inquiry_enabled !== 'undefined') {

      await db.prepare('UPDATE listings SET inquiry_enabled=? WHERE id=?').run(req.body.inquiry_enabled ? 1 : 0, id);

    }



    if (typeof req.body.sold !== 'undefined') {

      const soldVal = req.body.sold ? 1 : 0;

      await db.prepare('UPDATE listings SET sold=? WHERE id=?').run(soldVal, id);

    }



    const row = await db.prepare('SELECT * FROM listings WHERE id = ?').get(id);

    if (row && Object.prototype.hasOwnProperty.call(row, 'image_data')) {

      row.image_data = canonicalAssetUrl(row.image_data);

    }

    await maybeUpdateListingGeography(id, row?.lat, row?.lon);



    try {

      const prevCity = cityOf(existing.location);

      const nextCity = cityOf(newLoc);

      if (prevCity.toLowerCase() !== nextCity.toLowerCase()) {

        await decrementCityCount(existing.location);

        await incrementCityCount(newLoc);

      }

    } catch {}



    await invalidateNearbyCache();

    return sendSchema(res, validateListingResponse, row);

  } catch (e) {

    console.error('Update listing failed:', e);

    return res.status(500).json({ error: 'update_failed' });

  }

});



app.delete('/api/listings/:id', auth, writeLimiter, async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

    const id = Number(req.params.id);

    const existing = await db.prepare('SELECT * FROM listings WHERE id = ?').get(id);

    

    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (!req.user.is_admin && existing.user_id !== req.user.id) {

      return res.status(403).json({ error: 'Not your listing' });

    }

    

    await db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);

    await db.prepare('DELETE FROM listings WHERE id = ?').run(id);

    try { await decrementCityCount(existing.location); } catch {}

    await invalidateNearbyCache();

    res.json({ ok: true });

  } catch (e) {

    console.error('Delete listing failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});



app.get('/api/listings/:id/images', async (req, res) => {

  try {

    const id = Number(req.params.id);

    const rows = await db.prepare(`

      SELECT COALESCE(url, image_data) AS image 

      FROM listing_images 

      WHERE listing_id = ? 

        AND (url IS NOT NULL OR image_data IS NOT NULL)

      ORDER BY position ASC, id ASC

    `).all(id);

    res.json(rows.map(r => canonicalAssetUrl(r.image)));

  } catch (e) {

    console.error('Get listing images failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.get('/api/listings/nearby', async (req, res) => {

  try {

    const lat0 = Number(req.query.lat);

    const lon0 = Number(req.query.lon);

    let radius = Number(req.query.radius_m);



    if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) {

      return res.status(400).json({ error: 'lat/lon required' });

    }

    if (!Number.isFinite(radius) || radius <= 0) radius = 150;

    radius = Math.max(50, Math.min(radius, NEARBY_MAX_RADIUS_M));



    const cacheKey = makeNearbyCacheKey(lat0, lon0, radius);

    const cached = await getNearbyCache(cacheKey);

    if (cached) {

      res.set('X-Nearby-Cache', 'HIT');

      return res.json(cached);

    }



    const limit = Math.min(NEARBY_RESULT_LIMIT, 200);
    let rows = null;
    let usedPostGIS = false;

    if (GEO_FEATURES.postgisNearby) {
      try {
        const sqlPostgis = `
          SELECT l.id, l.user_id,
                 COALESCE(
                   (
                     SELECT COALESCE(url, image_data)
                       FROM listing_images
                      WHERE listing_id = l.id
                        AND (url IS NOT NULL OR image_data IS NOT NULL)
                    ORDER BY position ASC, id ASC
                    LIMIT 1
                   ),
                   l.image_data
                 ) AS image_data,
                 l.title, l.description, l.location,
                 l.price, l.created_at, l.tags, l.lat, l.lon,
                 l.inquiry_enabled,
                 u.username AS owner_username,
                 u.supporter_badge AS owner_supporter_badge,
                 u.supporter_since AS owner_supporter_since,
                 ST_Distance(
                   COALESCE(
                     l.geog,
                     ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326)::geography
                   ),
                   ST_SetSRID(ST_MakePoint(@lon0, @lat0), 4326)::geography
                 ) AS distance_m
            FROM listings l
            JOIN users u ON u.id = l.user_id
           WHERE l.enable_nearby = 1
             AND l.sold = 0
             AND l.lat IS NOT NULL AND l.lon IS NOT NULL
             AND ST_DWithin(
                   COALESCE(
                     l.geog,
                     ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326)::geography
                   ),
                   ST_SetSRID(ST_MakePoint(@lon0, @lat0), 4326)::geography,
                   @radius
                 )
           ORDER BY distance_m ASC, l.id DESC
           LIMIT @limit
        `;
        rows = await db.prepare(sqlPostgis).all({ lat0, lon0, radius, limit });
        usedPostGIS = true;
      } catch (err) {
        console.warn('[postgis] nearby query failed, reverting to fallback:', err);
        GEO_FEATURES.postgisNearby = false;
        GEO_FEATURES.reason = `nearby_failed:${err?.code || err?.message || 'unknown'}`;
        rows = null;
      }
    }

    if (!usedPostGIS) {
      const earthRadius = 6371000;
      const deg2rad = Math.PI / 180;
      const lat0Rad = lat0 * deg2rad;
      const metersPerDegLat = 111320;
      const degLat = radius / metersPerDegLat;
      const cosLat = Math.cos(lat0Rad);
      const safeCos = Math.max(Math.abs(cosLat), 1e-4);
      const degLon = radius / (metersPerDegLat * safeCos);
      const minLat = Math.max(-90, lat0 - degLat);
      const maxLat = Math.min(90, lat0 + degLat);
      const minLon = Math.max(-180, lon0 - degLon);
      const maxLon = Math.min(180, lon0 + degLon);

      const sinHalfChordExpr = `SQRT(
        POWER(SIN(((@deg2rad * (l.lat - @lat0)) / 2)), 2) +
        COS(@lat0_rad) * COS(l.lat * @deg2rad) *
        POWER(SIN(((@deg2rad * (l.lon - @lon0)) / 2)), 2)
      )`;
      const distanceExpr = `(2 * @earthRadius * ASIN(
        CASE
          WHEN ${sinHalfChordExpr} > 1 THEN 1
          WHEN ${sinHalfChordExpr} < -1 THEN -1
          ELSE ${sinHalfChordExpr}
        END
      ))`;
      const sqlFallback = `
        SELECT l.id, l.user_id,
               COALESCE(
                 (
                   SELECT COALESCE(url, image_data)
                     FROM listing_images
                    WHERE listing_id = l.id
                      AND (url IS NOT NULL OR image_data IS NOT NULL)
                    ORDER BY position ASC, id ASC
                    LIMIT 1
                 ),
                 l.image_data
               ) AS image_data,
               l.title, l.description, l.location,
               l.price, l.created_at, l.tags, l.lat, l.lon,
               l.inquiry_enabled,
               u.username AS owner_username,
               u.supporter_badge AS owner_supporter_badge,
               u.supporter_since AS owner_supporter_since,
               ${distanceExpr} AS distance_m
          FROM listings l
          JOIN users u ON u.id = l.user_id
         WHERE l.enable_nearby = 1
           AND l.sold = 0
           AND l.lat IS NOT NULL AND l.lon IS NOT NULL
           AND l.lat BETWEEN @minLat AND @maxLat
           AND l.lon BETWEEN @minLon AND @maxLon
           AND ${distanceExpr} <= @radius
         ORDER BY distance_m ASC, l.id DESC
         LIMIT @limit
      `;

      rows = await db.prepare(sqlFallback).all({
        lat0,
        lon0,
        radius,
        earthRadius,
        deg2rad,
        lat0_rad: lat0Rad,
        minLat,
        maxLat,
        minLon,
        maxLon,
        limit
      });
    }



    const out = rows.map((row) => {

      const distance = Number.isFinite(row.distance_m) ? Math.round(row.distance_m) : null;
      const tags = row?.tags ? String(row.tags).split(',').filter(Boolean) : [];

      return {

        ...row,

        tags,

        distance_m: distance,

        image_data: canonicalAssetUrl(row.image_data)

      };

    });



    await setNearbyCache(cacheKey, out);

    res.set('X-Nearby-Cache', 'MISS');

    return res.json(out);

  } catch (e) {

    console.error('Nearby listings failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.get('/api/cities', async (req, res) => {

  try {

    const raw = String(req.query.q || '').trim();

    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 20);

    const slug = normalizeCitySlug(raw);

    const like = raw.toLowerCase().replace(/%/g, '') + '%';

    let rows;

    if (!raw) {

      rows = await db.prepare(`

        SELECT city, count

          FROM listing_cities

         ORDER BY count DESC, city ASC

         LIMIT @limit

      `).all({ limit });

    } else {

      rows = await db.prepare(`

        SELECT city, count

          FROM listing_cities

         WHERE (slug LIKE @slug || '%')

            OR (LOWER(city) LIKE @like)

         ORDER BY count DESC, city ASC

         LIMIT @limit

      `).all({ slug, like, limit });

    }

    res.json(rows.map(r => r.city));

  } catch (e) {

    console.error('City search failed:', e);

    res.status(500).json({ error: 'fetch_failed' });

  }

});



/* ------------------------------------------------------------------ */

/* S3 uploads                                                          */

/* ------------------------------------------------------------------ */

app.post('/api/uploads/sign', auth, uploadLimiter, async (req, res) => {

  if (!presignUpload) return res.status(500).json({ error: 's3_module_not_loaded' });

  try {

    const { filename, contentType, bytes } = req.body || {};

    if (!contentType) return res.status(400).json({ error: 'contentType required' });

    const sig = await presignUpload({ filename, contentType, bytes });

    return res.json(sig);

  } catch (e) {

    console.error('[S3] sign error:', e);

    return res.status(400).json({ error: e.message || 'sign_failed' });

  }

});



app.post('/api/uploads/finalize', auth, uploadLimiter, async (req, res) => {

  try {

    const { listingId, key, url, width, height, bytes } = req.body || {};

    const rawUrl = typeof url === 'string' ? url : '';

    if (!key || !rawUrl) {

      return res.status(400).json({ error: 'key_and_url_required' });

    }

    if (!isAllowedPublicUrl(rawUrl)) {

      return res.status(400).json({ error: 'invalid_asset_url' });

    }

    const safeUrl = canonicalAssetUrl(rawUrl);

    const safeWidth = Number(width);

    const safeHeight = Number(height);

    const safeBytes = Number(bytes);

    const sanitized = {

      key: String(key),

      url: safeUrl,

      width: Number.isFinite(safeWidth) ? safeWidth : null,

      height: Number.isFinite(safeHeight) ? safeHeight : null,

      bytes: Number.isFinite(safeBytes) ? safeBytes : null

    };

    const now = Math.floor(Date.now() / 1000);

    if (listingId) {

      const lid = Number(listingId);

      if (!Number.isFinite(lid)) {

        return res.status(400).json({ error: 'invalid_listing' });

      }

      const listing = await db.prepare('SELECT user_id, title, description FROM listings WHERE id = ?').get(lid);

      if (!listing) return res.status(404).json({ error: 'Listing not found' });

      if (!req.user?.is_admin && listing.user_id !== req.user.id) {

        return res.status(403).json({ error: 'Not your listing' });

      }

      const currentImages = await db.prepare('SELECT url, image_data FROM listing_images WHERE listing_id = ? ORDER BY position, id')

        .all(lid);

      const imageUrls = currentImages

        .map((img) => canonicalAssetUrl(img?.url || img?.image_data))

        .filter((url) => typeof url === 'string' && url);

      imageUrls.push(sanitized.url);

      try {

        const flagged = await moderateListingContent({

          title: String(listing.title || ''),

          description: String(listing.description || ''),

          imageUrls

        });

        if (flagged?.length) {
          await recordFlaggedAttempt({ userId: req.user?.id, listingId: lid, title: listing.title, flagged });

          return res.status(400).json({ error: 'moderation_flagged', flagged });

        }

      } catch (err) {

        if (err?.code === 'moderation_failed') {

          console.error('Listing moderation failed:', err.cause?.message || err.cause || err);

          return res.status(502).json({ error: 'moderation_failed' });

        }

        throw err;

      }

      const pRow = await db.prepare('SELECT MAX(position) AS maxp FROM listing_images WHERE listing_id = ?').get(lid);

      const pos = Number.isFinite(pRow?.maxp) ? (pRow.maxp + 1) : 0;

      await db.prepare(`

        INSERT INTO listing_images (listing_id, image_data, position, key, url, width, height, bytes, created_at)

        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)

      `).run(lid, pos, sanitized.key, sanitized.url, sanitized.width, sanitized.height, sanitized.bytes, now);

      await db.prepare(`

        UPDATE listings

           SET image_data = COALESCE(NULLIF(image_data, ''), @url)

         WHERE id = @listingId

      `).run({ listingId: lid, url: sanitized.url });

      return res.json({ ok: true, position: pos });

    }

    if (!req.user?.id) {

      return res.status(403).json({ error: 'auth_required' });

    }

    let token;

    for (let attempt = 0; attempt < 3; attempt += 1) {

      token = crypto.randomBytes(24).toString('hex');

      try {

        await db.prepare(`

          INSERT INTO listing_upload_drafts (user_id, token, key, url, width, height, bytes, created_at)

          VALUES (?, ?, ?, ?, ?, ?, ?, ?)

        `).run(req.user.id, token, sanitized.key, sanitized.url, sanitized.width, sanitized.height, sanitized.bytes, now);

        break;

      } catch (err) {

        const msg = String(err && err.message || '');

        if (msg.includes('UNIQUE') && attempt < 2) {

          continue;

        }

        throw err;

      }

    }

    if (!token) {

      return res.status(500).json({ error: 'token_generation_failed' });

    }

    return res.json({ ok: true, uploadToken: token, url: sanitized.url, width: sanitized.width, height: sanitized.height, bytes: sanitized.bytes });

  } catch (e) {

    console.error('Finalize upload failed:', e);

    return res.status(500).json({ error: 'finalize_failed' });

  }

});



// New endpoint to delete a specific image

app.delete('/api/listings/:listingId/images/:imageId', auth, writeLimiter, async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

    const listingId = Number(req.params.listingId);

    const imageId = Number(req.params.imageId);

    

    const listing = await db.prepare('SELECT user_id FROM listings WHERE id = ?').get(listingId);

    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    

    if (!req.user.is_admin && listing.user_id !== req.user.id) {

      return res.status(403).json({ error: 'Not your listing' });

    }

    

    await db.prepare('DELETE FROM listing_images WHERE id = ? AND listing_id = ?').run(imageId, listingId);

    

    // Update positions of remaining images

    await db.exec(`

      UPDATE listing_images 

      SET position = position - 1 

      WHERE listing_id = ${listingId} 

        AND position > (SELECT position FROM listing_images WHERE id = ${imageId})

    `);



    const firstImage = await db.prepare('SELECT url, image_data FROM listing_images WHERE listing_id = ? ORDER BY position LIMIT 1').get(listingId);

    if (firstImage) {

      const cover = canonicalAssetUrl(firstImage.url || firstImage.image_data);

      await db.prepare('UPDATE listings SET image_data = ? WHERE id = ?').run(cover, listingId);

    } else {

      await db.prepare('UPDATE listings SET image_data = NULL WHERE id = ?').run(listingId);

    }

    

    res.json({ ok: true });

  } catch (e) {

    console.error('Delete image failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});



/* ------------------------------------------------------------------ */

/* AI Analysis                                                         */

/* ------------------------------------------------------------------ */

app.post('/api/ai/analyze', auth, writeLimiter, async (req, res) => {

  try {

    if (isLockedAccount(req.user)) return respondLocked(res);

    const MAX_AI_IMAGES = 8;

    const rawImages = Array.isArray(req.body.images) ? req.body.images.slice(0, MAX_AI_IMAGES) : [];

    const hint = String(req.body.hint || '').slice(0, 200);

    const images = [];

    for (const raw of rawImages) {

      if (typeof raw !== 'string') {

        return res.status(400).json({ error: 'invalid_asset_url' });

      }

      const trimmed = raw.trim();

      if (!trimmed) {

        return res.status(400).json({ error: 'invalid_asset_url' });

      }

      const canonical = canonicalAssetUrl(trimmed);

      const normalized = (typeof canonical === 'string' && canonical) ? canonical : trimmed;

      if (!isAllowedPublicUrl(normalized)) {

        return res.status(400).json({ error: 'invalid_asset_url' });

      }

      images.push(normalized);

    }

    if (!images.length) return res.status(400).json({ error: 'No images provided' });



    const client = getOpenAIClient();

    if (client) {



      const openAIImages = await Promise.all(images.map((img) => toOpenAIImageUrl(img)));

      const moderationInputs = [];
      if (hint) moderationInputs.push(`hint: ${hint}`);
      openAIImages.forEach((img, idx) => {
        const trimmedAI = typeof img === 'string' ? img.trim() : '';
        if (trimmedAI) {
          moderationInputs.push(trimmedAI);
          return;
        }
        const original = images[idx];
        const trimmedOriginal = typeof original === 'string' ? original.trim() : '';
        if (trimmedOriginal) moderationInputs.push(trimmedOriginal);
      });

      if (moderationInputs.length) {
        try {
          const moderation = await client.moderations.create({
            model: 'omni-moderation-latest',
            input: moderationInputs
          });

          const flagged = [];
          const hintOffset = hint ? 1 : 0;
          moderation.results?.forEach((result, index) => {
            if (!result || !result.flagged) return;
            const entry = {
              target: null,
              type: null,
              categories: [],
              category_scores: result.category_scores || {}
            };

            if (hint && index === 0) {
              entry.type = 'hint';
              entry.target = hint;
            } else {
              const imgIndex = index - hintOffset;
              entry.type = 'image';
              entry.target = images[imgIndex] || openAIImages[imgIndex];
            }

            const categories = result.categories || {};
            entry.categories = Object.keys(categories).filter((key) => categories[key]);
            flagged.push(entry);
          });

          if (flagged.length) {
            await recordFlaggedAttempt({ userId: req.user?.id, title: hint, flagged });
            return res.status(400).json({ error: 'moderation_flagged', flagged });
          }
        } catch (err) {
          console.error('Moderation check failed:', err);
          return res.status(502).json({ error: 'moderation_failed' });
        }
      }



      const content = [];

      content.push({

        type: 'text',

        text: [

          'You are a listing assistant for a local marketplace.',

          'Analyze the item images and output STRICT JSON with:',

          '"title": concise <=80 chars, no emojis;',

          '"description": <=200 chars, objective tone focusing on verifiable condition/defects (including less-visible issues) and never assuming accessories unless the user hint confirms them;',

          '"tags": array of 12-24 short, lowercase search terms;',

          '"price_usd": fair used-market price in USD as a number;',

          'When damage, wear, or missing parts are visible, explicitly mention it in the description.',

          'Describe only what can be confirmed from the photos or user hint; avoid promising inclusions.',

          'If condition is unclear, say "Condition unclear" rather than guessing.',

          'Return ONLY JSON.'

        ].join('\n')

      });

      if (hint) content.push({ type: 'text', text: `User hint: ${hint}` });

      for (const img of openAIImages) {
        if (typeof img === 'string' && img.trim()) {
          content.push({ type: 'image_url', image_url: { url: img.trim() } });
        }
      }



      const resp = await client.chat.completions.create({

        model: 'gpt-4o-mini',

        temperature: 0.2,

        messages: [{ role: 'user', content }],

        response_format: { type: 'json_object' }

      });



      const txt = resp.choices?.[0]?.message?.content || '{}';

      let parsed = {};

      try { parsed = JSON.parse(txt); } catch {}

      

      let title = shortTitle(parsed.title || '');

      let tags = Array.isArray(parsed.tags) ? parsed.tags : [];

      let priceNum = Number(parsed.price_usd);

      let description = (parsed.description || '').toString().trim();

      if (description.length > 400) description = description.slice(0, 400);



      const tagStr = normalizeTags(tags);

      const outTags = tagStr ? tagStr.split(',') : [];

      if (!title) title = 'Item for sale';

      if (!description) {

        description = synthesizeListingDescription(title, hint);

      }



      let suggested_price;

      if (!Number.isNaN(priceNum)) {

        priceNum = Math.min(Math.max(priceNum, 1), 100000);

        suggested_price = Math.round(priceNum * 100) / 100;

      }



      if (outTags.length < 8) {

        const extra = fallbackTagsFromTitleDesc(title, hint);

        const merged = normalizeTags([...outTags, ...extra]).split(',').filter(Boolean).slice(0,20);

        return res.json({ title, description, tags: merged, suggested_price });

      }



      return res.json({ title, description, tags: outTags.slice(0, 24), suggested_price });

    }



    const title = shortTitle(hint || 'Item for sale');

    const tags = normalizeTags(fallbackTagsFromTitleDesc(title, hint)).split(',').filter(Boolean);

    const description = synthesizeListingDescription(title, hint);

    return res.json({ title, description, tags: tags.slice(0, 20) });

  } catch (e) {

    console.error('AI analyze failed:', e);

    return res.status(500).json({ error: 'AI analysis failed' });

  }

});



/* ------------------------------------------------------------------ */

/* Conversations & Messages                                           */

/* ------------------------------------------------------------------ */

function isMember(convo, uid) {

  return convo && (convo.a_user_id === uid || convo.b_user_id === uid);

}

async function restoreConversationForUser(convo, userId) {

  if (!convo || !convo.id) return convo;

  const id = Number(convo.id);

  if (!Number.isFinite(id)) return convo;

  const isA = Number(convo.a_user_id) === Number(userId);

  const isB = Number(convo.b_user_id) === Number(userId);

  if (!isA && !isB) return convo;

  const updates = [];

  if (isA && convo.a_deleted_at != null) updates.push('a_deleted_at = NULL');

  if (isB && convo.b_deleted_at != null) updates.push('b_deleted_at = NULL');

  if (!updates.length) return convo;

  await db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(id);

  return await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

}



app.post('/api/conversations', auth, writeLimiter, async (req, res) => {

  try {

    let { with_user_id, listing_id } = req.body || {};

    if (!with_user_id && !listing_id) {

      return res.status(400).json({ error: 'with_user_id or listing_id required' });

    }

    

    if (listing_id) {

      const lst = await db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(listing_id));

      if (!lst) return res.status(404).json({ error: 'Listing not found' });

      if (!with_user_id) with_user_id = lst.user_id;

    }

    

    with_user_id = Number(with_user_id);

    if (!Number.isFinite(with_user_id)) {

      return res.status(400).json({ error: 'invalid_user' });

    }



    const target = await getUserWithStatus(with_user_id);

    if (!target) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    if (isLockedAccount(req.user) && !target.is_admin) {

      return respondLocked(res);

    }



    if (with_user_id === req.user.id) {

      return res.status(400).json({ error: 'Cannot message yourself' });

    }



    const { a, b } = normalizePair(req.user.id, with_user_id);

    // Always create separate conversations per listing
    // This ensures that the potential-buyers query can find the correct buyers
    // for each listing based on the listing_id in the conversation

    

    try {

      const info = await db.prepare('INSERT INTO conversations (a_user_id, b_user_id, listing_id, created_at) VALUES (?, ?, ?, ?)')

        .run(a, b, listing_id || null, nowIso());

      const created = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);

      const restored = await restoreConversationForUser(created, req.user.id);

      return res.json(restored);

    } catch {

      const row = await db.prepare('SELECT * FROM conversations WHERE a_user_id=? AND b_user_id=? AND listing_id = ?')

        .get(a, b, listing_id || null);

      const restored = await restoreConversationForUser(row, req.user.id);

      return res.json(restored);

    }

  } catch (e) {

    console.error('Create conversation failed:', e);

    return res.status(500).json({ error: 'create_failed' });

  }

});



app.get('/api/conversations', auth, async (req, res) => {

  try {

    const me = req.user.id;

    const rows = await db.prepare(`

      WITH last_messages AS (

        SELECT m.conversation_id,

               m.id,

               m.body,

               m.sender_id,

               m.created_at

          FROM messages m

          JOIN (

            SELECT conversation_id, MAX(id) AS max_id

              FROM messages

             GROUP BY conversation_id

          ) latest

            ON latest.conversation_id = m.conversation_id

           AND latest.max_id = m.id

      )

      SELECT

        c.id,

        c.listing_id,

        CASE WHEN c.a_user_id = @me THEN c.b_user_id ELSE c.a_user_id END AS other_user_id,

        u.username AS other_user_username,

        u.profile_picture_url AS other_user_profile_picture,

        COALESCE(l.title, '') AS listing_title,

        l.user_id AS listing_owner_id,

        l.image_data,

        lm.created_at AS last_message_at,

        lm.body AS last_message_body,

        lm.sender_id AS last_message_sender_id,

        lm.id AS last_message_id,

        sender.is_admin AS last_message_is_admin,

        CASE

          WHEN c.a_user_id = @me THEN CASE WHEN c.b_deleted_at IS NULL THEN 0 ELSE 1 END

          ELSE CASE WHEN c.a_deleted_at IS NULL THEN 0 ELSE 1 END

        END AS other_user_deleted

      FROM conversations c

      JOIN users u

        ON u.id = CASE WHEN c.a_user_id = @me THEN c.b_user_id ELSE c.a_user_id END

      LEFT JOIN listings l

        ON l.id = c.listing_id

      LEFT JOIN last_messages lm

        ON lm.conversation_id = c.id

      LEFT JOIN users sender

        ON sender.id = lm.sender_id

      WHERE (c.a_user_id = @me AND c.a_deleted_at IS NULL)

         OR (c.b_user_id = @me AND c.b_deleted_at IS NULL)

      ORDER BY c.id DESC

    `).all({ me });



    const normalized = rows.map(row => ({

      ...row,

      image_data: canonicalAssetUrl(row.image_data),

      other_user_deleted: !!row.other_user_deleted

    }));



    res.json(normalized);

  } catch (e) {

    console.error('Get conversations failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.get('/api/conversations/:id/messages', auth, async (req, res) => {

  try {

    const id = Number(req.params.id);

    const convo = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);



    if (!convo) return res.status(404).json({ error: 'Not found' });

    if (!isMember(convo, req.user.id)) return res.status(403).json({ error: 'Forbidden' });



    const isAdmin = !!req.user?.is_admin;

    const isA = Number(convo.a_user_id) === Number(req.user.id);

    const isB = Number(convo.b_user_id) === Number(req.user.id);

    if (!isAdmin && ((isA && convo.a_deleted_at != null) || (isB && convo.b_deleted_at != null))) {

      return res.status(404).json({ error: 'Not found' });

    }



    const msgs = await db.prepare(`

      SELECT m.*, u.username AS sender_username

      FROM messages m JOIN users u ON u.id = m.sender_id

      WHERE m.conversation_id = ?

      ORDER BY m.id ASC

    `).all(id);

    // Fetch all images in one query to avoid N+1 problem
    const messageIds = msgs.map(m => m.id);
    let allImages = [];

    if (messageIds.length > 0) {
      // Build IN clause with proper parameter binding
      const placeholders = messageIds.map(() => '?').join(',');
      allImages = await db.prepare(`
        SELECT message_id, COALESCE(url, image_data) AS image_data
        FROM message_images
        WHERE message_id IN (${placeholders})
        ORDER BY message_id ASC, position ASC
      `).all(...messageIds);
    }

    // Group images by message_id
    const imagesByMessageId = {};
    for (const img of allImages) {
      if (!imagesByMessageId[img.message_id]) {
        imagesByMessageId[img.message_id] = [];
      }
      imagesByMessageId[img.message_id].push(canonicalAssetUrl(img.image_data));
    }

    // Attach images to messages
    const out = msgs.map(m => ({
      ...m,
      images: imagesByMessageId[m.id] || []
    }));



    res.json(out);

  } catch (e) {

    console.error('Get messages failed:', e);

    return res.status(500).json({ error: 'fetch_failed' });

  }

});



app.post('/api/conversations/:id/messages', auth, writeLimiter, validateBody(validateSendMessageRequest), async (req, res) => {

  try {

    const id = Number(req.params.id);

    const { body, images } = req.body || {};



    const convo = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

    if (!convo) return res.status(404).json({ error: 'Not found' });

    if (!isMember(convo, req.user.id)) return res.status(403).json({ error: 'Forbidden' });



    const isA = Number(convo.a_user_id) === Number(req.user.id);

    const isB = Number(convo.b_user_id) === Number(req.user.id);

    const otherUserId = isA ? convo.b_user_id : convo.a_user_id;

    const otherDeleted = isA

      ? convo.b_deleted_at != null

      : (isB ? convo.a_deleted_at != null : false);



    const columnsToClear = [];

    if (isA && convo.a_deleted_at != null) columnsToClear.push('a_deleted_at = NULL');

    if (isB && convo.b_deleted_at != null) columnsToClear.push('b_deleted_at = NULL');

    if (columnsToClear.length) {

      await db.prepare(`UPDATE conversations SET ${columnsToClear.join(', ')} WHERE id = ?`).run(id);

      if (isA) convo.a_deleted_at = null;

      if (isB) convo.b_deleted_at = null;

    }

    if (isLockedAccount(req.user)) {

      const targetIsAdmin = await isAdminUserId(otherUserId);

      if (!targetIsAdmin) {

        return respondLocked(res);

      }

    }



    const err = validateMsgImages(images);

    if (err) return res.status(400).json({ error: err });



    const info = await db.prepare(

      'INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)'

    ).run(id, req.user.id, String(body || '').slice(0,2000), nowIso());



    const msgId = info.lastInsertRowid;



    if (Array.isArray(images) && images.length) {

      const stmt = db.prepare(`

        INSERT INTO message_images (message_id, position, image_data, url)

        VALUES (?, ?, ?, ?)

      `);



      for (let i = 0; i < images.length; i++) {

        const img = images[i];

        if (typeof img !== 'string') continue;

        if (img.startsWith('data:image/')) {

          await stmt.run(msgId, i, img, null);

        } else if (img.startsWith('https://') && isAllowedPublicUrl(img)) {

          const normalized = canonicalAssetUrl(img);

          await stmt.run(msgId, i, null, normalized);

        }

      }

    }



    const row = await db.prepare(`
      SELECT m.*, u.username AS sender_username
        FROM messages m
        JOIN users u ON u.id = m.sender_id
       WHERE m.id = ?
    `).get(msgId);

    const imgs = await db.prepare('SELECT COALESCE(url, image_data) AS image_data FROM message_images WHERE message_id = ? ORDER BY position ASC')

      .all(msgId);

    const normalizedImgs = imgs.map(r => canonicalAssetUrl(r.image_data));

    const messagePayload = { ...row, images: normalizedImgs };
    const senderUsername = row?.sender_username || req.user.username || null;



    const recipientId = convo.a_user_id === req.user.id ? convo.b_user_id : convo.a_user_id;
    const preview = typeof messagePayload.body === 'string'
      ? messagePayload.body.slice(0, 160)
      : '';

    await publishBackgroundEvent(TOPICS.MESSAGE_SENT, {
      conversationId: id,
      message: messagePayload,
      senderId: req.user.id,
      recipientId,
      senderUsername,
      listingId: convo.listing_id || null,
      preview
    }, { req });

    return sendSchema(res, validateMessageEnvelopeResponse, { message: messagePayload, other_user_deleted: !!otherDeleted });

  } catch (e) {

    console.error('Send message failed:', e);

    return res.status(500).json({ error: 'send_failed' });

  }

});




app.delete('/api/conversations/:id', auth, writeLimiter, async (req, res) => {

  try {

    const id = Number(req.params.id);

    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });



    const convo = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

    if (!convo) return res.status(404).json({ error: 'Not found' });



    const isMem = (req.user?.id === convo.a_user_id) || 

                  (req.user?.id === convo.b_user_id) || 

                  !!req.user?.is_admin;

    if (!isMem) return res.status(403).json({ error: 'Forbidden' });



    const isAdmin = !!req.user?.is_admin;

    const isA = Number(convo.a_user_id) === Number(req.user.id);

    const isB = Number(convo.b_user_id) === Number(req.user.id);



    if (isAdmin && !isA && !isB) {

      await db.prepare(`

        DELETE FROM message_images

          WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)

      `).run(id);

      await db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);

      await db.prepare('DELETE FROM conversations WHERE id = ?').run(id);



      return res.json({ ok: true, deleted_for_all: true });

    }



    const columnName = isA ? 'a_deleted_at' : 'b_deleted_at';

    if (!columnName) return res.status(403).json({ error: 'Forbidden' });



    await db.prepare(`UPDATE conversations SET ${columnName} = @now WHERE id = @id`).run({ now: nowIso(), id });



    return res.json({ ok: true, deleted_for_self: true });

  } catch (e) {

    console.error('Delete conversation failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});



app.get('/api/admin/flagged', auth, requireAdmin, async (req, res) => {
  try {
    await ensureFlaggedAttemptsSchema();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
    const rows = await db.prepare(`
      SELECT f.id,
             COALESCE(f.user_id, l.user_id)            AS user_id,
             f.listing_id,
             COALESCE(NULLIF(f.listing_title, ''), l.title, '') AS listing_title,
             f.details,
             f.flagged_at,
             u.username,
             u.email
        FROM flagged_attempts f
        LEFT JOIN listings l ON l.id = f.listing_id
        LEFT JOIN users u ON u.id = COALESCE(f.user_id, l.user_id)
       ORDER BY COALESCE(f.flagged_at, '') DESC, f.id DESC
       LIMIT ?
    `).all(limit);
    const data = rows.map((row) => {
      const details = normalizeFlaggedDetails(row.details);
      const id = Number(row.id);
      const userId = Number.isFinite(Number(row.user_id)) ? Number(row.user_id) : null;
      const listingId = Number.isFinite(Number(row.listing_id)) ? Number(row.listing_id) : null;
      let listingTitle = typeof row.listing_title === 'string' ? row.listing_title.trim() : '';
      if (!listingTitle) {
        const detailWithTarget = (details || []).find((detail) => {
          return detail && typeof detail === 'object' && typeof detail.target === 'string' && detail.target.trim();
        });
        if (detailWithTarget) {
          listingTitle = detailWithTarget.target.trim().slice(0, 160);
        }
      }
      const username = row.username || (Number.isFinite(userId) ? `User #${userId}` : null);
      return {
        id: Number.isFinite(id) ? id : row.id,
        user_id: userId,
        listing_id: listingId,
        listing_title: listingTitle,
        flagged_at: row.flagged_at,
        username,
        email: row.email,
        details
      };
    });
    return res.json(data);
  } catch (err) {
    console.error('Admin flagged list failed:', err);
    return res.status(500).json({ error: 'flagged_fetch_failed' });
  }
});

app.delete('/api/admin/flagged/:id', auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_flagged_id' });
  try {
    await ensureFlaggedAttemptsSchema();
    await db.prepare('DELETE FROM flagged_attempts WHERE id = ?').run(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Admin flagged delete failed:', err);
    return res.status(500).json({ error: 'flagged_delete_failed' });
  }
});

/* ------------------------------------------------------------------ */

/* Ads                                                                */

/* ------------------------------------------------------------------ */

app.get('/api/ads', async (_req, res) => {

  try {

    const rows = await db.prepare(`

      SELECT *

        FROM ads

       WHERE is_active = 1

       ORDER BY position DESC, updated_at DESC, id DESC

    `).all();

    return res.json(rows.map(formatAdRow));

  } catch (e) {

    console.error('Public ads fetch failed:', e);

    return res.status(500).json({ error: 'ads_fetch_failed' });

  }

});



app.get('/api/admin/ads', auth, requireAdmin, async (_req, res) => {

  try {

    const rows = await db.prepare('SELECT * FROM ads ORDER BY position DESC, updated_at DESC, id DESC').all();

    return res.json(rows.map(formatAdRow));

  } catch (e) {

    console.error('Admin ads list failed:', e);

    return res.status(500).json({ error: 'admin_ads_failed' });

  }

});



app.post('/api/admin/ads', auth, requireAdmin, async (req, res) => {

  try {

    const { title, subtitle, target_url, image_url, cta_label, background, position, is_active } = req.body || {};

    const safeTitle = String(title || '').trim().slice(0, 120);

    if (!safeTitle) {

      return res.status(400).json({ error: 'title_required' });

    }

    const safeSubtitle = String(subtitle || '').trim().slice(0, 200) || null;

    const safeCta = String(cta_label || '').trim().slice(0, 40) || null;

    const safeBackground = String(background || '').trim().slice(0, 160) || null;

    let safePosition = Number.isFinite(Number(position)) ? Math.round(Number(position)) : 0;

    if (safePosition > 9999) safePosition = 9999;

    if (safePosition < -9999) safePosition = -9999;

    const normalizedTarget = normalizeHttpUrl(target_url);

    if (!normalizedTarget) {

      return res.status(400).json({ error: 'invalid_target_url' });

    }

    let normalizedImage = '';

    if (image_url) {

      normalizedImage = normalizeHttpUrl(image_url, { allowEmpty: true }) || '';

      if (image_url && !normalizedImage) {

        return res.status(400).json({ error: 'invalid_image_url' });

      }

    }

    const activeFlag = Number(is_active) === 0 ? 0 : 1;

    const now = nowIso();

    const info = await db.prepare(`

      INSERT INTO ads (title, subtitle, target_url, image_url, cta_label, background, is_active, position, created_at, updated_at)

      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    `).run(

      safeTitle,

      safeSubtitle,

      normalizedTarget,

      normalizedImage || null,

      safeCta,

      safeBackground,

      activeFlag,

      safePosition,

      now,

      now

    );

    const row = await db.prepare('SELECT * FROM ads WHERE id = ?').get(info.lastInsertRowid);

    return res.json(formatAdRow(row));

  } catch (e) {

    console.error('Admin ad create failed:', e);

    return res.status(500).json({ error: 'admin_ad_create_failed' });

  }

});



app.put('/api/admin/ads/:id', auth, requireAdmin, async (req, res) => {

  try {

    const adId = Number(req.params.id);

    if (!Number.isFinite(adId)) {

      return res.status(400).json({ error: 'invalid_ad' });

    }

    const { title, subtitle, target_url, image_url, cta_label, background, position, is_active } = req.body || {};

    const safeTitle = String(title || '').trim().slice(0, 120);

    if (!safeTitle) {

      return res.status(400).json({ error: 'title_required' });

    }

    const safeSubtitle = String(subtitle || '').trim().slice(0, 200) || null;

    const safeCta = String(cta_label || '').trim().slice(0, 40) || null;

    const safeBackground = String(background || '').trim().slice(0, 160) || null;

    let safePosition = Number.isFinite(Number(position)) ? Math.round(Number(position)) : 0;

    if (safePosition > 9999) safePosition = 9999;

    if (safePosition < -9999) safePosition = -9999;

    const normalizedTarget = normalizeHttpUrl(target_url);

    if (!normalizedTarget) {

      return res.status(400).json({ error: 'invalid_target_url' });

    }

    let normalizedImage = '';

    if (image_url) {

      normalizedImage = normalizeHttpUrl(image_url, { allowEmpty: true }) || '';

      if (image_url && !normalizedImage) {

        return res.status(400).json({ error: 'invalid_image_url' });

      }

    }

    const activeFlag = Number(is_active) === 0 ? 0 : 1;

    const now = nowIso();

    const info = await db.prepare(`

      UPDATE ads

         SET title = ?,

             subtitle = ?,

             target_url = ?,

             image_url = ?,

             cta_label = ?,

             background = ?,

             is_active = ?,

             position = ?,

             updated_at = ?

       WHERE id = ?

    `).run(

      safeTitle,

      safeSubtitle,

      normalizedTarget,

      normalizedImage || null,

      safeCta,

      safeBackground,

      activeFlag,

      safePosition,

      now,

      adId

    );

    if (!info.changes) {

      return res.status(404).json({ error: 'ad_not_found' });

    }

    const row = await db.prepare('SELECT * FROM ads WHERE id = ?').get(adId);

    return res.json(formatAdRow(row));

  } catch (e) {

    console.error('Admin ad update failed:', e);

    return res.status(500).json({ error: 'admin_ad_update_failed' });

  }

});



app.delete('/api/admin/ads/:id', auth, requireAdmin, async (req, res) => {

  try {

    const adId = Number(req.params.id);

    if (!Number.isFinite(adId)) {

      return res.status(400).json({ error: 'invalid_ad' });

    }

    const info = await db.prepare('DELETE FROM ads WHERE id = ?').run(adId);

    if (!info.changes) {

      return res.status(404).json({ error: 'ad_not_found' });

    }

    return res.json({ ok: true });

  } catch (e) {

    console.error('Admin ad delete failed:', e);

    return res.status(500).json({ error: 'admin_ad_delete_failed' });

  }

});



/* ------------------------------------------------------------------ */

/* Reverse geocoding                                                  */

/* ------------------------------------------------------------------ */

// LRU cache with 1000 entries max and 24 hour TTL to prevent unbounded growth
const GEO_CACHE_MAX = 1000;
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const geoCache = createSharedCache({
  prefix: 'reverse-geocode',
  ttlMs: GEO_CACHE_TTL_MS,
  maxSize: GEO_CACHE_MAX
});

app.get('/api/geo/reverse', geocodeLimiter, async (req, res) => {

  try {

    if (!MAPBOX_ACCESS_TOKEN) {

      console.error('reverse geocode error: MAPBOX_ACCESS_TOKEN missing');

      return res.status(500).json({ error: 'geocode_not_configured' });

    }



    const lat = Number(req.query.lat);

    const lon = Number(req.query.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {

      return res.status(400).json({ error: 'lat/lon required' });

    }



    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;

    let cached = null;
    try {
      cached = await geoCache.get(key);
    } catch (err) {
      console.warn('[reverse-geocode-cache] get failed:', err?.message || err);
    }
    if (cached) return res.json(cached);



    const params = new URLSearchParams({

      access_token: MAPBOX_ACCESS_TOKEN,

      limit: '1',

      types: 'address,place,locality,region,country'

    });



    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(lon)},${encodeURIComponent(lat)}.json?${params.toString()}`;



    const resp = await fetch(url);

    if (!resp.ok) {

      console.error('reverse geocode error: mapbox request failed', resp.status);

      return res.status(502).json({ error: 'geocode_failed' });

    }



    const data = await resp.json();

    const feature = data && Array.isArray(data.features) ? data.features[0] : null;



    if (!feature) {

      const out = { city: '', state: '', country: '', display: key, lat, lon };

      try {
        await geoCache.set(key, out);
      } catch (err) {
        console.warn('[reverse-geocode-cache] set failed:', err?.message || err);
      }

      return res.json(out);

    }



    const pickContext = (type) => {

      if (Array.isArray(feature.place_type) && feature.place_type.includes(type)) {

        return feature;

      }

      return (feature.context || []).find((c) => typeof c.id === 'string' && c.id.startsWith(`${type}.`));

    };



    const nameOf = (obj) => (obj && (obj.text || obj.place_name || '')) || '';
    const shortCode = (obj) => {
      const code = obj?.short_code;
      if (typeof code !== 'string') return '';
      const parts = code.split('-');
      const last = parts[parts.length - 1];
      return last ? last.toUpperCase() : '';
    };



    const cityCtx = pickContext('place') || pickContext('locality') || pickContext('neighborhood');

    const stateCtx = pickContext('region') || pickContext('district');

    const countryCtx = pickContext('country');



    const city = nameOf(cityCtx);

    const state = shortCode(stateCtx) || nameOf(stateCtx);

    const country = shortCode(countryCtx) || nameOf(countryCtx);

    const featureIsPlace = Array.isArray(feature.place_type) && feature.place_type.some((t) => t === 'place' || t === 'locality');
    const fallbackPrimary = featureIsPlace ? nameOf(feature) : '';
    const primary = city || fallbackPrimary;
    const secondary = state || country;

    const displayParts = [primary, secondary].filter(Boolean);
    const display = displayParts.length ? displayParts.join(', ') : (nameOf(feature) || country || feature.place_name || key);



    const out = { city, state, country, display, lat, lon };

    try {
      await geoCache.set(key, out);
    } catch (err) {
      console.warn('[reverse-geocode-cache] set failed:', err?.message || err);
    }

    res.json(out);

  } catch (e) {

    console.error('reverse geocode error', e);

    res.status(500).json({ error: 'server_error' });

  }

});



/* ------------------------------------------------------------------ */

/* Admin helpers                                                       */

/* ------------------------------------------------------------------ */

const TEST_LISTING_OWNER_EMAIL = 'seed.listings@example.com';
const TEST_LISTING_OWNER_USERNAME = 'seed_seller';
const MAX_SEED_LISTINGS = 2000;

const TEST_LISTING_TEMPLATES = [
  {
    title: 'Mid-Century Walnut Coffee Table',
    description: 'Solid walnut table with tapered legs. A few surface scuffs from everyday use but sturdy and smoke-free home.',
    location: 'Portland, OR',
    price: 180,
    tags: ['furniture', 'living room', 'midcentury'],
    lat: 45.5152,
    lon: -122.6784,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Commuter Hybrid Bicycle',
    description: 'Aluminum frame with 700c wheels and hydraulic disc brakes. Tuned this spring and ready to ride.',
    location: 'Austin, TX',
    price: 320,
    tags: ['bike', 'outdoors', 'commuter'],
    lat: 30.2672,
    lon: -97.7431,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1485963631004-f2f00b1d6606?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Large Monstera Deliciosa Plant',
    description: 'Healthy monstera in a 12" terra cotta pot. New growth every month. Includes moss pole support.',
    location: 'Seattle, WA',
    price: 85,
    tags: ['plants', 'home', 'decor'],
    lat: 47.6062,
    lon: -122.3321,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Smart 55" 4K TV with Stand',
    description: 'Samsung 4K UHD television with HDR10 support. Comes with remote, power cable, and minimalist oak stand.',
    location: 'Chicago, IL',
    price: 425,
    tags: ['electronics', 'tv', 'home theater'],
    lat: 41.8781,
    lon: -87.6298,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Three-Seat Linen Sofa',
    description: 'Light gray sofa with removable, machine-washable cushion covers. No stains or sagging. Fits 84" wall.',
    location: 'Brooklyn, NY',
    price: 650,
    tags: ['furniture', 'sofa', 'living room'],
    lat: 40.6782,
    lon: -73.9442,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Gaming Laptop RTX 3060',
    description: '15" Ryzen 7 laptop with RTX 3060, 16GB RAM, and 1TB SSD. Fresh Windows install and original charger included.',
    location: 'Denver, CO',
    price: 950,
    tags: ['electronics', 'gaming', 'laptop'],
    lat: 39.7392,
    lon: -104.9903,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'KitchenAid Artisan Stand Mixer',
    description: 'Matte black 5 qt mixer with dough hook, whisk, and paddle attachments. Works perfectly, just downsizing.',
    location: 'Minneapolis, MN',
    price: 210,
    tags: ['kitchen', 'appliances', 'baking'],
    lat: 44.9778,
    lon: -93.265,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1481931098730-318b6f776db0?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Weekend Camping Tent (4-person)',
    description: 'REI Half Dome 4-person tent with rainfly, footprint, and stakes. Used twice and stored indoors.',
    location: 'Salt Lake City, UT',
    price: 275,
    tags: ['outdoors', 'camping', 'gear'],
    lat: 40.7608,
    lon: -111.891,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Vintage Turntable with Speakers',
    description: 'Fully working Pioneer turntable with built-in preamp and powered bookshelf speakers. Great starter vinyl setup.',
    location: 'Nashville, TN',
    price: 340,
    tags: ['audio', 'vintage', 'music'],
    lat: 36.1627,
    lon: -86.7816,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Air Purifier with HEPA Filter',
    description: 'Coway Mighty purifier. Includes a brand new HEPA filter and carbon pre-filter. Perfect for medium rooms.',
    location: 'San Francisco, CA',
    price: 140,
    tags: ['home', 'air quality', 'appliances'],
    lat: 37.7749,
    lon: -122.4194,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1580041065738-e72023775cdc?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Hardcover Mystery Book Bundle',
    description: 'Set of eight gently read mystery novels from 2020-2022 releases. No writing inside and dust jackets intact.',
    location: 'Raleigh, NC',
    price: 45,
    tags: ['books', 'bundle', 'fiction'],
    lat: 35.7796,
    lon: -78.6382,
    enableNearby: false,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Adjustable Standing Desk',
    description: '60" x 30" electric standing desk with programmable heights. Includes cable tray and anti-fatigue mat.',
    location: 'San Diego, CA',
    price: 390,
    tags: ['office', 'desk', 'furniture'],
    lat: 32.7157,
    lon: -117.1611,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  },
  {
    title: 'Cordless Stick Vacuum Cleaner',
    description: 'Dyson V10 Animal with wall mount, crevice tool, and extra battery. Recently cleaned filters and bin.',
    location: 'Atlanta, GA',
    price: 260,
    tags: ['home', 'cleaning', 'appliances'],
    lat: 33.749,
    lon: -84.388,
    enableNearby: true,
    images: [
      {
        url: 'https://images.unsplash.com/photo-1581579186989-2ab7d2ac0d83?auto=format&fit=crop&w=1600&q=80',
        width: 1600,
        height: 1067
      }
    ]
  }
];

async function ensureSeedSellerUser() {

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(TEST_LISTING_OWNER_EMAIL);

  if (existing?.id) return existing.id;

  const password = crypto.randomBytes(24).toString('hex');

  const passwordHash = await bcrypt.hash(password, 10);

  const info = await db.prepare(`
    INSERT INTO users (email, username, password_hash, created_at, is_admin)
    VALUES (?, ?, ?, ?, 0)
  `).run(
    TEST_LISTING_OWNER_EMAIL,
    TEST_LISTING_OWNER_USERNAME,
    passwordHash,
    nowIso()
  );

  return info.lastInsertRowid;
}

async function deleteSeedListingsInternal() {

  const rows = await db.prepare('SELECT id, location FROM listings WHERE is_test_listing = 1').all();

  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const ids = rows.map(r => Number(r.id)).filter((id) => Number.isFinite(id));

  if (!ids.length) return 0;

  for (const row of rows) {

    try { await decrementCityCount(row.location); } catch {}

  }

  const idList = ids.join(',');

  try { await db.exec(`DELETE FROM listing_images WHERE listing_id IN (${idList});`); } catch {}

  try { await db.exec(`DELETE FROM seller_reports WHERE listing_id IN (${idList});`); } catch {}

  await db.exec(`DELETE FROM listings WHERE id IN (${idList});`);

  await invalidateNearbyCache();

  return ids.length;
}

async function seedListingsInternal(requestedCount) {

  const sellerId = await ensureSeedSellerUser();

  await deleteSeedListingsInternal();

  const templateCount = TEST_LISTING_TEMPLATES.length;
  if (templateCount === 0) {
    return { created: 0, sellerId };
  }

  let total = Number.isFinite(requestedCount) ? Math.floor(requestedCount) : templateCount;
  if (total < 1) total = 1;
  if (total > MAX_SEED_LISTINGS) total = MAX_SEED_LISTINGS;

  let created = 0;

  for (let index = 0; index < total; index += 1) {

    const template = TEST_LISTING_TEMPLATES[index % templateCount];

    const createdAt = new Date(Date.now() - index * 3600 * 1000).toISOString();

    const enableNearby = template.enableNearby ? 1 : (template.lat != null && template.lon != null ? 1 : 0);

    const info = await db.prepare(`
      INSERT INTO listings (
        user_id, image_data, title, description, location, price,
        created_at, tags, lat, lon, enable_nearby, inquiry_enabled, sold, is_test_listing
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
    `).run(
      sellerId,
      String(template.title || ''),
      String(template.description || ''),
      String(template.location || ''),
      Number(template.price) || 0,
      createdAt,
      normalizeTags(template.tags),
      Number.isFinite(template.lat) ? template.lat : null,
      Number.isFinite(template.lon) ? template.lon : null,
      enableNearby,
      0
    );

    const listingId = info.lastInsertRowid;

    try { await incrementCityCount(template.location); } catch {}

    if (Number.isFinite(template.lat) && Number.isFinite(template.lon)) {

      try { await maybeUpdateListingGeography(listingId, template.lat, template.lon); } catch {}

    }

    const images = Array.isArray(template.images) ? template.images : [];

    let position = 0;

    for (const image of images) {

      const key = `seed-${listingId}-${position}-${crypto.randomBytes(6).toString('hex')}`;

      const url = canonicalAssetUrl(String(image.url || ''));

      await db.prepare(`
        INSERT INTO listing_images (
          listing_id, image_data, position, key, url, width, height, bytes, created_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        listingId,
        position,
        key,
        url,
        Number.isFinite(image.width) ? image.width : null,
        Number.isFinite(image.height) ? image.height : null,
        Number.isFinite(image.bytes) ? image.bytes : null,
        Math.floor(Date.now() / 1000)
      );

      position += 1;
    }

    created += 1;
  }

  await invalidateNearbyCache();

  return { created, sellerId };
}

/* ------------------------------------------------------------------ */

/* Admin endpoints                                                     */

/* ------------------------------------------------------------------ */

app.post('/api/admin/listings/seed', auth, requireAdmin, async (req, res) => {

  try {

    const rawCount = req?.body ? Number(req.body.count) : undefined;

    const result = await seedListingsInternal(rawCount);

    res.json({ ok: true, created: result.created, seller_id: result.sellerId });

  } catch (e) {

    console.error('Admin seed listings failed:', e);

    return res.status(500).json({ error: 'seed_failed' });

  }

});

app.delete('/api/admin/listings/seed', auth, requireAdmin, async (_req, res) => {

  try {

    const removed = await deleteSeedListingsInternal();

    res.json({ ok: true, deleted: removed });

  } catch (e) {

    console.error('Admin delete seed listings failed:', e);

    return res.status(500).json({ error: 'seed_delete_failed' });

  }

});

app.delete('/api/admin/listings/:id', auth, requireAdmin, async (req, res) => {

  try {

    const id = Number(req.params.id);

    await db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);

    const info = await db.prepare('DELETE FROM listings WHERE id = ?').run(id);

    await invalidateNearbyCache();

    res.json({ ok: true, deleted: info.changes });

  } catch (e) {

    console.error('Admin delete listing failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});





app.get('/api/admin/users/search', auth, requireAdmin, async (req, res) => {

  try {

    const qRaw = String(req.query.q || '').trim();

    if (!qRaw) return res.json([]);

    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);



    let rows = [];

    const numeric = Number(qRaw);

    if (Number.isFinite(numeric)) {

      rows = await db.prepare(`

        SELECT u.id, u.email, u.username, u.created_at,

               COALESCE(u.account_status, 'active') AS account_status,

               u.status_note,

               u.status_updated_at,

               u.last_login_at,

               (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS listing_count,
               (SELECT COUNT(*) FROM seller_reports WHERE reported_user_id = u.id AND status != 'cleared') AS report_count
          FROM users u

         WHERE u.id = ?

      `).all(numeric);

    } else {

      const like = `%${qRaw.toLowerCase().replace(/%/g, '')}%`;

      rows = await db.prepare(`

        SELECT u.id, u.email, u.username, u.created_at,

               COALESCE(u.account_status, 'active') AS account_status,

               u.status_note,

               u.status_updated_at,

               u.last_login_at,

               (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS listing_count,
               (SELECT COUNT(*) FROM seller_reports WHERE reported_user_id = u.id AND status != 'cleared') AS report_count
          FROM users u

         WHERE LOWER(u.email) LIKE @like

            OR LOWER(u.username) LIKE @like

         ORDER BY u.username ASC, u.id ASC

         LIMIT @limit

      `).all({ like, limit });

    }



    const result = rows.map(row => ({

      id: row.id,

      email: row.email,

      username: row.username,

      created_at: row.created_at,

      account_status: row.account_status,

      status_note: row.status_note,

      status_updated_at: row.status_updated_at,

      last_login_at: row.last_login_at,

      listing_count: Number(row.listing_count || 0),

      report_count: Number(row.report_count || 0)

    }));



    return res.json(result);

  } catch (e) {

    console.error('Admin user search failed:', e);

    return res.status(500).json({ error: 'admin_search_failed' });

  }

});



app.get('/api/admin/users/:id', auth, requireAdmin, async (req, res) => {

  try {

    const userId = Number(req.params.id);

    if (!Number.isFinite(userId)) {

      return res.status(400).json({ error: 'invalid_user' });

    }



    const row = await db.prepare(`

      SELECT u.id, u.email, u.username, u.created_at,

             COALESCE(u.account_status, 'active') AS account_status,

             u.status_note,

             u.status_updated_at,

             u.last_login_at,

             u.paypal_email,

             u.location_preset,

             u.is_admin,

             (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS listing_count,
             (SELECT COUNT(*) FROM seller_reports WHERE reported_user_id = u.id AND status != 'cleared') AS report_count,
             (SELECT COUNT(*) FROM seller_reports WHERE reported_user_id = u.id AND status = 'open') AS open_report_count

        FROM users u

       WHERE u.id = ?

    `).get(userId);



    if (!row) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    const recentReport = await db.prepare(`

      SELECT created_at

        FROM seller_reports

       WHERE reported_user_id = ?
         AND status != 'cleared'
       ORDER BY created_at DESC

       LIMIT 1

    `).get(userId);



    return res.json({

      id: row.id,

      email: row.email,

      username: row.username,

      created_at: row.created_at,

      account_status: row.account_status,

      status_note: row.status_note,

      status_updated_at: row.status_updated_at,

      last_login_at: row.last_login_at,

      paypal_email: row.paypal_email || '',

      location_preset: row.location_preset || '',

      profile_picture_url: row.profile_picture_url || '',

      is_admin: !!row.is_admin,

      listing_count: Number(row.listing_count || 0),

      report_count: Number(row.report_count || 0),

      open_report_count: Number(row.open_report_count || 0),

      last_report_at: recentReport?.created_at || null

    });

  } catch (e) {

    console.error('Admin user detail failed:', e);

    return res.status(500).json({ error: 'admin_user_failed' });

  }

});



app.get('/api/admin/users/:id/reports', auth, requireAdmin, async (req, res) => {

  try {

    const userId = Number(req.params.id);

    if (!Number.isFinite(userId)) {

      return res.status(400).json({ error: 'invalid_user' });

    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);



    const rows = await db.prepare(`

      SELECT r.id, r.listing_id, r.reasons, r.details, r.created_at, r.status, r.admin_note,
             r.resolved_at, r.resolved_by, r.resolved_note,
             r.reporter_user_id,

             reporter.username AS reporter_username,

             reporter.email AS reporter_email

        FROM seller_reports r

        JOIN users reporter ON reporter.id = r.reporter_user_id

       WHERE r.reported_user_id = ?

       ORDER BY r.created_at DESC

       LIMIT ?

    `).all(userId, limit);



    const parsed = rows.map(row => {

      let reasons;

      try {

        reasons = Array.isArray(row.reasons) ? row.reasons : JSON.parse(row.reasons || '[]');

        if (!Array.isArray(reasons)) reasons = [];

      } catch {

        reasons = [];

      }

      return {

        id: row.id,

        listing_id: row.listing_id,

        reasons,

        details: row.details,

        created_at: row.created_at,

        status: row.status,

        admin_note: row.admin_note,
        resolved_at: row.resolved_at || null,
        resolved_by: row.resolved_by || null,
        resolved_note: row.resolved_note || null,
        reporter: {

          id: row.reporter_user_id,

          username: row.reporter_username,

          email: row.reporter_email

        }

      };

    });



    return res.json(parsed);

  } catch (e) {

    console.error('Admin report list failed:', e);

    return res.status(500).json({ error: 'admin_reports_failed' });

  }

});

app.post('/api/admin/users/:id/reports/clear', auth, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'invalid_user' });
    }

    const existing = await db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!existing) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    const noteRaw = (req.body?.note ?? '').toString().trim();
    const note = noteRaw.length ? noteRaw.slice(0, 500) : '';
    const now = nowIso();
    const adminId = Number.isFinite(Number(req.user?.id)) ? Number(req.user.id) : null;

    const info = await db.prepare(`
      UPDATE seller_reports
         SET status = 'cleared',
             resolved_at = @now,
             resolved_by = @adminId,
             resolved_note = CASE WHEN @note != '' THEN @note ELSE resolved_note END
       WHERE reported_user_id = @userId
         AND status != 'cleared'
    `).run({ now, adminId, note, userId });

    return res.json({ ok: true, cleared: info.changes || 0 });
  } catch (e) {
    console.error('Admin clear reports failed:', e);
    return res.status(500).json({ error: 'admin_clear_failed' });
  }
});

app.post('/api/admin/users/:id/status', auth, requireAdmin, async (req, res) => {

  try {

    const userId = Number(req.params.id);

    if (!Number.isFinite(userId)) {

      return res.status(400).json({ error: 'invalid_user' });

    }



    const statusRaw = String(req.body?.status || '').trim().toLowerCase();

    const allowed = new Set(['active', 'locked', 'banned']);

    if (!allowed.has(statusRaw)) {

      return res.status(400).json({ error: 'invalid_status' });

    }



    let note = (req.body?.note || '').toString().trim();

    if (note) note = note.slice(0, 500);

    if (statusRaw === 'active' && !note) note = null;



    const now = nowIso();

    const info = await db.prepare(`

      UPDATE users

         SET account_status = ?,

             status_note = ?,

             status_updated_at = ?

       WHERE id = ?

    `).run(statusRaw, note || null, now, userId);



    if (!info.changes) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    const updated = await getUserWithStatus(userId);

    if (!updated) {

      return res.status(404).json({ error: 'user_not_found' });

    }



    return res.json({

      id: updated.id,

      email: updated.email,

      username: updated.username,

      account_status: updated.account_status,

      status_note: updated.status_note,

      status_updated_at: updated.status_updated_at,

      created_at: updated.created_at,

      last_login_at: updated.last_login_at,

      is_admin: updated.is_admin

    });

  } catch (e) {

    console.error('Admin user status update failed:', e);

    return res.status(500).json({ error: 'status_update_failed' });

  }

});



app.get('/api/admin/reports/top', auth, requireAdmin, async (req, res) => {

  try {

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    const daysParam = Number(req.query.days);

    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const minParam = Number(req.query.min ?? req.query.min_reports);

    const minReports = Math.max(1, Number.isFinite(minParam) && minParam > 0 ? minParam : ADMIN_REPORT_MIN);

    const rows = await db.prepare(`

      SELECT r.reported_user_id AS user_id,

             u.username,

             u.email,

             COALESCE(u.account_status, 'active') AS account_status,

             COUNT(*) AS total_reports,

             SUM(CASE WHEN r.status = 'open' THEN 1 ELSE 0 END) AS open_reports,

             SUM(CASE WHEN r.created_at >= @since THEN 1 ELSE 0 END) AS recent_reports,

             MAX(r.created_at) AS last_report_at

        FROM seller_reports r

        JOIN users u ON u.id = r.reported_user_id
       WHERE r.status != 'cleared'
       GROUP BY r.reported_user_id, u.username, u.email, COALESCE(u.account_status, 'active')
      HAVING COUNT(*) >= @minReports
       ORDER BY total_reports DESC, last_report_at DESC

       LIMIT @limit
    `).all({ since, limit, minReports });

    const payload = rows.map(row => ({

      user_id: row.user_id,

      username: row.username,

      email: row.email,

      account_status: row.account_status,

      total_reports: Number(row.total_reports || 0),

      open_reports: Number(row.open_reports || 0),

      recent_reports: Number(row.recent_reports || 0),

      last_report_at: row.last_report_at
    }));

    return res.json({ items: payload, days, min_reports: minReports });
  } catch (e) {
    console.error('Admin top reports failed:', e);
    return res.status(500).json({ error: 'admin_reports_failed' });
  }
});




app.delete('/api/admin/listings', auth, requireAdmin, async (_req, res) => {

  try {

    await db.exec('DELETE FROM listing_images; DELETE FROM listings;');

    await invalidateNearbyCache();

    res.json({ ok: true });

  } catch (e) {

    console.error('Admin delete all failed:', e);

    return res.status(500).json({ error: 'delete_failed' });

  }

});



if (IS_TEST) {

  app.post('/__test/reset', async (_req, res) => {

    try {

      const tables = [
        'push_subscriptions',
        'message_images',
        'messages',
        'conversations',
        'listing_images',
        'seller_reports',
        'listings',
        'listing_cities',
        'users'
      ];

      await db.exec(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE;`);

      if (mailService.__reset) mailService.__reset();
      await invalidateNearbyCache();

      res.json({ ok: true });

    } catch (e) {

      console.error('Test reset failed:', e);

      res.status(500).json({ error: 'reset_failed' });

    }

  });

}



/* ------------------------------------------------------------------ */

/* Health & Error handling                                            */

/* ------------------------------------------------------------------ */

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));



app.use((err, _req, res, _next) => {

  console.error('Unhandled error:', err);

  res.status(500).json({ error: 'server_error' });

});



app._maybeCreateAdmin = maybeCreateAdmin;

app._db = db;

app._features = GEO_FEATURES;

app._deps = {
  stripe,
  mailService,
  pushService
};

app._runMigrations = runMigrations;
app._initializeSchema = runMigrations;

/**
 * Start the server
 */
async function startServer() {
  try {
    await maybeCreateAdmin();

    const server = require('http').createServer(app);
    let embeddedWebSocket = null;

    if (EMBED_WEBSOCKET) {
      try {
        const { createWebSocketService } = require('./services/websocket-service');
        const wsConfig = {
          JWT_SECRET,
          WEBSOCKET_PORT: Number(process.env.WEBSOCKET_PORT || PORT),
          NODE_ENV: process.env.NODE_ENV || 'development',
          IS_TEST
        };
        embeddedWebSocket = await createWebSocketService(wsConfig, fallbackMessageBus, { server });
        app._embeddedWebSocket = embeddedWebSocket;
      } catch (err) {
        console.error('[Server] Failed to initialize embedded WebSocket service:', err);
      }
    }

    server.listen(PORT, () => {
      console.log(`ListIt running at http://localhost:${PORT}`);
      if (embeddedWebSocket) {
        embeddedWebSocket.start()
          .then(() => {
            console.log('[Server] WebSocket endpoint ready at /ws');
          })
          .catch((err) => {
            console.error('[Server] Failed to start embedded WebSocket service:', err);
          });
      }
    });
  } catch (err) {
    if (String(err?.message || '').includes('relation')) {
      console.error('[Server] Failed to start: database schema missing. Run `npm run migrate:latest` before starting the server.');
    } else {
      console.error('[Server] Failed to start:', err);
    }
    process.exit(1);
  }
}

// Start server if this is the main module
if (require.main === module) {
  startServer();
}

module.exports = app;




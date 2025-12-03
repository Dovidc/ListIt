/**
 * Shared service configuration and startup utilities
 */

const path = require('path');
const fs = require('fs');
const { resolveSslConfig, getPoolSettings } = require('./database-config');

/**
 * Load environment variables from .env files
 */
function loadEnvironment() {
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
}

/**
 * Get service configuration
 */
function getServiceConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const poolSettings = getPoolSettings();
  const sslConfig = resolveSslConfig();
  const redisUrl = process.env.REDIS_URL;

  const messageBusDefault = process.env.MESSAGE_BUS_TYPE
    || (isProd ? 'redis' : (redisUrl ? 'redis' : 'memory'));

  return {
    // Core config
    PORT: parseInt(process.env.PORT || '3000', 10),
    NODE_ENV: nodeEnv,
    IS_PROD: isProd,
    IS_TEST: nodeEnv === 'test',
    JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',

    // Database
    DB_CONN_STRING: process.env.DATABASE_URL,
    DB_POOL_MAX: poolSettings.max,
    DB_POOL_MIN: poolSettings.min,
    DB_IDLE_TIMEOUT_MS: poolSettings.idleTimeoutMillis,
    DB_CONNECTION_TIMEOUT_MS: poolSettings.connectionTimeoutMillis,
    DB_SSL: sslConfig,

    // Services
    ENABLE_HTTP_API: process.env.ENABLE_HTTP_API !== 'false',
    ENABLE_WEBSOCKET: process.env.ENABLE_WEBSOCKET !== 'false',
    ENABLE_WORKER: process.env.ENABLE_WORKER !== 'false',

    // Service ports (if running separately)
    API_PORT: parseInt(process.env.API_PORT || process.env.PORT || '3001', 10),
    WEBSOCKET_PORT: parseInt(process.env.WEBSOCKET_PORT || '3002', 10),
    WORKER_PORT: parseInt(process.env.WORKER_PORT || '3003', 10),

    // Message bus (Redis)
    REDIS_URL: redisUrl || 'redis://localhost:6379',
    MESSAGE_BUS_TYPE: messageBusDefault, // 'memory', 'redis'

    // External services
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_API_VERSION: process.env.STRIPE_API_VERSION || '2024-06-20',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    SENDGRID_FROM_EMAIL: process.env.SENDGRID_FROM_EMAIL,

    // Feature flags
    GEO_FEATURES_ENABLED: process.env.GEO_FEATURES_ENABLED !== 'false',
    ENABLE_PUSH_NOTIFICATIONS: process.env.ENABLE_PUSH_NOTIFICATIONS !== 'false',

    // Rate limiting
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),

    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
  };
}

/**
 * Validate required configuration
 */
function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.DB_CONN_STRING) {
    errors.push('DATABASE_URL is required');
  }

  if (!config.JWT_SECRET || config.JWT_SECRET === 'dev-secret-change-in-production') {
    if (config.IS_PROD) {
      errors.push('JWT_SECRET must be set in production');
    } else {
      console.warn('[config] Using default JWT_SECRET - change this in production!');
    }
  }

  if (config.IS_PROD && config.DB_SSL === false) {
    errors.push('Database TLS is required in production. Remove DATABASE_SSL=false or set DATABASE_SSL_MODE=require.');
  }

  if (config.IS_PROD) {
    if ((config.MESSAGE_BUS_TYPE || '').toLowerCase() !== 'redis') {
      errors.push('MESSAGE_BUS_TYPE must be set to "redis" in production to enable distributed messaging.');
    }
    if (!config.REDIS_URL) {
      errors.push('REDIS_URL is required in production so the message bus can run out-of-process.');
    }
  }

  const paymentsDisabled = process.env.PAYMENTS_DISABLED === '1';
  if (config.IS_PROD && !paymentsDisabled) {
    if (!config.STRIPE_SECRET_KEY) {
      errors.push('STRIPE_SECRET_KEY is required in production when payments are enabled.');
    }
    if (!config.STRIPE_WEBHOOK_SECRET) {
      errors.push('STRIPE_WEBHOOK_SECRET is required in production so webhook verification can succeed.');
    }
  } else if (!config.IS_PROD && (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET)) {
    warnings.push('[config] Stripe keys are not fully configured; payment flows may be disabled.');
  }

  if (config.IS_PROD) {
    if (!config.SENDGRID_API_KEY) {
      errors.push('SENDGRID_API_KEY is required in production for transactional email.');
    }
    if (!config.SENDGRID_FROM_EMAIL) {
      errors.push('SENDGRID_FROM_EMAIL must be set in production so outbound email has a valid sender.');
    }
  } else if (!config.SENDGRID_API_KEY || !config.SENDGRID_FROM_EMAIL) {
    warnings.push('[config] SendGrid API key/from email not fully configured; emails will not send.');
  }

  const s3Region = process.env.AWS_REGION || config.S3_REGION;
  if (config.IS_PROD) {
    if (!config.S3_BUCKET) {
      errors.push('S3_BUCKET is required in production for asset uploads.');
    }
    if (!s3Region) {
      errors.push('S3_REGION (or AWS_REGION) is required in production for S3 access.');
    }
  } else if (!config.S3_BUCKET || !s3Region) {
    warnings.push('[config] S3 is not fully configured; media upload endpoints will be disabled.');
  }

  if (errors.length > 0) {
    console.error('[config] Configuration errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    return false;
  }

  if (warnings.length > 0) {
    warnings.forEach((msg) => console.warn(msg));
  }

  return true;
}

/**
 * Create health check handler
 */
function createHealthCheckHandler(services = {}) {
  return async (req, res) => {
    const health = {
      ok: true,
      timestamp: new Date().toISOString(),
      services: {}
    };

    // Check each service
    for (const [name, service] of Object.entries(services)) {
      if (service && typeof service.healthCheck === 'function') {
        try {
          health.services[name] = await service.healthCheck();
        } catch (err) {
          health.services[name] = { ok: false, error: err.message };
          health.ok = false;
        }
      }
    }

    const statusCode = health.ok ? 200 : 503;
    res.status(statusCode).json(health);
  };
}

/**
 * Setup graceful shutdown
 */
function setupGracefulShutdown(servers = []) {
  const signals = ['SIGTERM', 'SIGINT'];

  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`\n[server] Received ${signal}, shutting down gracefully...`);

      // Close all servers
      for (const server of servers) {
        if (server && typeof server.close === 'function') {
          await new Promise(resolve => {
            server.close(() => {
              console.log('[server] Server closed');
              resolve();
            });
          });
        }
      }

      process.exit(0);
    });
  });
}

module.exports = {
  loadEnvironment,
  getServiceConfig,
  validateConfig,
  createHealthCheckHandler,
  setupGracefulShutdown
};

/**
 * Shared service configuration and startup utilities
 */

const path = require('path');
const fs = require('fs');

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
  return {
    // Core config
    PORT: parseInt(process.env.PORT || '3000', 10),
    NODE_ENV: process.env.NODE_ENV || 'development',
    IS_PROD: process.env.NODE_ENV === 'production',
    IS_TEST: process.env.NODE_ENV === 'test',
    JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',

    // Database
    DB_CONN_STRING: process.env.DATABASE_URL,

    // Services
    ENABLE_HTTP_API: process.env.ENABLE_HTTP_API !== 'false',
    ENABLE_WEBSOCKET: process.env.ENABLE_WEBSOCKET !== 'false',
    ENABLE_WORKER: process.env.ENABLE_WORKER !== 'false',

    // Service ports (if running separately)
    API_PORT: parseInt(process.env.API_PORT || process.env.PORT || '3001', 10),
    WEBSOCKET_PORT: parseInt(process.env.WEBSOCKET_PORT || '3002', 10),
    WORKER_PORT: parseInt(process.env.WORKER_PORT || '3003', 10),

    // Message bus (Redis)
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    MESSAGE_BUS_TYPE: process.env.MESSAGE_BUS_TYPE || 'memory', // 'memory', 'redis'

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

  if (errors.length > 0) {
    console.error('[config] Configuration errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    return false;
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

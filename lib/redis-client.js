let Redis;
try {
  Redis = require('ioredis');
} catch (err) {
  Redis = null;
}

let singleton = null;

function getRedisClient(options = {}) {
  const nodeEnv = options.NODE_ENV || process.env.NODE_ENV || 'development';
  const requireExternal = options.requireExternal ?? (nodeEnv === 'production');

  if (!Redis) {
    if (requireExternal) {
      throw new Error('[redis] ioredis is required in production; install dependency and set REDIS_URL');
    }
    return null;
  }

  const url = options.url || process.env.REDIS_URL;
  if (!url) {
    if (requireExternal) {
      throw new Error('[redis] REDIS_URL must be configured in production');
    }
    return null;
  }

  if (!singleton) {
    singleton = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });

    singleton.on('error', (err) => {
      if (!err) return;
      const msg = err?.message || err;
      console.error('[redis] connection error:', msg);
    });

    // Initiate the connection immediately so commands issued later
    // don't reject with "Redis is still connecting" errors when
    // lazyConnect mode is enabled. Ignore the returned promise to avoid
    // forcing callers to await here; operational errors are surfaced via
    // the error listener above.
    singleton.connect().catch((err) => {
      const msg = err?.message || err;
      console.error('[redis] initial connect error:', msg);
    });
  }

  return singleton;
}

module.exports = { getRedisClient };

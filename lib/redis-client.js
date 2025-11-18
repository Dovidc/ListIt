let Redis;
try {
  Redis = require('ioredis');
} catch (err) {
  Redis = null;
}

let singleton = null;

function getRedisClient(options = {}) {
  if (!Redis) return null;

  const url = options.url || process.env.REDIS_URL;
  if (!url) return null;

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
  }

  return singleton;
}

module.exports = { getRedisClient };

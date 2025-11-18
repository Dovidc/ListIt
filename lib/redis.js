const Redis = require('ioredis');

let redisClient = null;

function getRedis(options = {}) {
  if (redisClient) return redisClient;

  const url = options.url || process.env.REDIS_URL;
  if (!url) {
    return null;
  }

  redisClient = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null
  });

  redisClient.on('error', (err) => {
    const message = err?.message || err;
    console.warn('[redis] connection error:', message);
  });

  redisClient.on('connect', () => {
    console.log('[redis] connected');
  });

  return redisClient;
}

module.exports = {
  getRedis
};

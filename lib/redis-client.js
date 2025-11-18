let Redis;
try {
  Redis = require('ioredis');
} catch (err) {
  Redis = null;
}

const clients = new Map();

function getRedisClient(options = {}) {
  const {
    url = process.env.REDIS_URL,
    require: requireClient = false,
    purpose = 'shared redis client',
    overrides = {}
  } = options;

  if (!Redis) {
    if (requireClient) {
      throw new Error(`[redis] ioredis is required for ${purpose}`);
    }
    return null;
  }

  if (!url) {
    if (requireClient) {
      throw new Error(`[redis] REDIS_URL must be set for ${purpose}`);
    }
    return null;
  }

  if (clients.has(url)) {
    return clients.get(url);
  }

  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    ...overrides
  });

  client.on('error', (err) => {
    if (!err) return;
    const msg = err?.message || err;
    console.error(`[redis] connection error (${purpose}):`, msg);
  });

  client.connect().catch((err) => {
    const msg = err?.message || err;
    console.error(`[redis] initial connect error (${purpose}):`, msg);
    if (requireClient) {
      process.nextTick(() => {
        throw err;
      });
    }
  });

  clients.set(url, client);
  return client;
}

module.exports = { getRedisClient };

const { getRedisClient } = require('./redis-client');

class CacheStats {
  constructor() {
    this.hits = 0;
    this.misses = 0;
  }

  hit() {
    this.hits += 1;
  }

  miss() {
    this.misses += 1;
  }

  snapshot() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : Number((this.hits / total).toFixed(4))
    };
  }
}

class LocalLRUCache {
  constructor(maxSize, ttlMs = null) {
    this.maxSize = Math.max(1, maxSize || 100);
    this.ttlMs = ttlMs || null;
    this.cache = new Map();
    this.stats = new CacheStats();
  }

  has(key) {
    if (!this.cache.has(key)) return false;
    const item = this.cache.get(key);
    if (this.ttlMs && Date.now() - item.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  get(key) {
    if (!this.cache.has(key)) {
      this.stats.miss();
      return null;
    }
    const item = this.cache.get(key);
    if (this.ttlMs && Date.now() - item.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.stats.miss();
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, item);
    this.stats.hit();
    return item.value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    return this.stats.snapshot();
  }
}

class RedisCache {
  constructor(redis, options = {}) {
    this.redis = redis;
    this.ttlMs = Math.max(1, options.ttlMs || 60000);
    this.prefix = options.prefix
      || process.env.SHARED_CACHE_PREFIX
      || 'cache:shared';
    this.stats = new CacheStats();
  }

  _key(key) {
    return `${this.prefix}:${key}`;
  }

  async get(key) {
    const redisKey = this._key(key);
    const payload = await this.redis.get(redisKey);
    if (!payload) {
      this.stats.miss();
      return null;
    }
    try {
      const parsed = JSON.parse(payload);
      this.stats.hit();
      return parsed;
    } catch (err) {
      await this.redis.del(redisKey);
      this.stats.miss();
      return null;
    }
  }

  async set(key, value) {
    const redisKey = this._key(key);
    const payload = JSON.stringify(value);
    await this.redis.psetex(redisKey, this.ttlMs, payload);
  }

  async delete(key) {
    await this.redis.del(this._key(key));
  }

  async clear() {
    let cursor = '0';
    const pattern = `${this.prefix}:*`;
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (Array.isArray(keys) && keys.length) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  getStats() {
    return this.stats.snapshot();
  }
}

function createSharedCache(options = {}) {
  const requireRedis = options.requireRedis ?? (process.env.NODE_ENV === 'production');
  const clientOptions = {
    require: requireRedis,
    purpose: 'shared cache'
  };
  if (options.redisUrl) {
    clientOptions.url = options.redisUrl;
  }
  const redis = getRedisClient(clientOptions);

  if (redis) {
    return new RedisCache(redis, options);
  }

  if (requireRedis) {
    throw new Error('Redis is required for the shared cache in production.');
  }

  console.warn('[cache] Redis unavailable; falling back to per-instance LRU cache.');
  const maxSize = Math.max(1, options.maxSize || 100);
  const ttlMs = options.ttlMs || null;
  return new LocalLRUCache(maxSize, ttlMs);
}

module.exports = { createSharedCache };

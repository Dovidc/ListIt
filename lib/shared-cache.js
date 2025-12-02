const crypto = require('crypto');
const { getRedisClient } = require('./redis-client');

const IS_PROD = process.env.NODE_ENV === 'production';

class LocalLRUCache {
  constructor(maxSize, ttlMs = null) {
    this.maxSize = Math.max(1, maxSize || 100);
    this.ttlMs = ttlMs || null;
    this.cache = new Map();
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
    if (!this.cache.has(key)) return null;
    const item = this.cache.get(key);
    if (this.ttlMs && Date.now() - item.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, item);
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
}

class RedisCache {
  constructor(redis, options = {}) {
    this.redis = redis;
    this.ttlMs = Math.max(1, options.ttlMs || 60000);
    const suffix = options.prefix
      || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'));
    this.prefix = `cache:${suffix}`;
  }

  _key(key) {
    return `${this.prefix}:${key}`;
  }

  async get(key) {
    const redisKey = this._key(key);
    const payload = await this.redis.get(redisKey);
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch (err) {
      await this.redis.del(redisKey);
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
}

function createSharedCache(options = {}) {
  const redis = getRedisClient();
  if (redis) {
    return new RedisCache(redis, options);
  }
  if (IS_PROD) {
    throw new Error('[shared-cache] Redis is required in production; set REDIS_URL');
  }
  const maxSize = Math.max(1, options.maxSize || 100);
  const ttlMs = options.ttlMs || null;
  return new LocalLRUCache(maxSize, ttlMs);
}

module.exports = { createSharedCache };

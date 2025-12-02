const { getRedisClient } = require('./redis-client');

class RedisRateLimitStore {
  constructor(redis, options = {}) {
    this.redis = redis;
    this.windowMs = options.windowMs || 60000;
    this.prefix = `rate-limit:${options.name || 'default'}`;
    this.localKeys = false;
  }

  init(options) {
    if (options?.windowMs) {
      this.windowMs = options.windowMs;
    }
  }

  _key(key) {
    return `${this.prefix}:${key}`;
  }

  async get(key) {
    const redisKey = this._key(key);
    const pipeline = this.redis.multi();
    pipeline.get(redisKey);
    pipeline.pttl(redisKey);
    const [[, value], [, ttl]] = await pipeline.exec();
    if (!value) return undefined;
    const totalHits = Number(value);
    if (!Number.isFinite(totalHits) || totalHits <= 0) {
      return undefined;
    }
    const ttlMs = typeof ttl === 'number' && ttl > 0 ? ttl : this.windowMs;
    return {
      totalHits,
      resetTime: new Date(Date.now() + ttlMs)
    };
  }

  async increment(key) {
    const redisKey = this._key(key);
    const pipeline = this.redis.multi();
    pipeline.incr(redisKey);
    pipeline.pexpire(redisKey, this.windowMs);
    pipeline.pttl(redisKey);
    const [[, hits], [,], [, ttl]] = await pipeline.exec();
    const totalHits = Number(hits) || 0;
    const ttlMs = typeof ttl === 'number' && ttl > 0 ? ttl : this.windowMs;
    return {
      totalHits,
      resetTime: new Date(Date.now() + ttlMs)
    };
  }

  async decrement(key) {
    const redisKey = this._key(key);
    const exists = await this.redis.exists(redisKey);
    if (!exists) return;
    const next = await this.redis.decr(redisKey);
    if (next <= 0) {
      await this.redis.del(redisKey);
    } else {
      await this.redis.pexpire(redisKey, this.windowMs);
    }
  }

  async resetKey(key) {
    await this.redis.del(this._key(key));
  }

  async resetAll() {
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

  shutdown() {
    // no-op; Redis handles its own lifecycle
  }
}

function createRateLimitStore(options = {}) {
  const redis = getRedisClient();
  if (!redis) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[rate-limit] Redis is required in production; set REDIS_URL');
    }
    return null;
  }
  return new RedisRateLimitStore(redis, options);
}

module.exports = { createRateLimitStore };

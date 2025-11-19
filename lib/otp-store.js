const crypto = require('crypto');
const { getRedisClient } = require('./redis-client');

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

class MemoryOtpStore {
  constructor(options = {}) {
    this.entries = new Map();
    this.ttlMs = options.ttlMs || 5 * 60 * 1000;
    this.allowPlaintext = options.allowPlaintext || false;
  }

  async remember(key, code, meta = {}) {
    if (!key || !code) return;
    const payload = {
      hash: hashCode(code),
      meta,
      storedAt: Date.now()
    };
    if (this.allowPlaintext) {
      payload.code = code;
    }
    this.entries.set(key, payload);
    const timer = setTimeout(() => {
      this.entries.delete(key);
    }, this.ttlMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  async peek(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return entry.code || null;
  }

  async clear() {
    this.entries.clear();
  }
}

class RedisOtpStore {
  constructor(options = {}) {
    const requireRedis = options.requireRedis ?? (process.env.NODE_ENV === 'production');
    this.redis = options.redis || getRedisClient({
      require: requireRedis,
      purpose: 'otp store'
    });
    if (!this.redis) {
      throw new Error('Redis is required for RedisOtpStore');
    }
    this.ttlMs = options.ttlMs || 5 * 60 * 1000;
    this.prefix = options.prefix || 'otp:verification';
    this.allowPlaintext = options.allowPlaintext || false;
  }

  _key(key) {
    return `${this.prefix}:${key}`;
  }

  async remember(key, code, meta = {}) {
    if (!key || !code) return;
    const payload = {
      hash: hashCode(code),
      meta,
      storedAt: Date.now()
    };
    if (this.allowPlaintext) {
      payload.code = code;
    }
    await this.redis.set(this._key(key), JSON.stringify(payload), 'PX', this.ttlMs);
  }

  async peek(key) {
    if (!this.allowPlaintext) return null;
    const raw = await this.redis.get(this._key(key));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed.code || null;
    } catch (err) {
      return null;
    }
  }

  async clear() {
    let cursor = '0';
    const pattern = `${this.prefix}:*`;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (Array.isArray(keys) && keys.length) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }
}

function createOtpStore(options = {}) {
  try {
    return new RedisOtpStore(options);
  } catch (err) {
    if (options.requireRedis || process.env.NODE_ENV === 'production') {
      throw err;
    }
    console.warn('[otp] Falling back to in-memory OTP store:', err?.message || err);
    return new MemoryOtpStore(options);
  }
}

module.exports = {
  createOtpStore,
  MemoryOtpStore,
  RedisOtpStore
};

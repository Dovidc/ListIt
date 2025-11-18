const os = require('os');
const { getRedisClient } = require('./redis-client');

class InMemoryPresenceStore {
  constructor(options = {}) {
    this.userSessions = new Map();
    this.sessions = new Map();
    this.ttlMs = options.ttlMs || 60000;
    this.timer = null;
  }

  async start() {
    this.timer = setInterval(() => this._prune(), this.ttlMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.userSessions.clear();
    this.sessions.clear();
  }

  _prune() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [sessionId, entry] of this.sessions) {
      if (entry.updatedAt < cutoff) {
        this.sessions.delete(sessionId);
        const sessions = this.userSessions.get(entry.userId);
        if (sessions) {
          sessions.delete(sessionId);
          if (sessions.size === 0) this.userSessions.delete(entry.userId);
        }
      }
    }
  }

  async addSession(userId, sessionId, meta = {}) {
    if (!userId || !sessionId) return;
    const entry = { ...meta, userId, sessionId, updatedAt: Date.now() };
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Map());
    }
    this.userSessions.get(userId).set(sessionId, entry);
    this.sessions.set(sessionId, entry);
  }

  async touchSession(userId, sessionId, meta = {}) {
    await this.addSession(userId, sessionId, meta);
  }

  async removeSession(userId, sessionId) {
    if (!sessionId) return;
    const targetUser = userId || this.sessions.get(sessionId)?.userId;
    if (targetUser && this.userSessions.has(targetUser)) {
      const sessions = this.userSessions.get(targetUser);
      sessions.delete(sessionId);
      if (sessions.size === 0) {
        this.userSessions.delete(targetUser);
      }
    }
    this.sessions.delete(sessionId);
  }

  async getUserSessions(userId) {
    if (!this.userSessions.has(userId)) return [];
    return Array.from(this.userSessions.get(userId).values());
  }

  async getSummary() {
    return {
      users: this.userSessions.size,
      sessions: this.sessions.size
    };
  }
}

class RedisPresenceStore {
  constructor(options = {}) {
    const requireRedis = options.requireRedis ?? (process.env.NODE_ENV === 'production');
    this.redis = options.redis || getRedisClient({
      require: requireRedis,
      purpose: 'presence store'
    });
    if (!this.redis) {
      throw new Error('Redis is required for RedisPresenceStore');
    }
    this.ttlMs = options.ttlMs || 60000;
    this.prefix = options.prefix || 'presence:ws';
    this.nodeId = options.nodeId || process.env.INSTANCE_ID || os.hostname();
  }

  async start() {}
  async stop() {}

  _userKey(userId) {
    return `${this.prefix}:user:${userId}`;
  }

  _sessionKey(sessionId) {
    return `${this.prefix}:session:${sessionId}`;
  }

  async addSession(userId, sessionId, meta = {}) {
    if (!userId || !sessionId) return;
    const entry = JSON.stringify({ ...meta, userId, sessionId, nodeId: this.nodeId, updatedAt: Date.now() });
    await this.redis.multi()
      .hset(this._userKey(userId), sessionId, entry)
      .pexpire(this._userKey(userId), this.ttlMs)
      .set(this._sessionKey(sessionId), userId, 'PX', this.ttlMs)
      .exec();
  }

  async touchSession(userId, sessionId, meta = {}) {
    await this.addSession(userId, sessionId, meta);
  }

  async removeSession(userId, sessionId) {
    if (!sessionId) return;
    let resolvedUser = userId;
    if (!resolvedUser) {
      resolvedUser = await this.redis.get(this._sessionKey(sessionId));
    }
    const pipeline = this.redis.multi();
    if (resolvedUser) {
      pipeline.hdel(this._userKey(resolvedUser), sessionId);
    }
    pipeline.del(this._sessionKey(sessionId));
    await pipeline.exec();
  }

  async getUserSessions(userId) {
    const rawEntries = await this.redis.hgetall(this._userKey(userId));
    return Object.entries(rawEntries || {}).map(([sessionId, payload]) => {
      try {
        return { sessionId, ...(JSON.parse(payload) || {}) };
      } catch (err) {
        return { sessionId, nodeId: this.nodeId };
      }
    });
  }

  async getSummary() {
    const users = await this._countKeys(`${this.prefix}:user:*`);
    const sessions = await this._countKeys(`${this.prefix}:session:*`);
    return { users, sessions };
  }

  async _countKeys(pattern) {
    let cursor = '0';
    let total = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      total += Array.isArray(keys) ? keys.length : 0;
    } while (cursor !== '0');
    return total;
  }
}

function createPresenceStore(options = {}) {
  try {
    return new RedisPresenceStore(options);
  } catch (err) {
    if (options.requireRedis || process.env.NODE_ENV === 'production') {
      throw err;
    }
    console.warn('[presence] Falling back to in-memory presence store:', err?.message || err);
    return new InMemoryPresenceStore(options);
  }
}

module.exports = {
  createPresenceStore,
  RedisPresenceStore,
  InMemoryPresenceStore
};

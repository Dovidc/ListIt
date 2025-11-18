const EventEmitter = require('events');

let Redis;
try {
  Redis = require('ioredis');
} catch (err) {
  Redis = null;
}

function createRedisConnection(url, overrides = {}) {
  if (!Redis) return null;
  const opts = {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    ...overrides
  };
  if (url) {
    return new Redis(url, opts);
  }
  return new Redis(opts);
}

class RedisMessageBus extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!Redis) {
      throw new Error('ioredis is required for Redis-backed message bus');
    }
    this.name = options.name || 'redis-bus';
    this.redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.redisOptions = options.redisOptions || {};
    this.logger = options.logger || console;
    this.subscribers = new Map();
    this.subscribedChannels = new Set();
    this.publisher = createRedisConnection(this.redisUrl, this.redisOptions);
    this.subscriber = createRedisConnection(this.redisUrl, this.redisOptions);
    this.ready = this._connect();
    this._closed = false;
  }

  static isSupported() {
    return Boolean(Redis);
  }

  async _connect() {
    const connectClient = (client) => (typeof client?.connect === 'function' ? client.connect() : Promise.resolve());
    await Promise.all([connectClient(this.publisher), connectClient(this.subscriber)]);
    this._wireSubscriber();
  }

  _wireSubscriber() {
    if (!this.subscriber) return;
    this.subscriber.on('message', (channel, payload) => {
      let parsed = payload;
      if (typeof payload === 'string') {
        try {
          parsed = JSON.parse(payload);
        } catch {
          parsed = payload;
        }
      }
      this._emitToHandlers(channel, parsed);
    });
    this.subscriber.on('error', (err) => {
      this.logger?.error?.('[RedisBus] subscriber error:', err?.message || err);
    });
    this.publisher?.on('error', (err) => {
      this.logger?.error?.('[RedisBus] publisher error:', err?.message || err);
    });
  }

  async _emitToHandlers(topic, message) {
    const handlers = this.subscribers.get(topic);
    if (!handlers || handlers.size === 0) return [];
    const results = [];
    for (const handler of handlers) {
      try {
        const result = await handler(message);
        results.push(result);
      } catch (err) {
        this.logger?.error?.(`[RedisBus] Error in handler for topic "${topic}":`, err);
        results.push(null);
      }
    }
    return results;
  }

  async _ensureSubscription(topic) {
    if (this.subscribedChannels.has(topic)) return;
    try {
      await this.ready;
      await this.subscriber.subscribe(topic);
      this.subscribedChannels.add(topic);
    } catch (err) {
      this.logger?.error?.(`[RedisBus] Failed to subscribe to ${topic}:`, err);
    }
  }

  async _removeSubscription(topic) {
    if (!this.subscribedChannels.has(topic)) return;
    try {
      await this.subscriber.unsubscribe(topic);
    } catch (err) {
      this.logger?.error?.(`[RedisBus] Failed to unsubscribe from ${topic}:`, err);
    }
    this.subscribedChannels.delete(topic);
  }

  subscribe(topic, handler) {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
      this._ensureSubscription(topic);
    }
    this.subscribers.get(topic).add(handler);
    return () => {
      const set = this.subscribers.get(topic);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        this.subscribers.delete(topic);
        this._removeSubscription(topic);
      }
    };
  }

  async publish(topic, message) {
    try {
      await this.ready;
      const payload = typeof message === 'string' ? message : JSON.stringify(message);
      await this.publisher.publish(topic, payload);
    } catch (err) {
      this.logger?.error?.(`[RedisBus] Failed to publish to "${topic}":`, err);
    }
  }

  async publishAwait(topic, message) {
    return this._emitToHandlers(topic, message);
  }

  getSubscriberCount(topic) {
    return this.subscribers.get(topic)?.size || 0;
  }

  getTopics() {
    return Array.from(this.subscribers.keys());
  }

  clear(topic = null) {
    if (topic) {
      this.subscribers.delete(topic);
      this._removeSubscription(topic);
      return;
    }
    for (const chan of Array.from(this.subscribedChannels)) {
      this._removeSubscription(chan);
    }
    this.subscribers.clear();
  }

  async shutdown() {
    if (this._closed) return;
    this._closed = true;
    this.clear();
    await Promise.all([
      this.publisher?.quit?.().catch(() => {}),
      this.subscriber?.quit?.().catch(() => {})
    ]);
  }
}

module.exports = { RedisMessageBus };

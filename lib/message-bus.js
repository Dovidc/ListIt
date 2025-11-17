/**
 * Message Bus Abstraction
 *
 * Provides a unified interface for pub/sub communication between services.
 * Starts with in-memory implementation; can be swapped for Redis/Kafka later.
 */

const EventEmitter = require('events');

let Redis;
try {
  Redis = require('ioredis');
} catch {
  // Optional dependency; fall back to in-memory bus when absent
}

class MessageBus extends EventEmitter {
  constructor(name = 'default') {
    super();
    this.name = name;
    this.subscribers = new Map();
  }

  /**
   * Subscribe to a topic
   * @param {string} topic - Topic name
   * @param {Function} handler - Message handler
   * @returns {Function} Unsubscribe function
   */
  subscribe(topic, handler) {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }
    this.subscribers.get(topic).add(handler);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(topic).delete(handler);
      if (this.subscribers.get(topic).size === 0) {
        this.subscribers.delete(topic);
      }
    };
  }

  /**
   * Publish a message to a topic
   * @param {string} topic - Topic name
   * @param {any} message - Message to publish
   */
  async publish(topic, message) {
    const handlers = this.subscribers.get(topic);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        await handler(message);
      } catch (err) {
        console.error(`[MessageBus] Error in handler for topic "${topic}":`, err);
      }
    }

    // Also emit as event for debugging
    this.emit(topic, message);
  }

  /**
   * Publish and wait for all handlers
   * @param {string} topic - Topic name
   * @param {any} message - Message to publish
   * @returns {Promise<any[]>} Results from all handlers
   */
  async publishAwait(topic, message) {
    const handlers = this.subscribers.get(topic);
    if (!handlers) return [];

    const results = [];
    for (const handler of handlers) {
      try {
        const result = await handler(message);
        results.push(result);
      } catch (err) {
        console.error(`[MessageBus] Error in handler for topic "${topic}":`, err);
        results.push(null);
      }
    }

    return results;
  }

  /**
   * Get subscriber count for a topic
   */
  getSubscriberCount(topic) {
    return this.subscribers.get(topic)?.size || 0;
  }

  /**
   * Get all topics with subscribers
   */
  getTopics() {
    return Array.from(this.subscribers.keys());
  }

  /**
   * Clear all subscribers for a topic or all topics
   */
  clear(topic = null) {
    if (topic) {
      this.subscribers.delete(topic);
    } else {
      this.subscribers.clear();
    }
  }
}

class RedisMessageBus extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!Redis) {
      throw new Error('ioredis is required for Redis-backed message bus');
    }
    this.name = options.name || 'redis-bus';
    this.redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.subscribers = new Map();
    this.subscribedChannels = new Set();
    this.publisher = new Redis(this.redisUrl, { lazyConnect: true });
    this.subscriber = new Redis(this.redisUrl, { lazyConnect: true });
    this.ready = this._connect();
  }

  async _connect() {
    const connectClient = (client) => (typeof client.connect === 'function' ? client.connect() : Promise.resolve());
    await Promise.all([connectClient(this.publisher), connectClient(this.subscriber)]);
    this.subscriber.on('message', (channel, payload) => {
      let parsed = payload;
      if (typeof payload === 'string') {
        try {
          parsed = JSON.parse(payload);
        } catch {
          // leave as raw string
        }
      }
      this._emitToHandlers(channel, parsed);
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
        console.error(`[RedisBus] Error in handler for topic "${topic}":`, err);
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
      console.error(`[RedisBus] Failed to subscribe to ${topic}:`, err);
    }
  }

  async _removeSubscription(topic) {
    if (!this.subscribedChannels.has(topic)) return;
    try {
      await this.subscriber.unsubscribe(topic);
    } catch (err) {
      console.error(`[RedisBus] Failed to unsubscribe from ${topic}:`, err);
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
      console.error(`[RedisBus] Failed to publish to "${topic}":`, err);
    }
  }

  async publishAwait(topic, message) {
    // Local handlers only; cross-process acknowledgements are not supported.
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
    } else {
      for (const chan of Array.from(this.subscribedChannels)) {
        this._removeSubscription(chan);
      }
      this.subscribers.clear();
    }
  }
}

function createMessageBus(options = {}) {
  const type = (options.type || process.env.MESSAGE_BUS_TYPE || 'memory').toLowerCase();
  if (type === 'redis') {
    if (!Redis) {
      console.warn('[MessageBus] MESSAGE_BUS_TYPE=redis requested but ioredis is not installed; falling back to in-memory bus');
    } else {
      try {
        return new RedisMessageBus(options);
      } catch (err) {
        console.error('[MessageBus] Failed to initialize Redis bus, falling back to in-memory:', err);
      }
    }
  }
  return new MessageBus(options.name || 'memory-bus');
}

/**
 * Standard message envelope format
 */
function createMessage(type, payload = {}, meta = {}) {
  return {
    type,
    payload,
    meta: {
      timestamp: Date.now(),
      ...meta
    }
  };
}

/**
 * Message topics constants
 */
const TOPICS = {
  // User events
  USER_REGISTERED: 'user.registered',
  USER_VERIFIED: 'user.verified',
  USER_LOGGED_IN: 'user.logged_in',
  USER_LOGGED_OUT: 'user.logged_out',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_DELETED: 'user.deleted',
  USER_AVATAR_UPDATED: 'user.avatar_updated',

  // Listing events
  LISTING_CREATED: 'listing.created',
  LISTING_UPDATED: 'listing.updated',
  LISTING_DELETED: 'listing.deleted',
  LISTING_MARKED_SOLD: 'listing.marked_sold',

  // Messaging/Chat events
  MESSAGE_SENT: 'message.sent',
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_DELETED: 'conversation.deleted',

  // Payment/Stripe events
  STRIPE_WEBHOOK: 'stripe.webhook',
  PAYMENT_SUCCESS: 'payment.success',
  PAYMENT_FAILED: 'payment.failed',
  SUPPORTER_STATUS_CHANGED: 'supporter.status_changed',

  // Push notification events
  PUSH_SUBSCRIBE: 'push.subscribe',
  PUSH_UNSUBSCRIBE: 'push.unsubscribe',
  PUSH_SEND: 'push.send',

  // Admin events
  ADMIN_ACTION: 'admin.action',
  ADMIN_FLAGGED_REPORT: 'admin.flagged_report',

  // System events
  NEARBY_LISTING_AVAILABLE: 'nearby.listing_available',
  HEALTH_CHECK: 'health.check',
  SERVICE_READY: 'service.ready'
};

module.exports = {
  MessageBus,
  RedisMessageBus,
  createMessageBus,
  createMessage,
  TOPICS
};

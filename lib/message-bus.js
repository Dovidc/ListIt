/**
 * Message Bus Abstraction
 *
 * Provides a unified interface for pub/sub communication between services.
 * Starts with in-memory implementation; can be swapped for Redis/Kafka later.
 */

const EventEmitter = require('events');
const { RedisMessageBus } = require('./redis-message-bus');
const { recordMessagePublished, recordMessageHandled } = require('./metrics');

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
    if (!handlers || handlers.size === 0) return;

    recordMessagePublished(topic);
    const tasks = [];
    for (const handler of handlers) {
      tasks.push((async () => {
        try {
          await handler(message);
          recordMessageHandled(topic, true);
        } catch (err) {
          console.error(`[MessageBus] Error in handler for topic "${topic}":`, err);
          recordMessageHandled(topic, false);
        }
      })());
    }

    await Promise.allSettled(tasks);

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
    if (!handlers || handlers.size === 0) return [];

    recordMessagePublished(topic);
    const tasks = Array.from(handlers).map(async (handler) => {
      try {
        const result = await handler(message);
        recordMessageHandled(topic, true);
        return result;
      } catch (err) {
        console.error(`[MessageBus] Error in handler for topic "${topic}":`, err);
        recordMessageHandled(topic, false);
        return null;
      }
    });

    const settled = await Promise.allSettled(tasks);
    return settled.map((entry) => entry.status === 'fulfilled' ? entry.value : null);
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

function createMessageBus(options = {}) {
  const nodeEnv = options.NODE_ENV || process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const requireExternal = options.requireExternal ?? isProd;
  const allowMemoryFallback = options.allowMemoryFallback ?? !requireExternal;
  const defaultType = process.env.MESSAGE_BUS_TYPE
    || (process.env.REDIS_URL ? 'redis' : 'memory');
  const type = (options.type || defaultType || 'memory').toLowerCase();

  if (type === 'redis') {
    if (!RedisMessageBus.isSupported()) {
      const message = '[MessageBus] MESSAGE_BUS_TYPE=redis requested but ioredis is not installed';
      if (requireExternal) {
        throw new Error(`${message}; install ioredis and configure REDIS_URL for production deployments.`);
      }
      if (!allowMemoryFallback) {
        throw new Error(`${message}; memory fallback disabled.`);
      }
      console.warn(`${message}; falling back to in-memory bus`);
    } else {
      try {
        return new RedisMessageBus(options);
      } catch (err) {
        if (requireExternal || !allowMemoryFallback) {
          throw err;
        }
        console.error('[MessageBus] Failed to initialize Redis bus, falling back to in-memory:', err);
      }
    }
  } else if (requireExternal) {
    throw new Error('[MessageBus] MESSAGE_BUS_TYPE must be set to "redis" in production to enable distributed messaging.');
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

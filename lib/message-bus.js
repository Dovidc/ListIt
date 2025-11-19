/**
 * Message Bus Abstraction
 *
 * Provides a unified interface for pub/sub communication between services.
 * Supports in-memory transport and Redis-backed pub/sub for multi-process deployments.
 */

const EventEmitter = require('events');
const { RedisMessageBus } = require('./redis-message-bus');

class MessageBus extends EventEmitter {
  constructor(name = 'default', options = {}) {
    super();
    this.name = name;
    this.namespace = (options.namespace || '').trim();
    this.subscribers = new Map();
  }

  _topicWithNamespace(topic) {
    if (!this.namespace) return topic;
    return `${this.namespace}:${topic}`;
  }

  /**
   * Subscribe to a topic
   * @param {string} topic - Topic name
   * @param {Function} handler - Message handler
   * @returns {Function} Unsubscribe function
   */
  subscribe(topic, handler) {
    const key = this._topicWithNamespace(topic);
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key).add(handler);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(key).delete(handler);
      if (this.subscribers.get(key).size === 0) {
        this.subscribers.delete(key);
      }
    };
  }

  /**
   * Publish a message to a topic
   * @param {string} topic - Topic name
   * @param {any} message - Message to publish
   */
  async publish(topic, message) {
    const handlers = this.subscribers.get(this._topicWithNamespace(topic));
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
    const handlers = this.subscribers.get(this._topicWithNamespace(topic));
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
    return this.subscribers.get(this._topicWithNamespace(topic))?.size || 0;
  }

  /**
   * Get all topics with subscribers
   */
  getTopics() {
    return Array.from(this.subscribers.keys()).map((key) => {
      if (!this.namespace) return key;
      return key.startsWith(`${this.namespace}:`) ? key.slice(this.namespace.length + 1) : key;
    });
  }

  /**
   * Clear all subscribers for a topic or all topics
   */
  clear(topic = null) {
    if (topic) {
      this.subscribers.delete(this._topicWithNamespace(topic));
    } else {
      this.subscribers.clear();
    }
  }
}

function createMessageBus(options = {}) {
  const namespace = options.namespace || process.env.MESSAGE_BUS_NAMESPACE || '';
  const type = (options.type
    || process.env.MESSAGE_BUS_TYPE
    || (process.env.REDIS_URL ? 'redis' : 'memory')
    || 'memory').toLowerCase();
  if (type === 'redis') {
    if (!RedisMessageBus.isSupported()) {
      console.warn('[MessageBus] MESSAGE_BUS_TYPE=redis requested but ioredis is not installed; falling back to in-memory bus');
    } else {
      try {
        return new RedisMessageBus({
          ...options,
          namespace,
          redisUrl: options.redisUrl || process.env.REDIS_URL
        });
      } catch (err) {
        console.error('[MessageBus] Failed to initialize Redis bus, falling back to in-memory:', err);
      }
    }
  }
  return new MessageBus(options.name || 'memory-bus', { namespace });
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

const { EventEmitter } = require('events');
let Redis = null;
try {
  Redis = require('ioredis');
} catch (err) {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[bus] ioredis not available, falling back to in-memory pub/sub');
  }
}

class InMemoryBus {
  constructor() {
    this.emitter = new EventEmitter();
  }

  publish(event, payload) {
    queueMicrotask(() => this.emitter.emit(event, payload));
  }

  subscribe(event, handler) {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }
}

class RedisBus {
  constructor(url) {
    this.emitter = new EventEmitter();
    this.url = url;
    this.channels = new Set();
    this.processId = `${process.pid}-${Math.random().toString(36).slice(2)}`;

    const redisOptions = { lazyConnect: true, maxRetriesPerRequest: 3 };
    this.pub = new Redis(url, redisOptions);
    this.sub = new Redis(url, redisOptions);

    this.sub.on('message', (channel, message) => {
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.meta && parsed.meta.origin === this.processId) {
          // Ignore events that originated from this process; we already emit locally
          return;
        }
        this.emitter.emit(channel, parsed.payload);
      } catch (err) {
        console.warn('[bus] Failed to parse payload:', err?.message || err);
      }
    });

    this.connected = Promise.allSettled([
      this.pub.connect(),
      this.sub.connect()
    ]).then((results) => {
      const rejected = results.find(result => result.status === 'rejected');
      if (rejected) {
        throw rejected.reason;
      }
      if (process.env.NODE_ENV !== 'test') {
        console.log('[bus] Redis pub/sub connected');
      }
    }).catch((err) => {
      console.warn('[bus] Redis connection failed, reverting to in-memory bus:', err?.message || err);
      this.dispose();
      this.fallback = new InMemoryBus();
    });
  }

  dispose() {
    if (this.pub) {
      this.pub.disconnect();
    }
    if (this.sub) {
      this.sub.disconnect();
    }
  }

  publish(event, payload) {
    if (this.fallback) {
      this.fallback.publish(event, payload);
      return;
    }

    this.emitter.emit(event, payload);
    const envelope = JSON.stringify({ payload, meta: { origin: this.processId } });
    this.pub.publish(event, envelope).catch((err) => {
      console.warn('[bus] Failed to publish event', event, err?.message || err);
    });
  }

  subscribe(event, handler) {
    if (this.fallback) {
      return this.fallback.subscribe(event, handler);
    }

    this.emitter.on(event, handler);
    if (!this.channels.has(event)) {
      this.channels.add(event);
      this.sub.subscribe(event).catch((err) => {
        console.warn('[bus] Failed to subscribe to', event, err?.message || err);
      });
    }

    return () => this.emitter.off(event, handler);
  }
}

function createBus() {
  const url = process.env.MESSAGE_BUS_URL || process.env.REDIS_URL || null;
  if (url && Redis) {
    try {
      return new RedisBus(url);
    } catch (err) {
      console.warn('[bus] Unable to initialize Redis bus, falling back to memory:', err?.message || err);
    }
  }
  return new InMemoryBus();
}

module.exports = createBus();

const crypto = require('crypto');
const { getRedisClient } = require('./redis-client');

function makeId() {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

class InMemoryQueue {
  constructor(options = {}) {
    this.queue = [];
    this.prefix = options.prefix || 'jobs';
  }

  async enqueue(job) {
    const id = job.id || makeId();
    const record = { ...job, id };
    this.queue.push(record);
    // Highest priority first; otherwise FIFO by createdAt
    this.queue.sort((a, b) => {
      const prioDiff = (b.priority || 0) - (a.priority || 0);
      if (prioDiff !== 0) return prioDiff;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    return id;
  }

  async dequeue() {
    return this.queue.shift() || null;
  }

  async requeue(job) {
    return this.enqueue(job);
  }

  async size() {
    return this.queue.length;
  }

  async shutdown() {
    this.queue = [];
  }
}

class RedisQueue {
  constructor(options = {}) {
    this.prefix = options.prefix || 'jobs';
    this.redis = options.redis || getRedisClient();
    if (!this.redis) {
      throw new Error('RedisQueue requires Redis');
    }
    this.key = `${this.prefix}:zset`;
  }

  _score(job) {
    const priority = Number(job.priority || 0);
    const createdAt = Number(job.createdAt || Date.now());
    // Higher priority wins (more negative), then earlier createdAt
    return -(priority * 1_000_000) + createdAt / 1_000_000;
  }

  async enqueue(job) {
    const id = job.id || makeId();
    const record = {
      ...job,
      id,
      createdAt: job.createdAt || Date.now()
    };
    const payload = JSON.stringify(record);
    await this.redis.zadd(this.key, this._score(record), payload);
    return id;
  }

  async dequeue() {
    const popped = await this.redis.zpopmin(this.key, 1);
    if (!Array.isArray(popped) || popped.length === 0) return null;
    const [raw] = popped;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async requeue(job) {
    return this.enqueue(job);
  }

  async size() {
    return this.redis.zcard(this.key);
  }

  async shutdown() {
    // no-op: reuse shared Redis client
  }
}

function createWorkerQueue(options = {}) {
  if (options.force === 'memory') {
    return new InMemoryQueue(options);
  }
  const redis = getRedisClient();
  if (redis) {
    try {
      return new RedisQueue({ ...options, redis });
    } catch (err) {
      console.warn('[worker-queue] Failed to initialize Redis queue, using in-memory:', err?.message || err);
    }
  }
  return new InMemoryQueue(options);
}

module.exports = {
  createWorkerQueue,
  InMemoryQueue,
  RedisQueue
};

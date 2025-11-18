const crypto = require('crypto');
const EventEmitter = require('events');
const { getRedisClient } = require('./redis-client');

class InMemoryJobQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.queue = [];
    this.processing = new Set();
    this.visibilityTimeoutMs = options.visibilityTimeoutMs || 60000;
    this.maxRetries = options.maxRetries || 5;
    this.running = false;
  }

  async start() {
    this.running = true;
  }

  async stop() {
    this.running = false;
    this.emit('job');
  }

  async enqueue(job) {
    const payload = {
      id: job.id || crypto.randomUUID(),
      type: job.type,
      payload: job.payload,
      priority: job.priority || 0,
      createdAt: job.createdAt || Date.now(),
      attempts: job.attempts || 0,
      maxRetries: job.maxRetries || this.maxRetries
    };
    this.queue.push(payload);
    this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.emit('job');
    return payload.id;
  }

  async reserveNext() {
    while (this.running && this.queue.length === 0) {
      await new Promise((resolve) => {
        const notify = () => {
          this.off('job', notify);
          resolve();
        };
        this.on('job', notify);
      });
    }

    if (!this.running && this.queue.length === 0) {
      return null;
    }
    const job = this.queue.shift();
    if (!job) return null;
    this.processing.add(job.id);
    job.reservedAt = Date.now();
    return job;
  }

  async ack(job) {
    this.processing.delete(job.id);
  }

  async fail(job) {
    this.processing.delete(job.id);
    if ((job.attempts || 0) < (job.maxRetries || this.maxRetries)) {
      job.attempts = (job.attempts || 0) + 1;
      this.queue.push(job);
    }
  }

  async getStats() {
    return {
      pending: this.queue.length,
      processing: this.processing.size,
      delayed: 0
    };
  }
}

class RedisJobQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    const requireRedis = options.requireRedis ?? (process.env.NODE_ENV === 'production');
    this.redis = options.redis || getRedisClient({
      require: requireRedis,
      purpose: 'durable job queue'
    });
    if (!this.redis) {
      throw new Error('Redis is required for RedisJobQueue');
    }
    this.name = options.name || 'worker';
    this.visibilityTimeoutMs = options.visibilityTimeoutMs || 120000;
    this.maxRetries = options.maxRetries || 5;
    this.maxBackoffMs = options.maxBackoffMs || 300000;
    this.blockTimeoutSec = options.blockTimeoutSec || 5;
    this.pendingKey = `queue:${this.name}:pending`;
    this.processingKey = `queue:${this.name}:processing`;
    this.processingTimestampsKey = `queue:${this.name}:processing:timestamps`;
    this.jobsKey = `queue:${this.name}:jobs`;
    this.delayedKey = `queue:${this.name}:delayed`;
    this.deadLetterKey = `queue:${this.name}:dead`;
    this.running = false;
    this.promoteInterval = null;
  }

  _pendingScore(job) {
    const priority = Number(job?.priority || 0);
    const createdAt = Number(job?.createdAt || Date.now());
    const base = Math.max(priority, 0) * 1e12;
    return base - createdAt;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.promoteInterval = setInterval(() => {
      this._reclaimExpired().catch((err) => {
        console.error('[queue] Failed to reclaim expired jobs:', err);
      });
      this._promoteDelayed().catch((err) => {
        console.error('[queue] Failed to promote delayed jobs:', err);
      });
    }, Math.min(this.visibilityTimeoutMs / 2, 15000));
    if (typeof this.promoteInterval.unref === 'function') {
      this.promoteInterval.unref();
    }
  }

  async stop() {
    this.running = false;
    if (this.promoteInterval) {
      clearInterval(this.promoteInterval);
      this.promoteInterval = null;
    }
  }

  async enqueue(job) {
    const payload = {
      id: job.id || crypto.randomUUID(),
      type: job.type,
      payload: job.payload,
      priority: job.priority || 0,
      createdAt: job.createdAt || Date.now(),
      attempts: job.attempts || 0,
      maxRetries: job.maxRetries || this.maxRetries
    };
    const serialized = JSON.stringify(payload);
    await this.redis.multi()
      .hset(this.jobsKey, payload.id, serialized)
      .zadd(this.pendingKey, this._pendingScore(payload), payload.id)
      .exec();
    return payload.id;
  }

  async reserveNext() {
    await this._promoteDelayed();
    await this._reclaimExpired();
    const result = await this.redis.bzpopmax(this.pendingKey, this.blockTimeoutSec);
    if (!result) return null;
    const [, jobId] = result;
    const raw = await this.redis.hget(this.jobsKey, jobId);
    if (!raw) {
      await this._cleanupProcessing(jobId);
      return null;
    }
    const job = JSON.parse(raw);
    await this.redis.multi()
      .lpush(this.processingKey, job.id)
      .zadd(this.processingTimestampsKey, Date.now() + this.visibilityTimeoutMs, job.id)
      .exec();
    return job;
  }

  async ack(job) {
    await this.redis.multi()
      .lrem(this.processingKey, 0, job.id)
      .zrem(this.processingTimestampsKey, job.id)
      .hdel(this.jobsKey, job.id)
      .exec();
  }

  async fail(job, error) {
    job.attempts = (job.attempts || 0) + 1;
    job.lastError = error?.message || error;
    const pipeline = this.redis.multi();
    pipeline.lrem(this.processingKey, 0, job.id);
    pipeline.zrem(this.processingTimestampsKey, job.id);
    if (job.attempts > (job.maxRetries || this.maxRetries)) {
      pipeline.hdel(this.jobsKey, job.id);
      pipeline.hset(this.deadLetterKey, job.id, JSON.stringify(job));
    } else {
      const delayMs = Math.min(this.maxBackoffMs, Math.pow(2, job.attempts) * 1000);
      pipeline.hset(this.jobsKey, job.id, JSON.stringify(job));
      pipeline.zadd(this.delayedKey, Date.now() + delayMs, job.id);
    }
    await pipeline.exec();
  }

  async _cleanupProcessing(jobId) {
    await this.redis.multi()
      .lrem(this.processingKey, 0, jobId)
      .zrem(this.processingTimestampsKey, jobId)
      .exec();
  }

  async _promoteDelayed() {
    const now = Date.now();
    const ids = await this.redis.zrangebyscore(this.delayedKey, 0, now, 'LIMIT', 0, 50);
    if (!ids.length) return;
    const jobs = await this.redis.hmget(this.jobsKey, ...ids);
    const pipeline = this.redis.multi();
    ids.forEach((id, idx) => {
      pipeline.zrem(this.delayedKey, id);
      const raw = jobs[idx];
      if (raw) {
        const job = JSON.parse(raw);
        pipeline.zadd(this.pendingKey, this._pendingScore(job), id);
      } else {
        pipeline.hdel(this.jobsKey, id);
      }
    });
    await pipeline.exec();
  }

  async _reclaimExpired() {
    const now = Date.now();
    const expired = await this.redis.zrangebyscore(this.processingTimestampsKey, 0, now, 'LIMIT', 0, 50);
    if (!expired.length) return;
    const jobs = await this.redis.hmget(this.jobsKey, ...expired);
    const pipeline = this.redis.multi();
    expired.forEach((id, idx) => {
      pipeline.zrem(this.processingTimestampsKey, id);
      pipeline.lrem(this.processingKey, 0, id);
      const raw = jobs[idx];
      if (raw) {
        const job = JSON.parse(raw);
        pipeline.zadd(this.pendingKey, this._pendingScore(job), id);
      } else {
        pipeline.hdel(this.jobsKey, id);
      }
    });
    await pipeline.exec();
  }

  async getStats() {
    const pipeline = this.redis.multi();
    pipeline.zcard(this.pendingKey);
    pipeline.llen(this.processingKey);
    pipeline.zcard(this.delayedKey);
    const [[, pending], [, processing], [, delayed]] = await pipeline.exec();
    return {
      pending: Number(pending) || 0,
      processing: Number(processing) || 0,
      delayed: Number(delayed) || 0
    };
  }
}

function createJobQueue(options = {}) {
  try {
    return new RedisJobQueue(options);
  } catch (err) {
    if (options.requireRedis || process.env.NODE_ENV === 'production') {
      throw err;
    }
    console.warn('[queue] Falling back to in-memory job queue:', err?.message || err);
    return new InMemoryJobQueue(options);
  }
}

module.exports = {
  createJobQueue,
  RedisJobQueue,
  InMemoryJobQueue
};

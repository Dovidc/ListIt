const crypto = require('crypto');
const EventEmitter = require('events');
const { getRedisClient } = require('./redis-client');

const DEFAULT_BACKOFF_MS = 1000;
const DEFAULT_MAX_RETRIES = 3;
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

function makeId() {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

class InMemoryQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.queue = [];
    this.active = 0;
    this.prefix = options.prefix || 'jobs';
    this.maxRetries = Number(options.maxRetries || DEFAULT_MAX_RETRIES);
    this.retryDelayMs = Number(options.retryDelayMs || DEFAULT_BACKOFF_MS);
    this.processor = null;
    this.concurrency = Number(options.concurrency || 1);
    this.idempotencyKeys = new Set();
  }

  async enqueue(job) {
    const id = job.id || makeId();
    if (job.idempotencyKey && this.idempotencyKeys.has(job.idempotencyKey)) {
      return id;
    }

    const record = {
      ...job,
      id,
      createdAt: job.createdAt || Date.now(),
      retries: Number(job.retries || 0),
      maxRetries: Number(job.maxRetries ?? this.maxRetries)
    };

    if (record.idempotencyKey) {
      this.idempotencyKeys.add(record.idempotencyKey);
    }

    this.queue.push(record);
    this.queue.sort((a, b) => {
      const prioDiff = (b.priority || 0) - (a.priority || 0);
      if (prioDiff !== 0) return prioDiff;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    this._drain();
    return id;
  }

  process(handler, options = {}) {
    this.processor = handler;
    this.concurrency = Number(options.concurrency || this.concurrency || 1);
    this._drain();
  }

  async _drain() {
    if (!this.processor) return;
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      this.active += 1;
      this._run(job);
    }
  }

  async _run(job) {
    const startedAt = Date.now();
    const timeoutMs = Number(job.timeoutMs || 0);
    let timer;

    const timeoutPromise = timeoutMs > 0
      ? new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`job_timeout:${job.type}`)), timeoutMs);
        if (typeof timer?.unref === 'function') timer.unref();
      })
      : null;

    const runner = timeoutPromise
      ? Promise.race([this.processor(job), timeoutPromise])
      : this.processor(job);

    runner
      .then(() => {
        this.emit('completed', { jobId: job.id, duration: Date.now() - startedAt, name: job.type });
      })
      .catch(async (err) => {
        const attemptsLeft = job.retries < job.maxRetries;
        this.emit('failed', { jobId: job.id, err, name: job.type, attemptsMade: job.retries + 1 });
        if (attemptsLeft) {
          const retryJob = { ...job, retries: job.retries + 1, createdAt: Date.now() };
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
          this.enqueue(retryJob);
        }
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        this.active -= 1;
        this._drain();
      });
  }

  async size() {
    return this.queue.length + this.active;
  }

  async shutdown() {
    this.queue = [];
    this.processor = null;
    this.idempotencyKeys.clear();
  }
}

class RedisDurableQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.prefix = options.prefix || 'jobs';
    this.redis = options.redis || getRedisClient();
    if (!this.redis) {
      throw new Error('RedisDurableQueue requires Redis');
    }
    this.queueKey = `${this.prefix}:queue`;
    this.processingKey = `${this.prefix}:processing`;
    this.idempotencyKey = `${this.prefix}:idempotency`;
    this.concurrency = Number(options.concurrency || 1);
    this.maxRetries = Number(options.maxRetries || DEFAULT_MAX_RETRIES);
    this.retryDelayMs = Number(options.retryDelayMs || DEFAULT_BACKOFF_MS);
    this.running = false;
    this.processor = null;
    this.active = 0;
  }

  async enqueue(job) {
    const id = job.id || makeId();
    const record = {
      ...job,
      id,
      createdAt: job.createdAt || Date.now(),
      retries: Number(job.retries || 0),
      maxRetries: Number(job.maxRetries ?? this.maxRetries)
    };

    if (record.idempotencyKey) {
      const added = await this.redis.sadd(this.idempotencyKey, record.idempotencyKey);
      if (!added) {
        return id;
      }
      await this.redis.expire(this.idempotencyKey, IDEMPOTENCY_TTL_SECONDS);
    }

    await this.redis.lpush(this.queueKey, JSON.stringify(record));
    this._drain();
    return id;
  }

  process(handler, options = {}) {
    this.processor = handler;
    this.concurrency = Number(options.concurrency || this.concurrency || 1);
    if (this.running) return;
    this.running = true;
    this._drain();
  }

  async _drain() {
    if (!this.processor || !this.running) return;
    while (this.active < this.concurrency) {
      const raw = await this.redis.brpoplpush(this.queueKey, this.processingKey, 1);
      if (!raw) break;
      let job;
      try {
        job = JSON.parse(raw);
      } catch {
        await this.redis.lrem(this.processingKey, 1, raw);
        continue;
      }
      this.active += 1;
      this._run(job, raw);
    }
  }

  async _run(job, rawPayload) {
    const startedAt = Date.now();
    const timeoutMs = Number(job.timeoutMs || 0);
    let timer;

    const timeoutPromise = timeoutMs > 0
      ? new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`job_timeout:${job.type}`)), timeoutMs);
        if (typeof timer?.unref === 'function') timer.unref();
      })
      : null;

    const runner = timeoutPromise
      ? Promise.race([this.processor(job), timeoutPromise])
      : this.processor(job);

    runner
      .then(() => {
        this.emit('completed', { jobId: job.id, duration: Date.now() - startedAt, name: job.type });
        this.redis.lrem(this.processingKey, 1, rawPayload).catch(() => {});
      })
      .catch(async (err) => {
        const attemptsLeft = job.retries < job.maxRetries;
        this.emit('failed', { jobId: job.id, err, name: job.type, attemptsMade: job.retries + 1 });
        await this.redis.lrem(this.processingKey, 1, rawPayload).catch(() => {});
        if (attemptsLeft) {
          const retryJob = { ...job, retries: job.retries + 1, createdAt: Date.now() };
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
          await this.redis.lpush(this.queueKey, JSON.stringify(retryJob));
        }
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        this.active -= 1;
        if (this.running) {
          this._drain();
        }
      });
  }

  async size() {
    const [[, pending], [, processing]] = await this.redis.multi()
      .llen(this.queueKey)
      .llen(this.processingKey)
      .exec();
    return Number(pending || 0) + Number(processing || 0);
  }

  async shutdown() {
    this.running = false;
    this.processor = null;
  }
}

function createWorkerQueue(options = {}) {
  if (options.force === 'memory') {
    return new InMemoryQueue(options);
  }
  const redis = getRedisClient();
  if (redis) {
    try {
      return new RedisDurableQueue({ ...options, redis });
    } catch (err) {
      console.warn('[worker-queue] Failed to initialize Redis queue, using in-memory:', err?.message || err);
    }
  }
  return new InMemoryQueue(options);
}

module.exports = {
  createWorkerQueue,
  InMemoryQueue,
  RedisDurableQueue
};

class MetricsRegistry {
  constructor() {
    this.http = {
      requests: 0,
      errors: 0,
      durationsMs: []
    };

    this.messageBus = {
      published: 0,
      handled: 0,
      topics: new Map()
    };

    this.worker = {
      enqueued: 0,
      processed: 0,
      failed: 0,
      queueDepth: 0
    };
  }

  recordHttpRequest(durationMs = 0, statusCode = 200) {
    this.http.requests += 1;
    if (statusCode >= 500) {
      this.http.errors += 1;
    }

    const value = Math.max(0, Number(durationMs) || 0);
    this.http.durationsMs.push(value);
    if (this.http.durationsMs.length > 200) {
      this.http.durationsMs.shift();
    }
  }

  recordMessagePublished(topic) {
    this.messageBus.published += 1;
    this._incrementTopic(topic, 'published');
  }

  recordMessageHandled(topic) {
    this.messageBus.handled += 1;
    this._incrementTopic(topic, 'handled');
  }

  _incrementTopic(topic, field) {
    const key = topic || 'unknown';
    if (!this.messageBus.topics.has(key)) {
      this.messageBus.topics.set(key, { published: 0, handled: 0 });
    }
    const entry = this.messageBus.topics.get(key);
    entry[field] = (entry[field] || 0) + 1;
  }

  recordWorkerEnqueued() {
    this.worker.enqueued += 1;
  }

  recordWorkerProcessed(success = true) {
    if (success) {
      this.worker.processed += 1;
    } else {
      this.worker.failed += 1;
    }
  }

  setWorkerQueueDepth(depth) {
    const numericDepth = Number.isFinite(depth) ? depth : 0;
    this.worker.queueDepth = Math.max(0, numericDepth);
  }

  snapshot() {
    const durations = this.http.durationsMs.length ? [...this.http.durationsMs] : [];
    const avgDuration = durations.length
      ? Math.round(durations.reduce((sum, val) => sum + val, 0) / durations.length)
      : null;

    const topics = {};
    for (const [topic, counts] of this.messageBus.topics.entries()) {
      topics[topic] = { ...counts };
    }

    return {
      http: {
        ...this.http,
        averageDurationMs: avgDuration
      },
      messageBus: {
        published: this.messageBus.published,
        handled: this.messageBus.handled,
        topics
      },
      worker: { ...this.worker }
    };
  }
}

const metrics = new MetricsRegistry();

module.exports = { metrics };

const MAX_HTTP_LATENCIES = 200;
const metricsState = {
  http: {
    totalRequests: 0,
    errorResponses: 0,
    durationsMs: [],
    inFlight: 0
  },
  messageBus: {
    published: 0,
    handled: 0,
    handlerFailures: 0,
    topics: {}
  },
  worker: {
    queueDepth: 0,
    enqueued: 0,
    processed: 0,
    failed: 0
  }
};

function recordHttpRequest({ method, path, statusCode, durationMs }) {
  metricsState.http.totalRequests += 1;
  if (statusCode >= 500) {
    metricsState.http.errorResponses += 1;
  }
  if (Number.isFinite(durationMs)) {
    metricsState.http.durationsMs.push(durationMs);
    if (metricsState.http.durationsMs.length > MAX_HTTP_LATENCIES) {
      metricsState.http.durationsMs.shift();
    }
  }
  if (metricsState.http.inFlight > 0) {
    metricsState.http.inFlight -= 1;
  }
  const routeKey = `${method || 'UNKNOWN'} ${path || '/unknown'}`;
  const routeTotals = metricsState.http.routes || (metricsState.http.routes = {});
  if (!routeTotals[routeKey]) {
    routeTotals[routeKey] = { count: 0, errors: 0 };
  }
  routeTotals[routeKey].count += 1;
  if (statusCode >= 500) {
    routeTotals[routeKey].errors += 1;
  }
}

function beginHttpRequest() {
  metricsState.http.inFlight += 1;
}

function recordMessagePublished(topic) {
  metricsState.messageBus.published += 1;
  const topicTotals = metricsState.messageBus.topics;
  if (!topicTotals[topic]) {
    topicTotals[topic] = { published: 0, handled: 0, failures: 0 };
  }
  topicTotals[topic].published += 1;
}

function recordMessageHandled(topic, success = true) {
  metricsState.messageBus.handled += 1;
  const topicTotals = metricsState.messageBus.topics;
  if (!topicTotals[topic]) {
    topicTotals[topic] = { published: 0, handled: 0, failures: 0 };
  }
  topicTotals[topic].handled += 1;
  if (!success) {
    metricsState.messageBus.handlerFailures += 1;
    topicTotals[topic].failures += 1;
  }
}

function recordWorkerEnqueued() {
  metricsState.worker.enqueued += 1;
}

function recordWorkerProcessed(success = true) {
  metricsState.worker.processed += 1;
  if (!success) {
    metricsState.worker.failed += 1;
  }
}

function updateWorkerQueueDepth(depth) {
  if (Number.isFinite(depth)) {
    metricsState.worker.queueDepth = depth;
  }
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(ratio * sorted.length));
  return sorted[idx];
}

function getMetricsSnapshot() {
  const httpDurations = metricsState.http.durationsMs;
  return {
    http: {
      totalRequests: metricsState.http.totalRequests,
      errorResponses: metricsState.http.errorResponses,
      inFlight: metricsState.http.inFlight,
      p95LatencyMs: percentile(httpDurations, 0.95),
      averageLatencyMs: httpDurations.length
        ? Math.round(httpDurations.reduce((a, b) => a + b, 0) / httpDurations.length)
        : null,
      routes: metricsState.http.routes || {}
    },
    messageBus: {
      published: metricsState.messageBus.published,
      handled: metricsState.messageBus.handled,
      handlerFailures: metricsState.messageBus.handlerFailures,
      topics: metricsState.messageBus.topics
    },
    worker: { ...metricsState.worker }
  };
}

module.exports = {
  beginHttpRequest,
  recordHttpRequest,
  recordMessagePublished,
  recordMessageHandled,
  recordWorkerEnqueued,
  recordWorkerProcessed,
  updateWorkerQueueDepth,
  getMetricsSnapshot
};

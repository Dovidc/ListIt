# Metrics and Health Snapshots

The application now exposes lightweight metrics alongside the health endpoints to help operators understand runtime behavior without attaching a dedicated APM.

## Where to view metrics

- `GET /api/health/deps` — returns dependency health plus a `metrics` snapshot.
- `GET /api/health/readiness` — same as `/api/health/deps` but also checks external providers; includes the same `metrics` block.

Both routes return HTTP 200 when all checks pass and 503 otherwise. The metrics payload is always included to aid debugging even when health checks fail.

## What the metrics mean

The `metrics` field reports three groups:

- **HTTP**
  - `requests`: total requests served since process start.
  - `errors`: count of responses with status codes `>= 500`.
  - `durationsMs`: rolling sample of the most recent request durations (up to 200 entries).
  - `averageDurationMs`: mean of the sampled durations to spot latency spikes.
- **Message bus**
  - `published` / `handled`: total messages published and consumed.
  - `topics`: per-topic published/handled counts to see which channels are active or lagging.
- **Worker queue**
  - `enqueued`: jobs pushed onto the worker queue.
  - `processed`: jobs completed successfully.
  - `failed`: jobs that failed processing.
  - `queueDepth`: current in-memory queue depth reported by the worker.

## How the metrics are populated

- An Express middleware records request durations and 5xx responses.
- The message bus wrapper records publishes and message handling per topic.
- The worker service tracks enqueue/processing outcomes and updates queue depth as jobs are dequeued.

These counters reset when the process restarts. For long-term storage or alerting, ship them to your monitoring system of choice.

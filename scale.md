# Scalability and Reliability Improvement Plan

This document summarizes the key issues identified in the current ListIt architecture and the concrete changes required to make the platform scalable, reliable, and easier to operate.

## 1. Decompose the monolith
- Split responsibilities currently concentrated in `server.js` into separate services:
  - **HTTP API service** for REST/GraphQL endpoints.
  - **Real-time/WebSocket service** for chat/presence.
  - **Background worker service** for slow third-party calls (emails, push, Stripe post-processing).
- Introduce a shared message bus (Redis pub/sub, Kafka, NATS, or AWS SNS/SQS) so that WebSocket broadcasts and background work can be distributed across multiple instances.
- Run each service in its own process/container so crashes or GC pauses in one do not impact the others.
- **Why:** Clear service boundaries let each tier scale independently (e.g., add API pods without affecting chat) and narrow the blast radius of failures. Observability and deploy cadence also improve because each service has a smaller surface area.
- **If skipped:** A single-process Node server keeps all traffic coupled; any memory leak, blocking migration, or long GC pause will still freeze HTTP, WebSocket, and background work simultaneously, limiting throughput and uptime as traffic grows.

## 2. Adopt managed database migrations
- Extract all schema creation and backfill logic out of `server.js`.
- Use a migration tool (Prisma Migrate, Knex, dbmate, or similar) that runs during CI/CD or deployment rather than at runtime.
- Ensure migrations are idempotent and coordinated so that multiple application instances do not attempt the same DDL concurrently.
- Remove `initializeSchema` from application boot to reduce startup latency and avoid race conditions.
- **How:** Knex migrations now live in `/migrations`; run `npm run migrate:latest` locally before `npm start`, and add the same command to Render’s deploy hook so schema changes execute before new pods boot.
- **Why:** Dedicated migration tooling validates schema changes in advance, provides rollback paths, and keeps boot time predictable so new instances can join the fleet quickly during scaling events.
- **If skipped:** Each new replica would continue to run blocking DDL on startup, creating deployment races, potential table corruption, and multi-minute cold starts that prevent auto-scaling from reacting to traffic spikes.

## 3. Externalize shared state and caching
- Move password-reset tokens, email verification tokens, nearby-search caches, and rate-limit counters out of in-memory maps.
- Introduce Redis (or another low-latency data store) for:
  - Token issuance/validation shared across all API nodes.
  - Global rate limiting and throttling.
  - Shared caches for geospatial search results or other expensive lookups.
- Add TTLs and invalidation strategies so that caches remain fresh even across deploys.
- **Why:** A distributed cache or key-value store lets any API instance validate tokens, enforce rate limits, and reuse expensive query results, providing consistent behavior regardless of which node handles the request.
- **If skipped:** In-memory state will diverge between nodes, so users could receive a password-reset email from one instance and be unable to redeem it on another, while caches reset on each deploy and rate limits are easily bypassed.

### Step 3 implementation progress
- Added Redis-backed cache helpers (`lib/shared-cache.js`) and wired the nearby listings and reverse-geocode responses to use them, with per-key TTLs and a fallback LRU implementation for local development.
- Created a Redis-powered Express rate-limit store (`lib/redis-rate-limit-store.js`) so login, write, upload, geocode, and user listing limits share counters across API replicas when `REDIS_URL` is configured.

## 4. Introduce background job queues
- For Stripe webhooks, push notifications, and emails:
  - Accept the event synchronously, enqueue a job, and acknowledge the request quickly.
  - Have worker processes dequeue jobs, call third-party APIs, and handle retries with exponential backoff.
- Store Stripe webhook idempotency keys in the database to prevent double-processing on retries.
- Emit structured logs/metrics for job successes, retries, and failures to gain visibility into operational health.
- **Why:** Queues decouple user-facing latency from unpredictable third-party APIs, add durable retries, and create a natural scaling control (add workers for throughput).
- **If skipped:** Slow Stripe or SendGrid responses will continue to block request threads, leading to timeouts, duplicate webhooks on retries, and invisible data loss when external services are degraded.

## 5. Harden WebSocket and notification delivery
- Persist WebSocket sessions/presence information in a shared service so users can connect to any node.
- Use the shared message bus so any API node can publish events to the correct WebSocket session.
- Implement reconnection logic, heartbeats, and delivery acknowledgments so that transient failures trigger retries instead of silent drops.
- Decouple push notifications from the request cycle by routing them through the background worker/queue system.
- **Why:** Centralizing presence data and delivery tracking keeps real-time features reliable even when pods restart or when traffic is balanced across regions.
- **If skipped:** Horizontal scaling will still require sticky sessions, and any node restart will disconnect all of its clients, causing missed chat messages and dropped push notifications with no recovery path.

## 6. Improve operational safeguards
- Enforce TLS validation for Postgres connections (`rejectUnauthorized: true` in production) and manage certificates properly.
- Add health probes for Postgres, Redis, S3, SendGrid, and any other external dependencies so orchestration platforms can restart unhealthy pods.
- Centralize configuration management (12-factor `.env` handling) to keep secrets and environment differences under control.
- Add structured logging and metrics (p95 latency, queue depth, DB usage) to detect regressions before they impact users.
- **Why:** Strong guardrails ensure infrastructure failures are detected quickly and data stays encrypted in transit, while metrics provide early warning on saturation.
- **If skipped:** Silent TLS misconfiguration leaves data-in-transit exposed, outages may go unnoticed until customers report them, and debugging production issues will remain slow because there is no telemetry.

Impleme

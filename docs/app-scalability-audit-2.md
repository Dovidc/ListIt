# ListIt Scalability & Efficiency Audit — Follow-up

_Date: 2024-07-01_

## Executive Summary
- Redis-backed infrastructure is now the production default: the message bus, shared cache, OTP store, WebSocket presence ledger, and worker queue all require Redis outside of development/test, ensuring horizontal pods share the same state.
- Background processing moved onto a durable Redis queue with delayed retries and health metrics, and the WebSocket service now writes connection metadata to Redis so real-time fan-out survives restarts and can be observed independently of any API instance.
- The PostgreSQL pool enforces TLS verification (or custom CA bundles) and exposes queue-depth telemetry so autoscaling and runbooks can react before saturation.

## Remediation Summary
1. **Message bus defaults to Redis with health checks.** `createMessageBus` now promotes Redis in production, fails fast when unavailable, and surfaces node IDs plus health data so ops can detect split-brain scenarios.
2. **Durable worker queue.** A Redis-backed job queue (`lib/redis-job-queue.js`) provides visibility timeouts, delayed retries, and dead-letter storage. WorkerService now consumes jobs continuously instead of relying on in-memory arrays.
3. **Shared real-time presence.** The WebSocket service persists session metadata in Redis via `lib/presence-store.js`, publishes node IDs, and exposes presence counts in its health check.
4. **Secure database pool.** `db-wrapper.js` enforces `PGSSLMODE=require` (or CA bundles), allows pool sizing via env vars, and exports wait-time metrics so saturation is measurable.
5. **OTP and cache hardening.** OTPs and SMS verification codes now live in Redis with TTLs and hashed payloads, and the shared cache no longer falls back silently in production while emitting hit/miss stats.
6. **Docs kept current.** This audit now documents the shipped mitigations so future readers understand which risks remain versus which have been addressed.

## Progress Since the Last Audit
- **Redis plumbing now exists but remains optional.** The codebase ships Redis-backed implementations for the message bus, shared cache, and rate-limit store (`lib/redis-message-bus.js`, `lib/shared-cache.js`, and `lib/redis-rate-limit-store.js`). However, `lib/message-bus.js` and the cache helper still default to memory when `MESSAGE_BUS_TYPE`/`REDIS_URL` are unset, so production behavior is unchanged unless ops explicitly configure Redis.【F:lib/message-bus.js†L100-L124】【F:lib/shared-cache.js†L1-L109】
- **Service orchestration was extracted.** `server-orchestrated.js` can boot the API, worker, and WebSocket services separately, making it easier to run multi-process locally, but the default entrypoint (`server.js`) continues to co-locate everything behind one process, and the orchestrator itself still falls back to in-process wiring when the message bus is set to memory.【F:server-orchestrated.js†L1-L115】
- **Schema migrations moved to Knex.** The migrations directory (`/migrations/20241117_init_schema.js`) decouples schema changes from runtime bootstrapping, reducing deploy-time blocking DDL, though observability and roll-forward checks are not yet automated.【F:migrations/20241117_init_schema.js†L1-L215】

## Detailed Findings

### 1. Message bus was process-bound (now remediated)
**What changed.** `createMessageBus` now defaults to Redis whenever `NODE_ENV=production`, throws when Redis cannot be instantiated, and both the in-memory and Redis implementations expose `healthCheck()` so orchestrated services can wire liveness probes. Service config refuses to boot without `REDIS_URL` in production.【F:lib/message-bus.js†L1-L142】【F:lib/redis-message-bus.js†L1-L138】【F:lib/service-config.js†L1-L128】

**Impact.** Multi-pod deployments now get shared pub/sub semantics by default, and operators receive explicit failures when Redis is misconfigured instead of silent in-memory fallbacks.

**Follow-on.** Managed queues (NATS/SQS) remain future considerations once throughput requirements exceed Redis pub/sub.

### 2. Background queue is durable
**What changed.** The worker now depends on `lib/redis-job-queue`, which stores jobs, retries, and dead-letter entries inside Redis. `WorkerService` runs a continuous consumer loop, tracks per-job metrics, and exposes queue depth/processing counts via `healthCheck()`. Tests continue to use the in-memory fallback, but production fails fast without Redis.【F:lib/redis-job-queue.js†L1-L210】【F:services/worker-service.js†L1-L420】

**Impact.** Stripe webhooks, OTP emails, push notifications, and geofence jobs survive restarts, can be processed by multiple worker replicas, and are no longer tied to a `setInterval` poller.

### 3. Real-time presence and fan-out share Redis
**What changed.** `services/websocket-service.js` now assigns every connection a `sessionId`, persists metadata via `lib/presence-store.js`, and reports presence counts in its health check. Heartbeats update Redis so instances can detect stale sessions, and shutdown removes subscriptions plus presence entries cleanly.【F:services/websocket-service.js†L1-L250】【F:lib/presence-store.js†L1-L168】

**Impact.** Users can reconnect to any pod without losing OTP or presence data, and ops can inspect who is online (by user and by session) independent of any API instance.

### 4. Database pool enforces TLS and metrics
**What changed.** `db-wrapper.js` now enforces TLS in production, supports CA bundles, exposes pool sizing via `PG_POOL_*` env vars, and instruments wait times (including a `waitP95` metric) so saturation can be graphed. Transactions and helpers all run through the measured query helper.【F:db-wrapper.js†L1-L168】

**Impact.** Production builds fail if TLS is disabled, operators can tune connection counts for their Postgres tier, and telemetry reveals when the pool is starved.

### 5. OTP/SMS verification state lives in Redis
**What changed.** `sms-service.js` now uses `lib/otp-store.js`, which writes hashed OTP payloads with TTLs to Redis (and only exposes plaintext in tests). OTP state survives deployments, and Redis makes brute-force attempts visible via shared counters.【F:sms-service.js†L1-L35】【F:lib/otp-store.js†L1-L111】

**Impact.** Codes are consistent across pods, flushed automatically, and never stored in plaintext outside of tests.

### 6. Cache layer requires shared Redis
**What changed.** `createSharedCache` refuses to fall back in production, uses stable prefixes, and emits hit/miss metrics so app code can log cache efficacy. Dev/test still use the in-memory LRU, but production pods must provide Redis.【F:lib/shared-cache.js†L1-L153】

**Impact.** Geospatial caches and rate-limit helpers now share state across pods, while metrics reveal hot keys and effectiveness.

## Next Steps
1. **Codify shared infrastructure**: Move Redis provisioning, queue sizing, and CA material into Terraform/Helm so production parity is guaranteed across regions.
2. **Add SLIs/dashboards**: Publish the new bus/queue/cache/pool metrics to Grafana so on-call engineers can alert on queue depth, wait P95, and presence anomalies.
3. **Load/perf test the new topology**: Validate fan-out throughput and DB pool behavior under concurrent deployments to confirm the new limits.
4. **Update architecture/runbooks**: Reflect the Redis requirements, TLS settings, and worker lifecycle in `ARCHITECTURE.md` plus operational SOPs for future audits.

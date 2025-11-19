# ListIt Scalability Audit

_Last updated: 2025-11-18Z_

## Executive summary
- **Service boundaries remain largely monolithic.** `server.js` still wires together HTTP routing, migrations, push/email integrations, and even the fallback message bus inside one process, so any GC pause or blocking call impacts every interface simultaneously.【F:server.js†L1-L159】
- **Distributed deployment is only partially realized.** The orchestrated entry point still boots the entire monolith and defaults to an in-memory message bus, which prevents you from scaling API, WebSocket, and worker tiers independently in production.【F:server-orchestrated.js†L16-L144】【F:lib/message-bus.js†L110-L191】
- **Critical shared state is process-local.** Password reset tokens, verification codes, caches, rate-limit counters, and worker jobs are all backed by in-memory structures that disappear whenever a pod restarts, making horizontal scaling unsafe.【F:mail-service.js†L24-L191】【F:lib/shared-cache.js†L1-L111】【F:lib/redis-rate-limit-store.js†L1-L79】【F:services/worker-service.js†L25-L194】
- **Operational guardrails need hardening.** Database TLS is disabled, migrations still require application code, and there are no automated health probes or metrics, all of which were previously flagged in `scale.md` but not yet enforced in code.【F:db-wrapper.js†L4-L151】【F:scale.md†L5-L61】

## Methodology
I reviewed the runtime entry points (`server.js`, `server-orchestrated.js`), shared infrastructure modules (`lib/service-config.js`, `lib/message-bus.js`, `lib/shared-cache.js`, `lib/redis-rate-limit-store.js`), operational documentation (`scale.md`), and worker/mail subsystems (`services/worker-service.js`, `mail-service.js`). The audit focused on fault isolation, state management, elasticity, and operational readiness because these are the gating factors for sustained load.

## Detailed findings & recommendations

### 1. Service decomposition and coupling
**Observation.** The legacy `server.js` still owns Express initialization, schema migration, auth, Stripe/OpenAI integrations, email/push helpers, and a fallback message bus in one process. Even when the orchestrator is used, it simply requires this monolith, so the API, WebSocket, and worker services cannot boot without the full server context.【F:server.js†L1-L159】【F:server-orchestrated.js†L16-L100】

**Risk.** Vertical coupling makes it impossible to scale API traffic without simultaneously over-provisioning chat and workers. A crash in any subsystem takes down every interface and negates the benefits outlined in the decomposition plan in `scale.md`.【F:scale.md†L5-L13】

**Recommendation.** Continue extracting discrete services so that `createAPIService`, `createWebSocketService`, and `createWorkerService` bootstrap themselves without importing `server.js`. Move shared utilities (env loading, DB access, auth middleware) into versioned packages consumed by each service, and build Docker-compose profiles that start each service independently. This will unlock per-tier autoscaling and reduce blast radius.

### 2. Message bus & cross-service communication
**Observation.** `createMessageBus` defaults to an in-memory EventEmitter and only switches to Redis if `MESSAGE_BUS_TYPE=redis` and the optional dependency is available; otherwise every publish/subscribe stays process-local.【F:lib/message-bus.js†L110-L191】 The orchestrator therefore runs all services inside a single Node process whenever Redis is missing, defeating distributed deployment.【F:server-orchestrated.js†L60-L100】

**Risk.** Without an external bus, horizontal scale requires sticky sessions or state sharing hacks, and worker/WebSocket notifications cannot flow between pods. Failures in one process still cascade across services because they cohabitate.

**Recommendation.** Promote Redis to a required dependency for any non-dev environment, add connection health probes, and ensure the orchestrator refuses to start multi-service mode unless a remote bus is reachable. Consider abstracting the bus API into its own package so HTTP and WebSocket services can be deployed separately without the orchestrator.

### 3. Database posture & migrations
**Observation.** `db-wrapper.js` sets `rejectUnauthorized: false` on every PostgreSQL connection, hardcodes pool sizes, and throws immediately if `DATABASE_URL` is unset, but nothing enforces migrations before boot.【F:db-wrapper.js†L4-L151】 The scaling plan already calls for removing runtime DDL from the server and adopting managed migrations, yet the runtime still performs these duties.【F:scale.md†L15-L23】

**Risk.** Disabling TLS verification exposes credentials in transit, and per-process migration logic prevents fast autoscaling because every replica repeats the same schema work. Fixed pool sizing can exhaust database connections when multiple pods spin up.

**Recommendation.** Honor environment-provided SSL modes (rejectUnauthorized true in production), move pool sizing into config, and require `npm run migrate:latest` (or equivalent) as a deployment gate. Surface database connectivity in `/api/health` via the orchestrator’s health checks so orchestrators can kill unhealthy pods.

### 4. Shared state, caching, and rate limiting
**Observation.** Password reset tokens and verification codes are tracked with ephemeral `Map` stores inside `mail-service.js`, so only the process that issued a token can validate it.【F:mail-service.js†L24-L191】 Likewise, `createSharedCache` and the Redis rate-limit store gracefully fall back to local memory when Redis is absent, which reintroduces per-process caches and counters during the very scenario (multi-pod scale-out) that requires shared state most.【F:lib/shared-cache.js†L1-L111】【F:lib/redis-rate-limit-store.js†L1-L79】

**Risk.** Horizontal scaling causes inconsistent auth flows, cache stampedes, and ineffective abuse protections, because each replica has its own view of recent activity. Deployments or crashes silently invalidate every token and cache entry.

**Recommendation.** Make Redis (or another distributed KV) mandatory for security-critical state. For development, keep the in-memory LRU but log loudly when it is used outside `NODE_ENV=development`. Persist password reset/verification tokens in PostgreSQL or Redis with explicit TTLs, and emit metrics on cache hit rates and rate-limit saturation.

### 5. Background processing and worker durability
**Observation.** The worker service implements its job queue as an in-memory array plus a `setInterval` loop; jobs vanish on restart, and there is no concurrency control beyond a single process.【F:services/worker-service.js†L25-L194】 Stripe webhooks, push notifications, and password resets therefore depend on the liveness of one Node process.

**Risk.** Under load, long-running jobs back up the queue and block new events because there is no external persistence, visibility, or scaling strategy. Any crash loses queued work.

**Recommendation.** Replace the ad-hoc queue with a durable system (BullMQ on Redis, RabbitMQ, SQS, etc.). Persist job metadata (status, attempts, next retry) so multiple worker pods can compete for work. Add idempotency keys for Stripe events and structured logging for observability.

### 6. Operational guardrails & observability
**Observation.** Although `lib/service-config.js` centralizes env handling, it only validates `DATABASE_URL` and `JWT_SECRET`, leaving Redis, Stripe, and SendGrid unchecked. There are no automated health endpoints beyond the orchestrator’s in-process checks, and the scaling plan’s recommendations for TLS enforcement, health probes, and metrics remain unimplemented.【F:lib/service-config.js†L11-L187】【F:scale.md†L55-L61】

**Risk.** Missing or misconfigured dependencies are only noticed during runtime errors, slowing incident response. Lack of health probes prevents orchestration platforms from detecting partial outages, and absent metrics hide saturation signals until users complain.

**Recommendation.** Expand configuration validation to cover Redis, Stripe, SendGrid, and S3 in production. Add readiness/liveness endpoints that verify DB, Redis, and external APIs. Instrument request latency, message-bus throughput, and worker queue depth, and export them via Prometheus or StatsD.

## Prioritized roadmap
1. **Enforce distributed primitives**: Require Redis and an external message bus in production so API/WebSocket/worker tiers can be split immediately.【F:lib/message-bus.js†L110-L191】
2. **Complete service extraction**: Refactor `server.js` into modular packages consumed by standalone API, WebSocket, and worker services to honor the decomposition plan.【F:server.js†L1-L159】【F:scale.md†L5-L13】
3. **Harden the data layer**: Adopt managed migrations, parameterize pool sizing, and enforce TLS on database connections.【F:db-wrapper.js†L4-L151】【F:scale.md†L15-L23】
4. **Externalize critical state**: Persist tokens, rate limits, and caches in Redis/PostgreSQL with TTLs so user flows survive scaling events.【F:mail-service.js†L24-L191】【F:lib/shared-cache.js†L1-L111】【F:lib/redis-rate-limit-store.js†L1-L79】
5. **Adopt a durable job queue**: Move worker jobs to a persistent queue and add idempotency + metrics for webhook/push workloads.【F:services/worker-service.js†L25-L194】
6. **Add observability guardrails**: Implement health probes, dependency checks, and metrics per the open items in `scale.md`.【F:scale.md†L55-L61】

Delivering these steps (in order) will unblock safe horizontal scaling, unlock independent deployments per service, and provide the operational visibility needed to sustain future growth.

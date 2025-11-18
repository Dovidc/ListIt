# ListIt Service Architecture

## Overview

ListIt is transitioning from a monolithic architecture to a decomposed, scalable microservices architecture. This document describes the new service structure and how to use it.

## Current State

The original `server.js` (9,347 lines) contains all functionality:
- REST API endpoints
- WebSocket server for real-time chat
- Background job processing
- Database initialization
- Authentication and authorization

## Target Architecture

Three independent services that communicate via a message bus:

```
┌─────────────────────────────────────────────────────────────┐
│                    Message Bus (Redis/Memory)               │
│ (Pub/Sub for async communication between services)          │
└─────────────────────────────────────────────────────────────┘
              ↑                       ↑                    ↑
              │                       │                    │
      ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
      │   API Service    │   │ WebSocket Service│   │ Worker Service   │
      │ (HTTP, REST)     │   │ (Real-time)      │   │ (Background Jobs)│
      │                  │   │                  │   │                  │
      │ Ports:           │   │ Ports:           │   │ (No listening)   │
      │ - 3000 (default) │   │ - 3002           │   │                  │
      │ - 3001 (separate)│   │                  │   │ Processes:       │
      │                  │   │ Connections:     │   │ - Stripe         │
      │ Handlers:        │   │ - User sessions  │   │ - Emails         │
      │ - /api/*         │   │ - Chat relay     │   │ - Push notifs    │
      │ - Auth           │   │ - Presence       │   │ - Retries        │
      │ - Listings       │   │                  │   │                  │
      │ - Payments       │   │ Features:        │   │ Features:        │
      │ - Users          │   │ - Heartbeat      │   │ - Job queuing    │
      │ - Push (via API) │   │ - Reconnection   │   │ - Exponential    │
      │                  │   │ - Acknowledgment │   │   backoff        │
      └──────────────────┘   └──────────────────┘   └──────────────────┘
         ↑                          ↑                       ↑
         │                          │                       │
         └──────────────────────────┼───────────────────────┘
                                    │
                           ┌────────────────┐
                           │   Database     │
                           │  (PostgreSQL)  │
                           └────────────────┘
```

## Service Details

### 1. API Service (`services/api-service.js`)

**Purpose:** Handle HTTP REST requests

**Responsibilities:**
- User authentication and sessions
- Listing CRUD operations
- Search and discovery
- Payment initiation (webhook events queued for worker)
- User profiles and settings
- Message history retrieval
- Admin endpoints

**Ports:**
- Single process: 3000 (default)
- Separate process: 3001

**Key Features:**
- Stateless (can run multiple instances behind load balancer)
- Delegates long operations to worker service via message bus
- Uses message bus to trigger WebSocket notifications
- Can inject WebSocket service reference for real-time features

**Environment Variables:**
```bash
PORT=3000                # Default port
API_PORT=3001           # If running separately
```

### 2. WebSocket Service (`services/websocket-service.js`)

**Purpose:** Handle real-time communication

**Responsibilities:**
- Accept WebSocket connections from clients
- Verify JWT tokens
- Relay chat messages to recipients
- Broadcast notifications
- Maintain user session/presence information
- Heartbeat detection of stale connections

**Ports:**
- Single process: shares HTTP server
- Separate process: 3002

**Key Features:**
- Maintains in-memory session mapping (userId → WebSocket connections)
- Heartbeat every 30 seconds
- Automatic cleanup of dead connections
- Receives events from worker service via message bus
- Broadcasts notifications to connected users

**Message Types Handled:**
- `ping/pong` - Heartbeat
- `message` - Chat messages
- `notification` - Real-time notifications from workers

**Environment Variables:**
```bash
WEBSOCKET_PORT=3002     # If running separately
ENABLE_WEBSOCKET=true   # Enable/disable service
```

### 3. Worker Service (`services/worker-service.js`)

**Purpose:** Process background jobs

**Responsibilities:**
- Queue incoming Stripe webhooks
- Process payments and subscriptions
- Send transactional emails
- Deliver push notifications
- Retry failed jobs with exponential backoff
- Monitor job health

**Port:** None (event-driven, no HTTP listening)

**Key Features:**
- In-memory job queue (can be upgraded to Redis/Kafka)
- Automatic retry with max 3 attempts (configurable)
- Job prioritization
- Subscription to message bus events
- Publishes results back to message bus

**Job Types:**
- `send_email` - Transactional emails
- `send_push` - Push notifications
- `process_stripe_event` - Stripe webhook processing

**Subscribed Topics:**
- `stripe.webhook` - From API when Stripe webhook received
- `user.registered` - Send verification email
- `user.verified` - Send welcome email
- `push.send` - Send push notification

**Environment Variables:**
```bash
ENABLE_WORKER=true      # Enable/disable service
STRIPE_SECRET_KEY=...   # Stripe API key
SENDGRID_API_KEY=...    # Email service
```

## Message Bus

### Implementation (`lib/message-bus.js`)

**In-Memory Implementation (Default):**
- Fast, requires no external dependencies
- Suitable for single-process deployments
- Subscribers stored as Set in memory
- Perfect for development and testing

**Topics (Constants in `message-bus.js`):**
```javascript
USER_REGISTERED
USER_VERIFIED
USER_LOGGED_IN/OUT
LISTING_CREATED/UPDATED/DELETED
LISTING_MARKED_SOLD
MESSAGE_SENT
CONVERSATION_CREATED/DELETED
STRIPE_WEBHOOK
PAYMENT_SUCCESS/FAILED
SUPPORTER_STATUS_CHANGED
PUSH_SUBSCRIBE/UNSUBSCRIBE/SEND
ADMIN_ACTION
ADMIN_FLAGGED_REPORT
NEARBY_LISTING_AVAILABLE
HEALTH_CHECK
SERVICE_READY
```

### API

```javascript
const { MessageBus, createMessage, TOPICS } = require('./lib/message-bus');

const bus = new MessageBus();

// Subscribe to events
const unsubscribe = bus.subscribe(TOPICS.USER_REGISTERED, async (event) => {
  // Handle event
});

// Publish events
await bus.publish(TOPICS.USER_REGISTERED, {
  userId: 123,
  email: 'user@example.com'
});

// Publish and wait for responses
const results = await bus.publishAwait(TOPICS.HEALTH_CHECK);
```

## Service Configuration (`lib/service-config.js`)

### Environment Variables

```bash
# Core
NODE_ENV=development|production|test
PORT=3000
JWT_SECRET=your-secret-key
DATABASE_URL=postgresql://...

# Services
ENABLE_HTTP_API=true
ENABLE_WEBSOCKET=true
ENABLE_WORKER=true

# Service-specific ports (separate processes)
API_PORT=3001
WEBSOCKET_PORT=3002
WORKER_PORT=3003

# Message Bus
MESSAGE_BUS_TYPE=memory|redis   # default: memory (dev/test), redis (production)
REDIS_URL=redis://localhost:6379 # required whenever MESSAGE_BUS_TYPE=redis

# External Services
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
SENDGRID_API_KEY=...
OPENAI_API_KEY=...
S3_BUCKET=...
```

## Deployment Modes

### 1. Single Process (Current Default)

All services run in one Node.js process:

```bash
# Uses default server.js or server-orchestrated.js
npm start

# Or explicitly:
node server.js
```

**Advantages:**
- Simple deployment
- No inter-process communication overhead
- Easy debugging
- Perfect for small deployments

**Disadvantages:**
- Memory leak in one service affects all
- CPU spike in one service blocks others
- Can't scale services independently

**Configuration:**
```bash
MESSAGE_BUS_TYPE=memory  # development-only fallback
ENABLE_HTTP_API=true
ENABLE_WEBSOCKET=true
ENABLE_WORKER=true
```

### 2. Distributed (Recommended for Scale)

Each service runs in its own container:

```bash
# Terminal 1: API Service
API_PORT=3001 NODE_ENV=production npm start -- api-only

# Terminal 2: WebSocket Service
WEBSOCKET_PORT=3002 NODE_ENV=production npm start -- websocket-only

# Terminal 3: Worker Service
NODE_ENV=production npm start -- worker-only

# All services use shared Redis for message bus
REDIS_URL=redis://shared-redis:6379
MESSAGE_BUS_TYPE=redis
```

**Advantages:**
- Independent scaling per service
- Isolated failures
- Can deploy each service separately
- Better resource utilization

**Disadvantages:**
- Requires Redis
- More infrastructure complexity
- Debugging is harder
- Network latency between services

### 3. Hybrid (Most Common)

API + WebSocket in one process, Worker in separate:

```bash
# Main process (API + WebSocket)
npm start

# Worker process
npm start -- worker-only
```

**Advantages:**
- Good balance of simplicity and scalability
- Worker can handle long jobs without blocking
- Easy single-instance deployment
- Separate process can auto-restart if it crashes

## Migration Path

### Phase 1 (Current)
- Create service abstractions
- Single-process orchestration
- In-memory message bus
- No changes to existing `server.js`

### Phase 2 (Next)
- Extract WebSocket to separate process
- Integrate Redis message bus
- Multi-process deployment guide

### Phase 3 (Later)
- Extract API to separate service
- Kubernetes deployment manifests
- Docker Compose for development

### Phase 4 (Future)
- Full microservices with auto-scaling
- Service mesh (Istio)
- Advanced monitoring and tracing

## Usage Examples

### Run with Orchestrator (Single Process)

```bash
node server-orchestrated.js
```

Endpoints:
- `/api/health/orchestrated` - Full orchestrator health
- `/api/services/status` - Service status details
- `/api/health` - Legacy health check

### Custom Startup Script

```javascript
const { ServiceOrchestrator } = require('./lib/service-orchestrator');
const { createAPIService } = require('./services/api-service');
const { createWebSocketService } = require('./services/websocket-service');

async function start() {
  const config = getServiceConfig();
  const orchestrator = new ServiceOrchestrator(config);

  const api = await createAPIService(app, config, orchestrator.getMessageBus());
  const ws = await createWebSocketService(config, orchestrator.getMessageBus());

  orchestrator.registerService('api', api);
  orchestrator.registerService('websocket', ws, ['api']);

  await orchestrator.startAll();
}
```

## Performance Implications

### Single Process Mode
- **Memory:** +5-10MB for orchestration overhead
- **CPU:** Negligible (<0.1%)
- **Latency:** <1ms inter-service communication

### Distributed Mode (with Redis)
- **Memory:** +20-50MB per process
- **CPU:** Depends on Redis performance
- **Latency:** 1-5ms for message bus (network dependent)

## Future Enhancements

1. **Redis Message Bus** (`lib/redis-message-bus.js`)
   - Replace in-memory implementation
   - Enable true distributed deployment
   - Persistent event log

2. **Database Migrations**
   - Extract `initializeSchema` to migration tool
   - Remove startup DDL operations
   - Enable faster service startup

3. **Health Checks**
   - Database connectivity
   - Redis availability
   - External service status (Stripe, SendGrid)
   - Message queue depth

4. **Monitoring**
   - Service metrics (request count, latency)
   - Job queue metrics
   - WebSocket connection stats
   - Database connection pool stats

5. **Distributed Tracing**
   - OpenTelemetry integration
   - Request ID propagation
   - Cross-service call tracing

## Troubleshooting

### Services not communicating
- Check `MESSAGE_BUS_TYPE` configuration
- Verify all services instantiated message bus
- Check logs for subscription errors

### WebSocket connections failing
- Verify JWT_SECRET is same across services
- Check WEBSOCKET_PORT is not in use
- Enable debug logging: `DEBUG=websocket:*`

### Worker jobs not processing
- Check worker service started
- Verify job subscribers registered
- Check job queue depth: `GET /api/services/status`

### Memory leaks in single process
- Check for unmanaged timers
- Verify message bus subscribers cleaned up
- Use `NODE_OPTIONS=--max-old-space-size=4096`

## References

- Message Bus: `lib/message-bus.js`
- Service Config: `lib/service-config.js`
- Service Orchestrator: `lib/service-orchestrator.js`
- Orchestrated Entry Point: `server-orchestrated.js`
- Service Implementations: `services/`

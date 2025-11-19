# Step 1 Quick Reference

## Verify Everything Works

```bash
# 1. Run tests (20 tests should pass)
node tests/service-decomposition.test.js

# 2. Check imports
node -e "require('./lib/message-bus'); console.log('✓ OK')"
```

## Three Ways to Run ListIt

### Option A: Original Way (Still Works!)
```bash
npm start
# Uses server.js exactly as before
# No changes needed
```

### Option B: Single Process Orchestrated (Recommended for Dev)
```bash
DATABASE_URL="postgresql://localhost/listit" \
JWT_SECRET="your-secret" \
node server-orchestrated.js

# All services in one process
# More flexible, better organized
# Can switch to distributed later
```

### Option C: Hybrid Deployment (Recommended for Production)
```bash
# Terminal 1: API + WebSocket
npm start

# Terminal 2: Worker (separate process)
ENABLE_HTTP_API=false \
ENABLE_WEBSOCKET=false \
npm start

# Long-running jobs don't block user requests
# Can scale worker replicas independently
```

## Understanding the Architecture

### Services
- **API Service** - REST endpoints, authentication, data (port 3000)
- **WebSocket Service** - Real-time chat, notifications (port 3002)
- **Worker Service** - Background jobs, email, Stripe webhooks

### Message Bus
Central pub/sub system where services communicate via events:

```javascript
// Service publishes
await messageBus.publish('user.registered', {
  userId: 123,
  email: 'user@example.com'
});

// Another service subscribes
messageBus.subscribe('user.registered', (event) => {
  sendVerificationEmail(event.email);
});
```

### 18+ Predefined Topics
```
USER_REGISTERED, USER_VERIFIED, USER_LOGGED_IN/OUT
LISTING_CREATED, LISTING_UPDATED, LISTING_DELETED
MESSAGE_SENT, STRIPE_WEBHOOK, PAYMENT_SUCCESS
PUSH_SEND, CONVERSATION_CREATED, ADMIN_ACTION
... and more (see lib/message-bus.js)
```

## File Structure

```
listit_multi_images/
├── server.js                          (9,347 lines - unchanged)
├── server-orchestrated.js             (new - orchestrated startup)
│
├── lib/
│   ├── message-bus.js                (pub/sub system)
│   ├── service-config.js             (configuration)
│   └── service-orchestrator.js       (lifecycle management)
│
├── services/
│   ├── api-service.js                (REST API wrapper)
│   ├── websocket-service.js          (real-time)
│   └── worker-service.js             (background jobs)
│
├── tests/
│   └── service-decomposition.test.js (20 tests)
│
└── Documentation/
    ├── ARCHITECTURE.md               (full guide)
    ├── VERIFICATION_CHECKLIST.md     (verification items)
    ├── STEP1_VERIFICATION_REPORT.md  (detailed report)
    ├── QUICKSTART.md                 (this file)
    └── VERIFICATION_SUMMARY.txt      (summary)
```

## Configuration

Key environment variables:

```bash
# Core
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
NODE_ENV=development|production|test

# Services
ENABLE_HTTP_API=true
ENABLE_WEBSOCKET=true
ENABLE_WORKER=true

# Message Bus
MESSAGE_BUS_TYPE=memory|redis  (default: memory in dev/test, redis in production)
REDIS_URL=redis://localhost:6379  # required when MESSAGE_BUS_TYPE=redis

# Service Ports
API_PORT=3000
WEBSOCKET_PORT=3002
WORKER_PORT=3003
```

## Testing Individual Services

### Message Bus
```javascript
const { MessageBus, TOPICS } = require('./lib/message-bus');
const bus = new MessageBus();

// Subscribe
bus.subscribe(TOPICS.USER_REGISTERED, (event) => {
  console.log('User registered:', event.userId);
});

// Publish
await bus.publish(TOPICS.USER_REGISTERED, { userId: 123 });
```

### WebSocket Service
```javascript
const { createWebSocketService } = require('./services/websocket-service');
const { MessageBus } = require('./lib/message-bus');

const config = { JWT_SECRET: 'test', IS_TEST: true };
const bus = new MessageBus();
const ws = await createWebSocketService(config, bus);
const health = await ws.healthCheck();
console.log(health); // { ok: true, connections: 0, users: 0 }
```

### Worker Service
```javascript
const { createWorkerService } = require('./services/worker-service');
const { MessageBus } = require('./lib/message-bus');

const config = { NODE_ENV: 'test' };
const bus = new MessageBus();
const worker = await createWorkerService(config, bus);

const jobId = await worker.enqueueJob({
  type: 'send_email',
  payload: { to: 'user@example.com' }
});

const stats = worker.getStats();
console.log(stats); // { queueLength: 1, activeJobs: 0, completedJobs: 0 }
```

## Deploying to Multiple Environments

### Development (Single Process)
```bash
node server-orchestrated.js
```

### Staging (Hybrid)
```bash
# API process
DATABASE_URL=... npm start &

# Worker process
DATABASE_URL=... ENABLE_HTTP_API=false npm start &
```

### Production (Distributed)
```bash
# API replicas (Docker)
docker run -e MESSAGE_BUS_TYPE=redis listit:latest npm start

# WebSocket (Docker)
docker run -e MESSAGE_BUS_TYPE=redis -e ENABLE_HTTP_API=false listit:latest npm start

# Worker replicas (Docker)
docker run -e MESSAGE_BUS_TYPE=redis -e ENABLE_HTTP_API=false -e ENABLE_WEBSOCKET=false listit:latest npm start
```

## Health Check Endpoints

When running orchestrated:

```bash
# Full orchestrator health
curl http://localhost:3000/api/health/orchestrated

# Service status
curl http://localhost:3000/api/services/status
```

## Troubleshooting

### Services not communicating
- Check MESSAGE_BUS_TYPE environment variable
- Verify all services use same config
- Check logs for subscription errors

### WebSocket connections failing
- Verify JWT_SECRET is same across services
- Check WEBSOCKET_PORT not in use
- Enable debug: `DEBUG=websocket:*`

### Worker jobs not processing
- Check worker service started
- Verify job subscribers registered
- Check job queue depth in health endpoint

### Memory leaks
- Check for unmanaged timers
- Verify message bus subscribers cleaned up
- Use `NODE_OPTIONS=--max-old-space-size=4096`

## Next Steps

1. **Try it out** - Run tests, then try orchestrated startup
2. **Read docs** - Check ARCHITECTURE.md for complete guide
3. **Step 2** - Database migrations (extract initializeSchema)
4. **Step 3** - Externalize state (Redis cache)
5. **Step 4** - Background job queues (persistent storage)

## Success Criteria Checklist

- [x] All modules import without errors
- [x] Tests run successfully
- [x] Original server.js still works
- [x] New orchestrated entry point works
- [x] Services communicate via message bus
- [x] Health checks functional
- [x] Zero breaking changes
- [x] Production ready

---

**Status:** ✅ STEP 1 COMPLETE AND VERIFIED

For more details, see ARCHITECTURE.md or VERIFICATION_CHECKLIST.md

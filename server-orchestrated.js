/**
 * ListIt - Orchestrated Service Architecture
 *
 * This entry point demonstrates how to run ListIt with decomposed services:
 * 1. HTTP API Service - REST endpoints
 * 2. WebSocket Service - Real-time chat and notifications
 * 3. Worker Service - Background jobs (emails, webhooks, etc.)
 *
 * All services communicate via a message bus.
 *
 * To use this instead of server.js, set in package.json:
 *   "main": "server-orchestrated.js"
 *   "start": "node server-orchestrated.js"
 */

// Load environment variables first
const { loadEnvironment } = require('./lib/service-config');
loadEnvironment();

const {
  getServiceConfig,
  validateConfig
} = require('./lib/service-config');

const { ServiceOrchestrator } = require('./lib/service-orchestrator');
const { MessageBus } = require('./lib/message-bus');

// Service imports
const { createAPIService } = require('./services/api-service');
const { createWebSocketService } = require('./services/websocket-service');
const { createWorkerService } = require('./services/worker-service');

// Validate critical environment before loading the heavy server module
const config = getServiceConfig();
if (!validateConfig(config)) {
  console.error('[Main] Configuration validation failed');
  process.exit(1);
}

// Load the existing Express app
let app;
try {
  app = require('./server');
} catch (err) {
  console.error('[Main] Failed to load Express app:', err.message);
  process.exit(1);
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Configuration already loaded and validated above

    console.log('[Main] Configuration loaded');
    console.log(`[Main] Node environment: ${config.NODE_ENV}`);
    console.log(`[Main] Services: API=${config.ENABLE_HTTP_API}, WebSocket=${config.ENABLE_WEBSOCKET}, Worker=${config.ENABLE_WORKER}`);

    // Create service orchestrator
    const orchestrator = new ServiceOrchestrator(config);
    const messageBus = orchestrator.getMessageBus();

    // Decide: single process vs distributed
    const runInSingleProcess = config.MESSAGE_BUS_TYPE === 'memory';
    console.log(`[Main] Running in ${runInSingleProcess ? 'single process' : 'distributed'} mode`);

    // Create and register services
    if (config.ENABLE_HTTP_API) {
      const apiService = await createAPIService(app, config, messageBus);
      orchestrator.registerService('api', apiService);
      console.log('[Main] API service registered');
    }

    if (config.ENABLE_WEBSOCKET) {
      const wsDependencies = runInSingleProcess ? ['api'] : [];
      const wsService = await createWebSocketService(config, messageBus);
      orchestrator.registerService('websocket', wsService, wsDependencies);
      console.log('[Main] WebSocket service registered');

      // Inject WebSocket into API for cross-service access when co-located
      if (runInSingleProcess && orchestrator.getService('api')) {
        orchestrator.getService('api').injectWebSocketService(wsService);
      }
    }

    if (config.ENABLE_WORKER) {
      const workerDeps = app._deps || {};
      const workerService = await createWorkerService(config, messageBus, {
        stripe: workerDeps.stripe,
        mailService: workerDeps.mailService,
        pushService: workerDeps.pushService
      });
      orchestrator.registerService('worker', workerService);
      console.log('[Main] Worker service registered');

      // Inject worker into API for cross-service access when co-located
      if (runInSingleProcess && orchestrator.getService('api')) {
        orchestrator.getService('api').injectWorkerService(workerService);
      }
    }

    // Start all services
    await orchestrator.startAll();

    // Setup health check endpoint
    app.get('/api/health/orchestrated', async (req, res) => {
      const health = await orchestrator.getHealth();
      res.status(health.ok ? 200 : 503).json(health);
    });

    // Setup service status endpoint
    app.get('/api/services/status', (req, res) => {
      const status = orchestrator.getServiceStatus();
      res.json(status);
    });

    console.log('[Main] All services are running');
    console.log('[Main] Ready to accept requests');

  } catch (err) {
    console.error('[Main] Fatal error:', err);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled rejection:', reason);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main();
}

module.exports = app;

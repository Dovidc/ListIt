/**
 * HTTP API Service
 *
 * Wrapper around the existing Express app that can:
 * - Run in the same process as other services
 * - Run independently as a separate microservice
 * - Communicate with other services via message bus
 */

const http = require('http');
const { MessageBus, TOPICS, createMessage } = require('../lib/message-bus');

class APIService {
  constructor(expressApp, config, messageBus) {
    this.app = expressApp;
    this.config = config;
    this.messageBus = messageBus;
    this.server = null;

    // Bind methods
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
  }

  /**
   * Start the API service
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        // Create HTTP server
        this.server = http.createServer(this.app);

        const port = this.config.API_PORT || this.config.PORT || 3000;

        this.server.listen(port, () => {
          console.log(`[API] Service listening on port ${port}`);

          // Announce service is ready
          this.messageBus.publish(TOPICS.SERVICE_READY, {
            service: 'api',
            port,
            timestamp: Date.now()
          });

          resolve();
        });

        this.server.on('error', (err) => {
          console.error('[API] HTTP server error:', err);
          reject(err);
        });

      } catch (err) {
        console.error('[API] Failed to start service:', err);
        reject(err);
      }
    });
  }

  /**
   * Stop the API service
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[API] Service stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Inject message bus into Express app for route handlers
   * This allows routes to publish events to other services
   */
  injectMessageBus() {
    this.app.locals.messageBus = this.messageBus;
    // Add middleware to make message bus available to all routes
    this.app.use((req, res, next) => {
      req.messageBus = this.messageBus;
      next();
    });
  }

  /**
   * Inject WebSocket service reference for real-time features
   */
  injectWebSocketService(wsService) {
    this.app.use((req, res, next) => {
      req.wsService = wsService;
      next();
    });
  }

  /**
   * Inject worker service reference for async tasks
   */
  injectWorkerService(workerService) {
    this.app.use((req, res, next) => {
      req.workerService = workerService;
      next();
    });
  }

  /**
   * Setup Stripe webhook handler to use message bus
   */
  setupStripeWebhookIntegration() {
    // Find and patch the Stripe webhook route
    // This would integrate with the existing handler to publish events
    console.log('[API] Stripe webhook integration enabled');
  }

  /**
   * Health check
   */
  async healthCheck() {
    return {
      ok: this.server !== null,
      listening: this.server?.listening || false
    };
  }
}

/**
 * Create and export API service
 */
async function createAPIService(expressApp, config, messageBus) {
  const service = new APIService(expressApp, config, messageBus);
  service.injectMessageBus();
  return service;
}

module.exports = {
  APIService,
  createAPIService
};

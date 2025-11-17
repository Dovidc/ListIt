/**
 * Service Orchestrator
 *
 * Manages the lifecycle of all services:
 * - Starts services in dependency order
 * - Handles shutdown gracefully
 * - Manages inter-service communication
 */

const { createMessageBus } = require('./message-bus');
const { setupGracefulShutdown } = require('./service-config');

class ServiceOrchestrator {
  constructor(config = {}, messageBus = createMessageBus({
    type: config?.MESSAGE_BUS_TYPE,
    redisUrl: config?.REDIS_URL,
    name: 'orchestrator'
  })) {
    this.config = config;
    this.messageBus = messageBus;
    this.services = new Map();
    this.startupOrder = [];
    this.servers = [];
  }

  /**
   * Register a service
   */
  registerService(name, service, dependencies = []) {
    this.services.set(name, {
      instance: service,
      dependencies,
      started: false
    });
  }

  /**
   * Get a service instance
   */
  getService(name) {
    const service = this.services.get(name);
    return service ? service.instance : null;
  }

  /**
   * Get message bus for inter-service communication
   */
  getMessageBus() {
    return this.messageBus;
  }

  /**
   * Build startup order based on dependencies
   */
  buildStartupOrder() {
    const order = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (name) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected: ${name}`);
      }

      visiting.add(name);
      const service = this.services.get(name);
      if (service) {
        service.dependencies.forEach(dep => visit(dep));
      }
      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const name of this.services.keys()) {
      visit(name);
    }

    this.startupOrder = order;
    return order;
  }

  /**
   * Start all services in order
   */
  async startAll() {
    console.log('[Orchestrator] Starting services...');

    const order = this.buildStartupOrder();
    console.log(`[Orchestrator] Startup order: ${order.join(' -> ')}`);

    for (const name of order) {
      const service = this.services.get(name);
      if (!service) continue;

      try {
        console.log(`[Orchestrator] Starting ${name}...`);

        if (typeof service.instance.start === 'function') {
          await service.instance.start();
        }

        service.started = true;

        // Track HTTP servers for shutdown
        if (service.instance.server) {
          this.servers.push(service.instance.server);
        }

        console.log(`[Orchestrator] ${name} started successfully`);
      } catch (err) {
        console.error(`[Orchestrator] Failed to start ${name}:`, err);
        // Attempt rollback
        await this.stopAll();
        throw err;
      }
    }

    console.log('[Orchestrator] All services started');

    // Setup graceful shutdown
    setupGracefulShutdown(this.servers);
  }

  /**
   * Stop all services in reverse order
   */
  async stopAll() {
    console.log('[Orchestrator] Stopping services...');

    const order = [...this.startupOrder].reverse();

    for (const name of order) {
      const service = this.services.get(name);
      if (!service || !service.started) continue;

      try {
        console.log(`[Orchestrator] Stopping ${name}...`);

        if (typeof service.instance.stop === 'function') {
          await service.instance.stop();
        }

        service.started = false;
        console.log(`[Orchestrator] ${name} stopped successfully`);
      } catch (err) {
        console.error(`[Orchestrator] Error stopping ${name}:`, err);
      }
    }

    console.log('[Orchestrator] All services stopped');
  }

  /**
   * Get health status of all services
   */
  async getHealth() {
    const health = {
      ok: true,
      timestamp: new Date().toISOString(),
      services: {}
    };

    for (const [name, service] of this.services) {
      try {
        if (typeof service.instance.healthCheck === 'function') {
          health.services[name] = await service.instance.healthCheck();
        } else {
          health.services[name] = { ok: service.started };
        }
      } catch (err) {
        health.services[name] = { ok: false, error: err.message };
        health.ok = false;
      }
    }

    return health;
  }

  /**
   * List all services and their status
   */
  getServiceStatus() {
    const status = {};
    for (const [name, service] of this.services) {
      status[name] = {
        started: service.started,
        dependencies: service.dependencies
      };
    }
    return status;
  }
}

module.exports = {
  ServiceOrchestrator
};

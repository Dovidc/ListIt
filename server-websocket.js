/**
 * Dedicated entry point for the WebSocket service.
 */

const { loadEnvironment } = require('./lib/service-config');
loadEnvironment();

const { createMessageBus } = require('./lib/message-bus');
const { createWebSocketService } = require('./services/websocket-service');

async function main() {
  const messageBus = createMessageBus({
    type: process.env.MESSAGE_BUS_TYPE,
    redisUrl: process.env.REDIS_URL,
    namespace: process.env.MESSAGE_BUS_NAMESPACE,
    name: 'websocket-service'
  });

  const wsService = await createWebSocketService({
    JWT_SECRET: process.env.JWT_SECRET || 'dev_jwt_change_me',
    WEBSOCKET_PORT: Number(process.env.WEBSOCKET_PORT || process.env.PORT || 3002),
    NODE_ENV: process.env.NODE_ENV || 'development',
    IS_TEST: process.env.NODE_ENV === 'test'
  }, messageBus);

  await wsService.start();

  const shutdown = async (signal = null) => {
    if (signal) {
      console.log(`\n[WebSocket] Received ${signal}, shutting down...`);
    }
    await wsService.stop();
    if (typeof messageBus.shutdown === 'function') {
      await messageBus.shutdown();
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[WebSocket] Failed to start:', err);
    process.exit(1);
  });
}

/**
 * Dedicated entry point for the background worker service.
 */

const { loadEnvironment } = require('./lib/service-config');
loadEnvironment();

const { createMessageBus } = require('./lib/message-bus');
const { createWorkerService } = require('./services/worker-service');
const mailService = require('./mail-service');
const pushService = require('./lib/push-service');

let Stripe = null;
try {
  Stripe = require('stripe');
} catch (err) {
  // Stripe is optional for local/dev environments
}

const stripe = (Stripe && process.env.STRIPE_SECRET_KEY)
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: process.env.STRIPE_API_VERSION || '2024-06-20'
  })
  : null;

async function main() {
  const messageBus = createMessageBus({
    type: process.env.MESSAGE_BUS_TYPE,
    redisUrl: process.env.REDIS_URL,
    namespace: process.env.MESSAGE_BUS_NAMESPACE,
    name: 'worker-service'
  });

  const worker = await createWorkerService(
    {
      NODE_ENV: process.env.NODE_ENV || 'development',
      IS_TEST: process.env.NODE_ENV === 'test'
    },
    messageBus,
    { stripe, mailService, pushService }
  );

  await worker.start();

  const shutdown = async (signal = null) => {
    if (signal) {
      console.log(`\n[Worker] Received ${signal}, shutting down...`);
    }
    await worker.stop();
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
    console.error('[Worker] Failed to start:', err);
    process.exit(1);
  });
}

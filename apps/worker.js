const { loadEnv } = require('../src/infrastructure/env');
loadEnv();

const eventBus = require('../src/infrastructure/event-bus');
const { EVENTS } = require('../src/infrastructure/events');
const pushService = require('../src/services/push-service');

console.log('[worker] starting background worker');
const stopMaintenance = pushService.startMaintenance();

function handleNewMessage(job) {
  if (!job || !job.recipientId || !job.payload) return;
  if (!pushService.isAvailable()) return;
  pushService.sendPushToUser(job.recipientId, job.payload).catch((err) => {
    console.warn('[worker] push delivery failed:', err?.message || err);
  });
}

function handleNearbyListing(job) {
  if (!job || !job.listing) return;
  if (!pushService.isAvailable()) return;
  pushService.notifyNearbyListing(job.listing).catch((err) => {
    console.warn('[worker] nearby push failed:', err?.message || err);
  });
}

eventBus.subscribe(EVENTS.PUSH_NEW_MESSAGE, handleNewMessage);
eventBus.subscribe(EVENTS.PUSH_NEARBY_LISTING, handleNearbyListing);

process.on('SIGINT', () => {
  console.log('\n[worker] shutting down');
  stopMaintenance();
  process.exit(0);
});

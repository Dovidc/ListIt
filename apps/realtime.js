const { loadEnv } = require('../src/infrastructure/env');
loadEnv();

const { startRealtimeServer } = require('../src/services/realtime-server');

startRealtimeServer();

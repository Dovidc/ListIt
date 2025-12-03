/**
 * Service Decomposition Tests
 *
 * Verify that Step 1 (Decompose the monolith) is correctly implemented
 */

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/listit_test';
process.env.DATABASE_SSL = process.env.DATABASE_SSL || 'false';

const assert = require('assert');
const { MessageBus, TOPICS, createMessage } = require('../lib/message-bus');
const { ServiceOrchestrator } = require('../lib/service-orchestrator');
const { getServiceConfig, validateConfig } = require('../lib/service-config');
const { createWebSocketService } = require('../services/websocket-service');
const { createWorkerService } = require('../services/worker-service');

// Test counter
let testCount = 0;
let passedCount = 0;
let failedTests = [];

function test(name, fn) {
  testCount++;
  try {
    fn();
    passedCount++;
    console.log(`✓ Test ${testCount}: ${name}`);
  } catch (err) {
    failedTests.push({ name, error: err.message });
    console.error(`✗ Test ${testCount}: ${name}`);
    console.error(`  Error: ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  testCount++;
  try {
    await fn();
    passedCount++;
    console.log(`✓ Test ${testCount}: ${name}`);
  } catch (err) {
    failedTests.push({ name, error: err.message });
    console.error(`✗ Test ${testCount}: ${name}`);
    console.error(`  Error: ${err.message}`);
  }
}

// ============================================================================
// 1. MESSAGE BUS TESTS
// ============================================================================

console.log('\n=== Message Bus Tests ===\n');

test('MessageBus should be instantiable', () => {
  const bus = new MessageBus('test');
  assert(bus !== null);
  assert(bus.name === 'test');
});

test('MessageBus.subscribe should register handlers', () => {
  const bus = new MessageBus();
  const handler = () => {};
  const unsubscribe = bus.subscribe('test.topic', handler);

  assert(bus.getSubscriberCount('test.topic') === 1);
  assert(typeof unsubscribe === 'function');
});

test('MessageBus.subscribe should allow multiple handlers per topic', () => {
  const bus = new MessageBus();
  bus.subscribe('test.topic', () => {});
  bus.subscribe('test.topic', () => {});
  bus.subscribe('test.topic', () => {});

  assert(bus.getSubscriberCount('test.topic') === 3);
});

asyncTest('MessageBus.publish should call all subscribers', async () => {
  const bus = new MessageBus();
  const calls = [];

  bus.subscribe('test.topic', (msg) => {
    calls.push(msg);
  });

  bus.subscribe('test.topic', (msg) => {
    calls.push(msg);
  });

  await bus.publish('test.topic', { data: 'test' });

  assert(calls.length === 2);
  assert(calls[0].data === 'test');
  assert(calls[1].data === 'test');
});

asyncTest('MessageBus.publishAwait should return results', async () => {
  const bus = new MessageBus();

  bus.subscribe('test.topic', async () => {
    return 'result1';
  });

  bus.subscribe('test.topic', async () => {
    return 'result2';
  });

  const results = await bus.publishAwait('test.topic', {});

  assert(results.length === 2);
  assert(results[0] === 'result1');
  assert(results[1] === 'result2');
});

test('MessageBus.unsubscribe should remove handler', () => {
  const bus = new MessageBus();
  const handler = () => {};

  const unsubscribe = bus.subscribe('test.topic', handler);
  assert(bus.getSubscriberCount('test.topic') === 1);

  unsubscribe();
  assert(bus.getSubscriberCount('test.topic') === 0);
});

test('MessageBus.getTopics should list all topics with subscribers', () => {
  const bus = new MessageBus();

  bus.subscribe('topic1', () => {});
  bus.subscribe('topic2', () => {});
  bus.subscribe('topic3', () => {});

  const topics = bus.getTopics();
  assert(topics.length === 3);
  assert(topics.includes('topic1'));
  assert(topics.includes('topic2'));
  assert(topics.includes('topic3'));
});

test('MessageBus.clear should remove all subscribers', () => {
  const bus = new MessageBus();

  bus.subscribe('topic1', () => {});
  bus.subscribe('topic2', () => {});

  bus.clear();

  assert(bus.getTopics().length === 0);
});

test('MessageBus.clear(topic) should remove specific topic', () => {
  const bus = new MessageBus();

  bus.subscribe('topic1', () => {});
  bus.subscribe('topic2', () => {});

  bus.clear('topic1');

  assert(bus.getSubscriberCount('topic1') === 0);
  assert(bus.getSubscriberCount('topic2') === 1);
});

test('createMessage should create proper message envelope', () => {
  const msg = createMessage('user.registered', { userId: 123, email: 'test@example.com' });

  assert(msg.type === 'user.registered');
  assert(msg.payload.userId === 123);
  assert(msg.payload.email === 'test@example.com');
  assert(msg.meta.timestamp !== undefined);
  assert(typeof msg.meta.timestamp === 'number');
});

test('TOPICS should define all major event types', () => {
  const requiredTopics = [
    'user.registered',
    'user.verified',
    'user.logged_in',
    'user.logged_out',
    'listing.created',
    'listing.updated',
    'listing.deleted',
    'message.sent',
    'stripe.webhook',
    'push.send'
  ];

  requiredTopics.forEach(topic => {
    const key = topic.replace(/\./g, '_').toUpperCase();
    assert(TOPICS[key] !== undefined, `Missing TOPICS.${key}`);
  });
});

// ============================================================================
// 2. SERVICE CONFIGURATION TESTS
// ============================================================================

console.log('\n=== Service Configuration Tests ===\n');

test('getServiceConfig should return all required properties', () => {
  const config = getServiceConfig();

  const required = [
    'PORT', 'NODE_ENV', 'IS_PROD', 'IS_TEST',
    'JWT_SECRET', 'DB_CONN_STRING',
    'ENABLE_HTTP_API', 'ENABLE_WEBSOCKET', 'ENABLE_WORKER',
    'API_PORT', 'WEBSOCKET_PORT', 'WORKER_PORT',
    'MESSAGE_BUS_TYPE'
  ];

  required.forEach(prop => {
    assert(config.hasOwnProperty(prop), `Missing config.${prop}`);
  });
});

test('getServiceConfig should parse PORT from env', () => {
  const originalPort = process.env.PORT;
  process.env.PORT = '5000';

  const config = getServiceConfig();
  assert(config.PORT === 5000);
  assert(typeof config.PORT === 'number');

  if (originalPort) {
    process.env.PORT = originalPort;
  } else {
    delete process.env.PORT;
  }
});

test('getServiceConfig should have sensible defaults', () => {
  const config = getServiceConfig();

  assert(config.PORT > 0);
  assert(config.JWT_SECRET !== undefined);
  assert(config.ENABLE_HTTP_API === true);
  assert(config.ENABLE_WEBSOCKET === true);
  assert(config.ENABLE_WORKER === true);
});

test('validateConfig should validate JWT_SECRET requirement', () => {
  const testConfig = {
    DB_CONN_STRING: 'postgresql://test',
    JWT_SECRET: 'test-secret'
  };

  const result = validateConfig(testConfig);
  assert(result === true);
});

test('validateConfig should fail on missing DATABASE_URL', () => {
  const testConfig = {
    JWT_SECRET: 'test-secret'
  };

  const result = validateConfig(testConfig);
  assert(result === false);
});

// ============================================================================
// 3. SERVICE ORCHESTRATOR TESTS
// ============================================================================

console.log('\n=== Service Orchestrator Tests ===\n');

test('ServiceOrchestrator should be instantiable', () => {
  const config = { NODE_ENV: 'test' };
  const orchestrator = new ServiceOrchestrator(config);

  assert(orchestrator !== null);
  assert(orchestrator.messageBus !== undefined);
});

test('ServiceOrchestrator.registerService should register services', () => {
  const orchestrator = new ServiceOrchestrator({});
  const mockService = { start: () => {}, stop: () => {} };

  orchestrator.registerService('test', mockService);

  assert(orchestrator.getService('test') === mockService);
});

test('ServiceOrchestrator.registerService should track dependencies', () => {
  const orchestrator = new ServiceOrchestrator({});
  const service1 = { start: () => {}, stop: () => {} };
  const service2 = { start: () => {}, stop: () => {} };

  orchestrator.registerService('service1', service1);
  orchestrator.registerService('service2', service2, ['service1']);

  const status = orchestrator.getServiceStatus();
  assert(status.service2.dependencies.includes('service1'));
});

test('ServiceOrchestrator.buildStartupOrder should handle dependencies', () => {
  const orchestrator = new ServiceOrchestrator({});
  orchestrator.registerService('db', {});
  orchestrator.registerService('cache', {}, ['db']);
  orchestrator.registerService('api', {}, ['cache']);

  const order = orchestrator.buildStartupOrder();

  assert(order.indexOf('db') < order.indexOf('cache'));
  assert(order.indexOf('cache') < order.indexOf('api'));
});

test('ServiceOrchestrator.buildStartupOrder should detect circular dependencies', () => {
  const orchestrator = new ServiceOrchestrator({});
  orchestrator.registerService('a', {}, ['b']);
  orchestrator.registerService('b', {}, ['a']);

  assert.throws(() => {
    orchestrator.buildStartupOrder();
  }, /Circular dependency/);
});

test('ServiceOrchestrator.getMessageBus should return same instance', () => {
  const orchestrator = new ServiceOrchestrator({});
  const bus1 = orchestrator.getMessageBus();
  const bus2 = orchestrator.getMessageBus();

  assert(bus1 === bus2);
});

asyncTest('ServiceOrchestrator.getHealth should return service health', async () => {
  const orchestrator = new ServiceOrchestrator({});

  const mockService = {
    start: async () => {},
    stop: async () => {},
    healthCheck: async () => ({ ok: true })
  };

  orchestrator.registerService('test', mockService);
  await mockService.start();

  const health = await orchestrator.getHealth();

  assert(health.services.test !== undefined);
  assert(health.services.test.ok === true);
});

// ============================================================================
// 4. WEBSOCKET SERVICE TESTS
// ============================================================================

console.log('\n=== WebSocket Service Tests ===\n');

asyncTest('WebSocketService should create with config and message bus', async () => {
  const config = {
    JWT_SECRET: 'test-secret',
    WEBSOCKET_PORT: 3002,
    IS_TEST: true
  };
  const bus = new MessageBus();

  const wsService = await createWebSocketService(config, bus);

  assert(wsService !== null);
  assert(typeof wsService.broadcast === 'function');
  assert(typeof wsService.sendToUser === 'function');
});

asyncTest('WebSocketService should have healthCheck method', async () => {
  const config = {
    JWT_SECRET: 'test-secret',
    IS_TEST: true
  };
  const bus = new MessageBus();

  const wsService = await createWebSocketService(config, bus);
  const health = await wsService.healthCheck();

  assert(health.ok !== undefined);
  assert(health.connections !== undefined);
  assert(health.users !== undefined);
});

// ============================================================================
// 5. WORKER SERVICE TESTS
// ============================================================================

console.log('\n=== Worker Service Tests ===\n');

asyncTest('WorkerService should create with config and message bus', async () => {
  const config = { NODE_ENV: 'test' };
  const bus = new MessageBus();

  const workerService = await createWorkerService(config, bus);

  assert(workerService !== null);
  assert(typeof workerService.enqueueJob === 'function');
  assert(typeof workerService.getStats === 'function');
});

asyncTest('WorkerService should enqueue jobs', async () => {
  const config = { NODE_ENV: 'test' };
  const bus = new MessageBus();
  const workerService = await createWorkerService(config, bus);

  const jobId = await workerService.enqueueJob({
    type: 'send_email',
    payload: { to: 'test@example.com' }
  });

  assert(jobId !== undefined);
  assert(typeof jobId === 'string');

  const stats = workerService.getStats();
  assert(stats.queueLength === 1);
});

asyncTest('WorkerService should have healthCheck method', async () => {
  const config = { NODE_ENV: 'test' };
  const bus = new MessageBus();
  const workerService = await createWorkerService(config, bus);

  const health = await workerService.healthCheck();

  assert(health.ok === true);
  assert(health.queueLength !== undefined);
  assert(health.activeJobs !== undefined);
  assert(health.completedJobs !== undefined);
});

// ============================================================================
// 6. INTEGRATION TESTS
// ============================================================================

console.log('\n=== Integration Tests ===\n');

asyncTest('Services should communicate via message bus', async () => {
  const bus = new MessageBus();
  const received = [];

  // Simulate API service publishing
  const publishEvent = () => {
    bus.publish(TOPICS.USER_REGISTERED, {
      userId: 123,
      email: 'test@example.com'
    });
  };

  // Simulate worker service subscribing
  bus.subscribe(TOPICS.USER_REGISTERED, (event) => {
    received.push(event);
  });

  await publishEvent();

  assert(received.length === 1);
  assert(received[0].userId === 123);
});

asyncTest('Multiple services should subscribe to same events', async () => {
  const bus = new MessageBus();
  const results = { worker: [], api: [], websocket: [] };

  // Worker listens for payment
  bus.subscribe(TOPICS.PAYMENT_SUCCESS, () => {
    results.worker.push('processed');
  });

  // API listens for payment
  bus.subscribe(TOPICS.PAYMENT_SUCCESS, () => {
    results.api.push('recorded');
  });

  // WebSocket listens for payment
  bus.subscribe(TOPICS.PAYMENT_SUCCESS, () => {
    results.websocket.push('notified');
  });

  await bus.publish(TOPICS.PAYMENT_SUCCESS, { transactionId: 123 });

  assert(results.worker.length === 1);
  assert(results.api.length === 1);
  assert(results.websocket.length === 1);
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n=== TEST SUMMARY ===\n');
console.log(`Total Tests: ${testCount}`);
console.log(`Passed: ${passedCount}`);
console.log(`Failed: ${failedTests.length}`);

const shouldExit = !process.env.JEST_WORKER_ID;

if (failedTests.length > 0) {
  console.log('\nFailed Tests:');
  failedTests.forEach((test, i) => {
    console.log(`${i + 1}. ${test.name}`);
    console.log(`   ${test.error}`);
  });
  if (shouldExit) {
    process.exit(1);
  }
} else {
  console.log('\n✓ All tests passed! Step 1 decomposition is correctly implemented.\n');
  if (shouldExit) {
    process.exit(0);
  }
}

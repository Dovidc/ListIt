const fs = require('fs');
const path = require('path');
const vm = require('vm');

const listingQueuePath = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'app',
  'features',
  'listing-queue.js'
);

function loadFactory() {
  jest.resetModules();
  const source = fs.readFileSync(listingQueuePath, 'utf8');
  const transformed = source
    .replace(/export\s+default\s+createListingQueueFeature;?/g, '')
    .replace(/export\s+function\s+createListingQueueFeature/, 'function createListingQueueFeature');

  const context = {
    module: { exports: {} },
    exports: {},
    window: {},
    console,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;

  vm.runInNewContext(
    `${transformed}\nmodule.exports.createListingQueueFeature = createListingQueueFeature;`,
    context,
    { filename: listingQueuePath }
  );

  const factory = context.window?.ListItApp?.features?.listingQueue?.createListingQueueFeature;
  if (typeof factory !== 'function') {
    throw new Error('Failed to register listing queue feature factory.');
  }

  return factory;
}

function createReactMocks() {
  const states = [];
  const refs = [];
  const effects = [];

  const React = {
    useState: jest.fn((initial) => {
      const value = typeof initial === 'function' ? initial() : initial;
      const record = { value, setter: null };
      const setter = jest.fn((update) => {
        const next = typeof update === 'function' ? update(record.value) : update;
        record.value = next;
        return next;
      });
      record.setter = setter;
      states.push(record);
      return [record.value, setter];
    }),
    useRef: jest.fn((initial) => {
      const ref = { current: initial };
      refs.push(ref);
      return ref;
    }),
    useCallback: jest.fn((fn) => fn),
    useEffect: jest.fn((effect) => {
      effects.push(effect);
    }),
    useMemo: jest.fn((factory) => factory())
  };

  return { React, states, refs, effects };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('listing queue feature integration', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('registers factory and enforces dependency contract', () => {
    const factory = loadFactory();

    expect(() => factory({})).toThrow('Listing queue feature requires React.');
    expect(() => factory({ React: {} })).toThrow('Listing queue feature requires React.');

    const { React } = createReactMocks();
    const feature = factory({ React });
    expect(feature).toEqual(expect.objectContaining({ useListingQueue: expect.any(Function) }));
  });

  test('processes queued jobs sequentially and manages toast visibility', async () => {
    jest.useFakeTimers();
    const factory = loadFactory();
    const { React, states, refs, effects } = createReactMocks();

    const { useListingQueue } = factory({ React });
    const queue = useListingQueue({ reminderDuration: 500 });

    const cleanupFns = effects.map((effect) => effect());

    const jobOrder = [];
    const job1 = jest.fn(() => {
      jobOrder.push('job1');
    });
    const job2 = jest.fn(() => {
      jobOrder.push('job2');
    });

    queue.enqueueListingJob(job1);
    expect(states[0].value).toBe(true);
    expect(states[1].value).toBe(1);

    queue.enqueueListingJob(job2);
    expect(states[1].value).toBe(2);

    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(job1).toHaveBeenCalledTimes(1);
    expect(job2).toHaveBeenCalledTimes(1);
    expect(jobOrder).toEqual(['job1', 'job2']);

    jest.advanceTimersByTime(500);
    await flushMicrotasks();
    expect(states[0].value).toBe(false);

    cleanupFns.forEach((cleanup) => {
      if (typeof cleanup === 'function') cleanup();
    });

    expect(refs[0].current).toEqual([]);
    expect(refs[1].current).toBe(false);
    expect(refs[2].current).toBeNull();
  });
});

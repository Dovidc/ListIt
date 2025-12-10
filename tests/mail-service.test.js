const mailService = require('../mail-service');

beforeEach(() => {
  jest.useFakeTimers();
  mailService.__reset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ephemeral token store', () => {
  it('expires tokens after the configured TTL', () => {
    const store = mailService.__createEphemeralStore(1000, { maxEntries: 5 });

    store.remember('user@example.com', 'secret-token');
    expect(store.read('user@example.com')).toBe('secret-token');

    jest.advanceTimersByTime(1001);

    expect(store.read('user@example.com')).toBeNull();
  });

  it('evicts the oldest token once the cache limit is reached', () => {
    const store = mailService.__createEphemeralStore(60000, { maxEntries: 2 });

    store.remember('first@example.com', 'first-token');
    store.remember('second@example.com', 'second-token');
    store.remember('third@example.com', 'third-token');

    expect(store.read('first@example.com')).toBeNull();
    expect(store.read('second@example.com')).toBe('second-token');
    expect(store.read('third@example.com')).toBe('third-token');
  });

  it('redacts raw values when storeRaw is disabled', () => {
    const store = mailService.__createEphemeralStore(60000, { maxEntries: 2, storeRaw: false });

    store.remember('user@example.com', 'should-not-be-stored');

    expect(store.read('user@example.com')).toBeNull();
  });
});

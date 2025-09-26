const { installDom } = require('./dom-stub');
installDom();
const { React, ReactDOM } = require('./react-stub');

global.React = React;
global.ReactDOM = ReactDOM;
window.React = React;
window.ReactDOM = ReactDOM;

describe('modular web client', () => {
  function buildApi(overrides = {}) {
    return {
      me: jest.fn().mockResolvedValue(null),
      login: jest.fn().mockResolvedValue({ id: 1, email: 'user@test.com', username: 'User One' }),
      logout: jest.fn().mockResolvedValue(null),
      register: jest.fn().mockResolvedValue({ id: 2, email: 'reg@test.com', username: 'New User' }),
      listAll: jest.fn().mockResolvedValue([{ id: 10, title: 'City Bike', price: 35, distance_m: 1600, thumb_url: 'https://example.com/bike.jpg' }]),
      listMine: jest.fn().mockResolvedValue([]),
      createListing: jest.fn().mockResolvedValue({ id: 11, title: 'Fresh Listing' }),
      ...overrides
    };
  }

  function setCore(api) {
    window.ListItCore = {
      createApiClient: () => api,
      formatCurrency: (value) => `$${Number(value || 0).toFixed(2)}`,
      formatDistance: (meters) => `${Math.round(Number(meters || 0))} m`,
      haversineMeters: () => 0
    };
  }

  async function flush() {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    const mount = document.createElement('div');
    mount.setAttribute('id', 'root');
    document.body.appendChild(mount);
    window.ListItCore = undefined;
  });

  it('renders the auth panel when unauthenticated', async () => {
    const api = buildApi();
    setCore(api);
    const { mountApp } = await import('../../public/app/main.mjs');
    const root = mountApp(document.getElementById('root'));
    await flush();

    expect(api.me).toHaveBeenCalled();
    const authForm = document.querySelector('[data-testid="auth-form"]');
    expect(authForm).not.toBeNull();

    root.unmount();
  });

  it('logs in the user and displays listings', async () => {
    const api = buildApi();
    setCore(api);
    const { mountApp } = await import('../../public/app/main.mjs');
    const root = mountApp(document.getElementById('root'));
    await flush();

    const email = document.querySelector('input[name="email"]');
    const password = document.querySelector('input[name="password"]');
    email.value = 'user@test.com';
    password.value = 'secret1';
    email.dispatchEvent(new window.Event('input', { bubbles: true }));
    password.dispatchEvent(new window.Event('input', { bubbles: true }));

    const form = document.querySelector('[data-testid="auth-form"]');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(api.login).toHaveBeenCalledWith('user@test.com', 'secret1');

    await flush();

    expect(document.querySelector('.new-listing')).not.toBeNull();
    expect(document.querySelector('.listing-card')).not.toBeNull();
    expect(document.body.textContent).toContain('City Bike');

    root.unmount();
  });

  it('creates a listing through the uploads provider', async () => {
    const api = buildApi({
      createListing: jest.fn().mockResolvedValue({ id: 33, title: 'Token Listing' })
    });
    setCore(api);
    const { mountApp } = await import('../../public/app/main.mjs');
    const root = mountApp(document.getElementById('root'));
    await flush();

    const email = document.querySelector('input[name="email"]');
    const password = document.querySelector('input[name="password"]');
    email.value = 'user@test.com';
    password.value = 'secret1';
    email.dispatchEvent(new window.Event('input', { bubbles: true }));
    password.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.querySelector('[data-testid="auth-form"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    const title = document.querySelector('input[name="listing-title"]');
    const location = document.querySelector('input[name="listing-location"]');
    const price = document.querySelector('input[name="listing-price"]');
    const tokens = document.querySelector('textarea[name="upload-tokens"]');
    title.value = 'Test Item';
    location.value = 'Portland, OR';
    price.value = '19.99';
    tokens.value = 'token-1, token-2';
    title.dispatchEvent(new window.Event('input', { bubbles: true }));
    location.dispatchEvent(new window.Event('input', { bubbles: true }));
    price.dispatchEvent(new window.Event('input', { bubbles: true }));
    tokens.dispatchEvent(new window.Event('input', { bubbles: true }));

    document.querySelector('.new-listing-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(api.createListing).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Test Item',
      location: 'Portland, OR',
      price: 19.99,
      upload_tokens: ['token-1', 'token-2']
    }));

    await flush();

    const toast = document.querySelector('[data-testid="toast"]');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('Listing created');

    root.unmount();
  });
});

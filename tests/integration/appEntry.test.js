const path = require('path');

describe('public/app.js entrypoint', () => {
  const appEntryPath = path.join(__dirname, '..', '..', 'public', 'app.js');

  function requireApp() {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(appEntryPath);
  }

  beforeEach(() => {
    jest.resetModules();
    global.window = {};
  });

  afterEach(() => {
    delete global.window;
  });

  test('bootstraps the browser app using global bundles', () => {
    const mount = jest.fn();
    const createBrowserApp = jest.fn(() => ({ mount }));
    const core = { marker: 'core' };
    const appBundles = { bootstrap: { createBrowserApp } };

    Object.assign(global.window, {
      React: { marker: 'react' },
      ReactDOM: { marker: 'react-dom' },
      ListItCore: core,
      ListItApp: appBundles
    });

    requireApp();

    expect(createBrowserApp).toHaveBeenCalledTimes(1);
    expect(createBrowserApp).toHaveBeenCalledWith({
      React: global.window.React,
      ReactDOM: global.window.ReactDOM,
      core,
      appBundles
    });
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledWith();
  });

  test('passes an empty core object when ListItCore is not defined', () => {
    const mount = jest.fn();
    const createBrowserApp = jest.fn(() => ({ mount }));
    const appBundles = { bootstrap: { createBrowserApp } };

    Object.assign(global.window, {
      React: {},
      ReactDOM: {},
      ListItApp: appBundles
    });

    requireApp();

    const args = createBrowserApp.mock.calls[0][0];
    expect(args.core).toEqual({});
    expect(args.appBundles).toBe(appBundles);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  test('throws a helpful error when React is unavailable', () => {
    Object.assign(global.window, {
      ReactDOM: {},
      ListItApp: { bootstrap: { createBrowserApp: jest.fn() } }
    });

    expect(requireApp).toThrow('React bundle failed to load.');
  });

  test('throws a helpful error when ReactDOM is unavailable', () => {
    Object.assign(global.window, {
      React: {},
      ListItApp: { bootstrap: { createBrowserApp: jest.fn() } }
    });

    expect(requireApp).toThrow('ReactDOM bundle failed to load.');
  });

  test('throws a helpful error when the browser app bundle is missing', () => {
    Object.assign(global.window, {
      React: {},
      ReactDOM: {},
      ListItApp: { bootstrap: {} }
    });

    expect(requireApp).toThrow('Browser app bundle failed to load.');
  });
});

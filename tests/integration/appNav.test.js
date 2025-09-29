const path = require('path');

describe('app nav integration', () => {
  const appNavPath = path.join(__dirname, '..', '..', 'public', 'app', 'bootstrap', 'app-nav.js');

  function loadFactory() {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(appNavPath);
    return global.window.ListItApp.bootstrap.createAppNav;
  }

  beforeEach(() => {
    jest.resetModules();
    global.window = {};
  });

  afterEach(() => {
    delete global.window;
  });

  test('registers createAppNav on the global ListItApp namespace', () => {
    const createAppNav = loadFactory();

    expect(global.window.ListItApp).toBeDefined();
    expect(global.window.ListItApp.bootstrap).toBeDefined();
    expect(typeof createAppNav).toBe('function');
  });

  test('createAppNav returns navigation helpers as no-op functions', () => {
    const createAppNav = loadFactory();

    const nav = createAppNav();
    const methods = ['setUser', 'setTab', 'incLoad', 'decLoad', 'notifyLocked'];

    methods.forEach((method) => {
      expect(typeof nav[method]).toBe('function');
      expect(() => nav[method]()).not.toThrow();
    });
  });
});

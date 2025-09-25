const AppNav = {
  setUser: () => {},
  setTab: () => {},
  incLoad: () => {},
  decLoad: () => {},
  notifyLocked: () => {}
};

const core = window.ListItCore || {};
const {
  createApiClient,
  formatCurrency,
  formatDistance,
  haversineMeters: coreHaversineMeters
} = core;

if (typeof createApiClient !== 'function') {
  throw new Error('ListIt core bundle failed to load.');
}

const api = createApiClient({
  onRequestStart: () => AppNav.incLoad(),
  onRequestEnd: () => AppNav.decLoad(),
  onUnauthorized: () => {
    AppNav.setUser(null);
    AppNav.setTab('browse');
  },
  onAccountLocked: () => AppNav.notifyLocked(),
  fetchImpl: (input, init) => fetch(input, init)
});

const price = (n) => formatCurrency(n ?? 0);
const fmtDistance = (m) => formatDistance(m);
const haversineMeters = (...args) => coreHaversineMeters(...args);

export { api, AppNav, price, fmtDistance, haversineMeters };

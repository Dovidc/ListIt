export function requireCore() {
  if (typeof window === 'undefined') {
    throw new Error('ListIt core bundle failed to load.');
  }
  const core = window.ListItCore || {};
  if (typeof core.createApiClient !== 'function') {
    throw new Error('ListIt core bundle failed to load.');
  }
  return core;
}

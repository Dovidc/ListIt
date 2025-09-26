import { createElement, ReactDOM } from './shared/runtime.mjs';
import { AppLayout, AppProviders } from './components/AppLayout.mjs';

export function mountApp(container) {
  if (!container) {
    throw new Error('mountApp requires a DOM container');
  }
  const root = ReactDOM.createRoot(container);
  root.render(createElement(AppProviders, null, createElement(AppLayout)));
  return root;
}

if (typeof document !== 'undefined') {
  const container = document.getElementById('root');
  if (container) {
    mountApp(container);
  }
}

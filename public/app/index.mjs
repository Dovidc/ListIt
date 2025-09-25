import { renderApp } from './App.mjs';

function bootstrap() {
  const rootEl = document.getElementById('root');
  renderApp(rootEl);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}

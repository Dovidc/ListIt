const REACT_POLL_INTERVAL = 50;
const REACT_POLL_TIMEOUT = 5000;

function hasReactGlobals() {
  return typeof window !== 'undefined'
    && typeof window.React !== 'undefined'
    && typeof window.ReactDOM !== 'undefined';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureReactReady({ timeout = REACT_POLL_TIMEOUT } = {}) {
  if (hasReactGlobals()) return;

  const start = Date.now();
  const deadline = start + Math.max(0, timeout);

  while (!hasReactGlobals()) {
    if (Date.now() >= deadline) {
      throw new Error('React scripts failed to load.');
    }
    await wait(REACT_POLL_INTERVAL);
  }
}

async function bootstrap() {
  const rootEl = document.getElementById('root');

  try {
    await ensureReactReady();
    const { renderApp } = await import('./App.mjs');
    renderApp(rootEl);
  } catch (error) {
    console.error('Failed to bootstrap the ListIt web app.', error);
    if (rootEl) {
      rootEl.innerHTML = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #111; padding: 24px;">
          <h1 style="margin: 0 0 12px; font-size: 20px;">We couldn't start the app</h1>
          <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.4;">
            Please refresh the page. If the problem continues, contact support.
          </p>
          <pre style="margin: 12px 0 0; padding: 12px; background: #f3f4f6; border-radius: 8px; font-size: 12px; overflow: auto;">
${error && error.message ? error.message : 'Unknown error'}
          </pre>
        </div>
      `;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bootstrap();
  }, { once: true });
} else {
  bootstrap();
}

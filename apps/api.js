const { loadEnv } = require('../src/infrastructure/env');
loadEnv();

const http = require('http');
const app = require('../server');

const port = Number(process.env.PORT || 3000);

async function startApi() {
  try {
    await app._initializeSchema();
    await app._maybeCreateAdmin();

    const server = http.createServer(app);
    server.listen(port, () => {
      console.log(`[api] listening on http://localhost:${port}`);
    });
  } catch (err) {
    console.error('[api] failed to start:', err);
    process.exit(1);
  }
}

startApi();

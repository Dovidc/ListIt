const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'shared', 'api', 'client.js');
const browserDest = path.join(root, 'public', 'shared-core.js');
const distDir = path.join(root, 'shared', 'dist');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function syncBrowserBundle() {
  ensureDir(path.dirname(browserDest));
  fs.copyFileSync(source, browserDest);
}

function syncDist() {
  ensureDir(distDir);
  const cjs = "module.exports = require('../api/client.js');\n";
  const mjs = "import pkg from '../api/client.js';\nexport const { createApiClient } = pkg;\nexport default pkg;\n";
  fs.writeFileSync(path.join(distDir, 'index.cjs'), cjs);
  fs.writeFileSync(path.join(distDir, 'index.mjs'), mjs);
}

syncBrowserBundle();
syncDist();
console.log('Shared core synced to public/shared-core.js and shared/dist outputs.');

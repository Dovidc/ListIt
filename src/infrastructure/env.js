const fs = require('fs');
const path = require('path');

const ENV_CANDIDATES = ['.env.local', '.env'];
let loaded = false;

function loadEnv() {
  if (loaded) return;

  for (const envFile of ENV_CANDIDATES) {
    const envPath = path.resolve(process.cwd(), envFile);
    if (!fs.existsSync(envPath)) continue;

    try {
      const contents = fs.readFileSync(envPath, 'utf8');
      const lines = contents.split(/\r?\n/);
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const line = trimmed.startsWith('export ')
          ? trimmed.slice('export '.length)
          : trimmed;

        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) continue;

        const key = line.slice(0, eqIndex).trim();
        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

        let value = line.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        process.env[key] = value;
      }

      if (process.env.NODE_ENV !== 'test') {
        console.log(`[env] Loaded environment from ${envFile}`);
      }
      break;
    } catch (err) {
      console.warn(`[env] Failed to load ${envFile}:`, err?.message || err);
    }
  }

  loaded = true;
}

module.exports = { loadEnv };

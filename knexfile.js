const fs = require('fs');
const path = require('path');
const { getDatabaseConfig, assertProductionTls } = require('./lib/database-config');

const ENV_CANDIDATES = ['.env.local', '.env'];
for (const envFile of ENV_CANDIDATES) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) continue;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
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
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
    break;
  } catch (err) {
    console.warn(`[knexfile] Failed to load ${envFile}:`, err?.message || err);
  }
}

const databaseConfig = getDatabaseConfig();
assertProductionTls(databaseConfig, process.env.NODE_ENV === 'production');

const baseConfig = {
  client: 'pg',
  connection: databaseConfig,
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations'
  },
  pool: {
    min: databaseConfig.min,
    max: databaseConfig.max,
    idleTimeoutMillis: databaseConfig.idleTimeoutMillis
  }
};

module.exports = {
  development: baseConfig,
  production: baseConfig
};

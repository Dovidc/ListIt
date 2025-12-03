const fs = require('fs');
const path = require('path');

function parseInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadCaCertificate(filePath) {
  try {
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved)) {
      return fs.readFileSync(resolved, 'utf8');
    }
  } catch (err) {
    console.warn(`[db] Failed to load DATABASE_SSL_CA_FILE (${filePath}):`, err?.message || err);
  }
  return undefined;
}

function resolveSslConfig() {
  const mode = (process.env.DATABASE_SSL_MODE || '').toLowerCase();
  const explicitDisable = process.env.DATABASE_SSL === 'false' || mode === 'disable' || mode === 'off';

  if (explicitDisable) {
    return false;
  }

  const ssl = {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false'
  };

  const ca = process.env.DATABASE_SSL_CA_FILE
    ? loadCaCertificate(process.env.DATABASE_SSL_CA_FILE)
    : undefined;

  if (ca) {
    ssl.ca = ca;
  }

  return ssl;
}

function getPoolSettings() {
  return {
    max: parseInteger(process.env.DB_POOL_MAX || process.env.PGPOOLSIZE, 20),
    min: parseInteger(process.env.DB_POOL_MIN, 2),
    idleTimeoutMillis: parseInteger(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: parseInteger(process.env.DB_CONNECTION_TIMEOUT_MS, 10000),
    allowExitOnIdle: false
  };
}

function getDatabaseConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('ListIt now requires a PostgreSQL database. Set the DATABASE_URL environment variable to start the server.');
  }

  const ssl = resolveSslConfig();

  return {
    connectionString,
    ssl,
    ...getPoolSettings()
  };
}

function assertProductionTls(config, isProd) {
  if (isProd && config.ssl === false) {
    throw new Error('DATABASE_SSL is disabled but TLS is required in production. Remove DATABASE_SSL=false or set DATABASE_SSL_MODE=require.');
  }
}

module.exports = {
  getDatabaseConfig,
  getPoolSettings,
  resolveSslConfig,
  assertProductionTls
};

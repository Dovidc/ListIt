// db-wrapper.js
const fs = require('fs');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    'ListIt now requires a PostgreSQL database. Set the DATABASE_URL environment variable to start the server.'
  );
}

const sslMode = (process.env.PGSSLMODE || (process.env.NODE_ENV === 'production' ? 'require' : 'prefer')).toLowerCase();
if (process.env.NODE_ENV === 'production' && sslMode === 'disable') {
  throw new Error('PGSSLMODE=disable is not permitted in production. Set PGSSLMODE=require to enforce TLS.');
}

let ssl = false;
if (sslMode !== 'disable') {
  ssl = {
    rejectUnauthorized: ['require', 'verify-ca', 'verify-full'].includes(sslMode)
  };
  if (process.env.PG_SSL_CA) {
    ssl.ca = process.env.PG_SSL_CA;
  } else if (process.env.PG_SSL_CA_FILE) {
    try {
      ssl.ca = fs.readFileSync(process.env.PG_SSL_CA_FILE, 'utf8');
    } catch (err) {
      console.warn('[db] Failed to read PG_SSL_CA_FILE:', err?.message || err);
    }
  }
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl,
  max: parseInt(process.env.PG_POOL_MAX || '50', 10),
  min: parseInt(process.env.PG_POOL_MIN || '5', 10),
  idleTimeoutMillis: parseInt(process.env.PG_POOL_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_POOL_CONNECTION_TIMEOUT_MS || '10000', 10),
  allowExitOnIdle: false
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

const waitSamples = [];
function recordWait(ms) {
  if (!Number.isFinite(ms)) return;
  waitSamples.push(ms);
  if (waitSamples.length > 500) {
    waitSamples.shift();
  }
}

function getWaitP95() {
  if (waitSamples.length === 0) return 0;
  const sorted = [...waitSamples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

async function getClient() {
  const start = Date.now();
  const client = await pool.connect();
  recordWait(Date.now() - start);
  return client;
}

async function queryWithMetrics(sql, values = []) {
  const client = await getClient();
  try {
    return await client.query(sql, values);
  } finally {
    client.release();
  }
}

const normalizeQuery = (sql, params) => {
  let pgSql = sql;
  let values = [];

  if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
    const namedParams = params[0];
    const paramNames = [];

    pgSql = sql.replace(/[:@$](\w+)/g, (match, name, offset, originalSql) => {
      if (match[0] === ':' && offset > 0 && originalSql[offset - 1] === ':') {
        return match;
      }

      let index = paramNames.indexOf(name);
      if (index === -1) {
        paramNames.push(name);
        index = paramNames.length - 1;
      }
      return '$' + (index + 1);
    });

    values = paramNames.map(name => namedParams[name]);
  } else {
    let counter = 0;
    pgSql = sql.replace(/\?/g, () => `$${++counter}`);
    values = params;
  }

  return { sql: pgSql, values };
};

module.exports = {
  prepare: (sql) => ({
    get: async (...params) => {
      const { sql: pgSql, values } = normalizeQuery(sql, params);
      const result = await queryWithMetrics(pgSql, values);
      return result.rows[0];
    },

    all: async (...params) => {
      const { sql: pgSql, values } = normalizeQuery(sql, params);
      const result = await queryWithMetrics(pgSql, values);
      return result.rows;
    },

    run: async (...params) => {
      const { sql: pgSqlBase, values } = normalizeQuery(sql, params);
      let pgSql = pgSqlBase;

      if (pgSql.toLowerCase().includes('insert into') &&
          !pgSql.toLowerCase().includes('returning')) {
        pgSql += ' RETURNING id';
      }

      const result = await queryWithMetrics(pgSql, values);

      return {
        lastInsertRowid: result.rows[0]?.id || null,
        changes: result.rowCount
      };
    }
  }),

  exec: async (sql) => {
    const result = await queryWithMetrics(sql);
    return result;
  },

  transaction: async (callback) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const result = await callback({
        prepare: (sql) => ({
          get: async (...params) => {
            const { sql: pgSql, values } = normalizeQuery(sql, params);
            const result = await client.query(pgSql, values);
            return result.rows[0];
          },
          all: async (...params) => {
            const { sql: pgSql, values } = normalizeQuery(sql, params);
            const result = await client.query(pgSql, values);
            return result.rows;
          },
          run: async (...params) => {
            const { sql: pgSqlBase, values } = normalizeQuery(sql, params);
            let pgSql = pgSqlBase;

            if (pgSql.toLowerCase().includes('insert into') &&
                !pgSql.toLowerCase().includes('returning')) {
              pgSql += ' RETURNING id';
            }

            const result = await client.query(pgSql, values);
            return {
              lastInsertRowid: result.rows[0]?.id || null,
              changes: result.rowCount
            };
          }
        }),
        exec: (sql) => client.query(sql)
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  close: async () => {
    await pool.end();
  },

  metrics: () => ({
    waiting: pool.waitingCount || 0,
    idle: pool.idleCount || 0,
    total: pool.totalCount || 0,
    waitP95: getWaitP95()
  })
};

// db-wrapper.js
const Database = require('better-sqlite3');
const { Pool } = require('pg');

// Use PostgreSQL if DATABASE_URL exists, otherwise SQLite
if (process.env.DATABASE_URL) {
  console.log('Using PostgreSQL');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // ADD THESE LINES:
    max: 10,                      // Maximum 10 connections (not unlimited)
    idleTimeoutMillis: 30000,     // Close idle connections after 30 seconds
    connectionTimeoutMillis: 2000, // Fail fast if can't connect in 2 seconds
    allowExitOnIdle: true          // Let Node.js exit when all connections idle
  });

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

  // PostgreSQL wrapper that mimics SQLite API
  module.exports = {
    prepare: (sql) => ({
      get: async (...params) => {
        const { sql: pgSql, values } = normalizeQuery(sql, params);
        const result = await pool.query(pgSql, values);
        return result.rows[0];
      },

      all: async (...params) => {
        const { sql: pgSql, values } = normalizeQuery(sql, params);
        const result = await pool.query(pgSql, values);
        return result.rows;
      },

      run: async (...params) => {
        const { sql: pgSqlBase, values } = normalizeQuery(sql, params);
        let pgSql = pgSqlBase;

        // Only add RETURNING id if it's an INSERT and doesn't already have RETURNING
        if (pgSql.toLowerCase().includes('insert into') &&
            !pgSql.toLowerCase().includes('returning')) {
          pgSql += ' RETURNING id';
        }
        
        const result = await pool.query(pgSql, values);
        
        return {
          lastInsertRowid: result.rows[0]?.id || null,
          changes: result.rowCount
        };
      }
    }),
    
    exec: async (sql) => {
      const result = await pool.query(sql);
      return result;
    },
    
    // Add transaction support for PostgreSQL
    transaction: async (callback) => {
      const client = await pool.connect();
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
    
    // Close connection pool
    close: async () => {
      await pool.end();
    }
  };
} else {
  console.log('Using SQLite');
  const db = new Database(process.env.DB_PATH || 'listit.db');
  module.exports = db;
}
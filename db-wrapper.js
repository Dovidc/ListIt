// db-wrapper.js
const Database = require('better-sqlite3');
const { Pool } = require('pg');

// Use PostgreSQL if DATABASE_URL exists, otherwise SQLite
if (process.env.DATABASE_URL) {
  console.log('Using PostgreSQL');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Render
  });

  // PostgreSQL wrapper that mimics SQLite API
  module.exports = {
    prepare: (sql) => ({
      get: (...params) => {
        // Convert ? to $1, $2, etc.
        let counter = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++counter}`);
        return pool.query(pgSql, params).then(r => r.rows[0]);
      },
      all: (...params) => {
        let counter = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++counter}`);
        return pool.query(pgSql, params).then(r => r.rows);
      },
      run: (...params) => {
        let counter = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++counter}`);
        return pool.query(pgSql + ' RETURNING id', params).then(r => ({
          lastInsertRowid: r.rows[0]?.id,
          changes: r.rowCount
        }));
      }
    }),
    exec: (sql) => pool.query(sql)
  };
} else {
  console.log('Using SQLite');
  const db = new Database(process.env.DB_PATH || 'listit.db');
  module.exports = db;
}
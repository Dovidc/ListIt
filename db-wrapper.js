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
      get: async (...params) => {
        let pgSql = sql;
        let values = [];
        
        // Check if using named parameters (object as first param)
        if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
          // Handle named parameters like { me: 123, other: 456 }
          const namedParams = params[0];
          const paramNames = [];
          
          // Replace :param or @param or $param with $1, $2, etc
          pgSql = sql.replace(/[:@$](\w+)/g, (match, name) => {
            if (!paramNames.includes(name)) {
              paramNames.push(name);
            }
            return '$' + (paramNames.indexOf(name) + 1);
          });
          
          // Build values array in correct order
          values = paramNames.map(name => namedParams[name]);
        } else {
          // Handle positional parameters (?)
          let counter = 0;
          pgSql = sql.replace(/\?/g, () => `$${++counter}`);
          values = params;
        }
        
        const result = await pool.query(pgSql, values);
        return result.rows[0];
      },
      
      all: async (...params) => {
        let pgSql = sql;
        let values = [];
        
        // Check if using named parameters
        if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
          const namedParams = params[0];
          const paramNames = [];
          
          // Replace :param or @param or $param with $1, $2, etc
          pgSql = sql.replace(/[:@$](\w+)/g, (match, name) => {
            if (!paramNames.includes(name)) {
              paramNames.push(name);
            }
            return '$' + (paramNames.indexOf(name) + 1);
          });
          
          values = paramNames.map(name => namedParams[name]);
        } else {
          // Handle positional parameters
          let counter = 0;
          pgSql = sql.replace(/\?/g, () => `$${++counter}`);
          values = params;
        }
        
        const result = await pool.query(pgSql, values);
        return result.rows;
      },
      
      run: async (...params) => {
        let pgSql = sql;
        let values = [];
        
        // Check if using named parameters
        if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
          const namedParams = params[0];
          const paramNames = [];
          
          // Replace :param or @param or $param with $1, $2, etc
          pgSql = sql.replace(/[:@$](\w+)/g, (match, name) => {
            if (!paramNames.includes(name)) {
              paramNames.push(name);
            }
            return '$' + (paramNames.indexOf(name) + 1);
          });
          
          values = paramNames.map(name => namedParams[name]);
        } else {
          // Handle positional parameters
          let counter = 0;
          pgSql = sql.replace(/\?/g, () => `$${++counter}`);
          values = params;
        }
        
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
              // Same parameter handling logic as above
              let pgSql = sql;
              let values = [];
              
              if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
                const namedParams = params[0];
                const paramNames = [];
                pgSql = sql.replace(/[:@$](\w+)/g, (match, name) => {
                  if (!paramNames.includes(name)) {
                    paramNames.push(name);
                  }
                  return '$' + (paramNames.indexOf(name) + 1);
                });
                values = paramNames.map(name => namedParams[name]);
              } else {
                let counter = 0;
                pgSql = sql.replace(/\?/g, () => `$${++counter}`);
                values = params;
              }
              
              const result = await client.query(pgSql, values);
              return result.rows[0];
            },
            all: async (...params) => {
              let pgSql = sql;
              let values = [];
              
              if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
                const namedParams = params[0];
                const paramNames = [];
                pgSql = sql.replace(/[:@$](\w+)/g, (match, name) => {
                  if (!paramNames.includes(name)) {
                    paramNames.push(name);
                  }
                  return '$' + (paramNames.indexOf(name) + 1);
                });
                values = paramNames.map(name => namedParams[name]);
              } else {
                let counter = 0;
                pgSql = sql.replace(/\?/g, () => `$${++counter}`);
                values = params;
              }
              
              const result = await client.query(pgSql, values);
              return result.rows;
            },
            run: async (...params) => {
              let pgSql = sql;
              let values = [];
              
              if (params.length === 1 && typeof params[0] === 'object' && !Array.isArray(params[0])) {
                const namedParams = params[0];
                const paramNames = [];
                pgSql = sql.replace(/[:@$](\w+)/g, (match, name) => {
                  if (!paramNames.includes(name)) {
                    paramNames.push(name);
                  }
                  return '$' + (paramNames.indexOf(name) + 1);
                });
                values = paramNames.map(name => namedParams[name]);
              } else {
                let counter = 0;
                pgSql = sql.replace(/\?/g, () => `$${++counter}`);
                values = params;
              }
              
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
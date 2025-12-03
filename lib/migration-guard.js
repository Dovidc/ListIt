const fs = require('fs');
const path = require('path');
const db = require('../db-wrapper');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function readMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort();
}

async function assertMigrationsCurrent() {
  const migrations = readMigrationFiles();
  if (migrations.length === 0) {
    return;
  }

  const tableRow = await db
    .prepare(`
      SELECT EXISTS (
        SELECT 1
          FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name = 'knex_migrations'
      ) AS present
    `)
    .get();

  if (!tableRow?.present) {
    throw new Error('pending_migrations:knex_migrations_missing');
  }

  const applied = await db
    .prepare('SELECT name FROM knex_migrations ORDER BY id ASC')
    .all();

  const appliedNames = new Set((applied || []).map((row) => row.name));
  const pending = migrations.filter((name) => !appliedNames.has(name));

  if (pending.length > 0) {
    throw new Error(`pending_migrations:${pending.join(',')}`);
  }
}

module.exports = {
  assertMigrationsCurrent
};

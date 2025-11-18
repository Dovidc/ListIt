const knexLib = require('knex');
const knexConfig = require('../knexfile');

function getEnv() {
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

async function runMigrations() {
  const knex = knexLib(knexConfig[getEnv()]);
  try {
    await knex.migrate.latest();
  } finally {
    await knex.destroy();
  }
}

module.exports = {
  runMigrations
};

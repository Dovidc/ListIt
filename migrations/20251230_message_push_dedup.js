/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const isPostgres = knex.client.config.client === 'pg' ||
                     knex.client.config.client === 'postgresql' ||
                     knex.client.config.client === 'postgres';

  await knex.schema.createTable('message_push_dedup', (table) => {
    if (isPostgres) {
      table.bigIncrements('id').primary();
    } else {
      table.increments('id').primary();
    }
    table.bigInteger('message_id').notNullable();
    table.bigInteger('recipient_id').notNullable();
    table.string('created_at', 30).notNullable();

    // Unique constraint to prevent duplicates
    table.unique(['message_id', 'recipient_id']);

    // Index for cleanup queries
    table.index('created_at');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('message_push_dedup');
};

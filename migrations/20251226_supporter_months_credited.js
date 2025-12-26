/**
 * Add supporter_months_credited column to users table.
 * This tracks cumulative months paid, so badge tier only counts active subscription time.
 */
exports.up = async (knex) => {
  const hasColumn = await knex.schema.hasColumn('users', 'supporter_months_credited');

  if (!hasColumn) {
    await knex.schema.alterTable('users', (table) => {
      table.integer('supporter_months_credited').notNullable().defaultTo(0);
    });
  }
};

exports.down = async (knex) => {
  const hasColumn = await knex.schema.hasColumn('users', 'supporter_months_credited');

  if (hasColumn) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('supporter_months_credited');
    });
  }
};

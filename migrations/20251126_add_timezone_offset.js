exports.up = async (knex) => {
  const hasTimezoneOffset = await knex.schema.hasColumn('users', 'timezone_offset');

  if (!hasTimezoneOffset) {
    await knex.schema.alterTable('users', (table) => {
      table.integer('timezone_offset').defaultTo(0);
    });
  }
};

exports.down = async (knex) => {
  const hasTimezoneOffset = await knex.schema.hasColumn('users', 'timezone_offset');

  if (hasTimezoneOffset) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('timezone_offset');
    });
  }
};

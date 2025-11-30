exports.up = async (knex) => {
  const hasBetaTester = await knex.schema.hasColumn('users', 'beta_tester');

  if (!hasBetaTester) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('beta_tester').defaultTo(false);
    });
  }
};

exports.down = async (knex) => {
  const hasBetaTester = await knex.schema.hasColumn('users', 'beta_tester');

  if (hasBetaTester) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('beta_tester');
    });
  }
};

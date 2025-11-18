exports.up = async (knex) => {
  const exists = await knex.schema.hasTable('app_settings');
  if (!exists) {
    await knex.schema.createTable('app_settings', (table) => {
      table.string('key').primary();
      table.text('value');
      table.timestamp('updated_at', { useTz: true });
    });
  }

  await knex('app_settings')
    .insert({ key: 'payments_disabled', value: '0', updated_at: knex.fn.now() })
    .onConflict('key')
    .ignore();
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('app_settings');
};

exports.up = async function (knex) {
  await knex.schema.alterTable('ads', (table) => {
    // 'standard' = current layout with text + optional image
    // 'fullbleed' = image fills entire ad card
    table.string('display_mode', 20).defaultTo('standard');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('ads', (table) => {
    table.dropColumn('display_mode');
  });
};

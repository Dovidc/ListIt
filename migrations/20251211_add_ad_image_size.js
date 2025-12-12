exports.up = async function (knex) {
  await knex.schema.alterTable('ads', (table) => {
    table.integer('image_size').defaultTo(50);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('ads', (table) => {
    table.dropColumn('image_size');
  });
};

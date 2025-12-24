exports.up = async function (knex) {
  // Add is_local column to ads table
  await knex.schema.alterTable('ads', (table) => {
    table.integer('is_local').defaultTo(0);
  });

  // Create ad_locations table for local ad targeting
  await knex.schema.createTable('ad_locations', (table) => {
    table.increments('id').primary();
    table.integer('ad_id').notNullable().references('id').inTable('ads').onDelete('CASCADE');
    table.string('city').notNullable();
    table.float('lat').notNullable();
    table.float('lon').notNullable();
    table.integer('radius_meters').defaultTo(24140); // 15 miles in meters
    table.string('created_at').notNullable();
  });

  // Add index for faster lookups
  await knex.schema.alterTable('ad_locations', (table) => {
    table.index('ad_id', 'idx_ad_locations_ad_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ad_locations');
  await knex.schema.alterTable('ads', (table) => {
    table.dropColumn('is_local');
  });
};

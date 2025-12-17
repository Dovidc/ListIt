/**
 * Add thumb_url column to listing_images table.
 *
 * This stores the URL of a smaller thumbnail version of the image
 * for faster grid loading. The full-size image URL remains in the 'url' column.
 */
exports.up = async (knex) => {
  const hasColumn = await knex.schema.hasColumn('listing_images', 'thumb_url');
  if (!hasColumn) {
    await knex.schema.alterTable('listing_images', (table) => {
      table.text('thumb_url').nullable().defaultTo(null);
    });
  }
};

exports.down = async (knex) => {
  const hasColumn = await knex.schema.hasColumn('listing_images', 'thumb_url');
  if (hasColumn) {
    await knex.schema.alterTable('listing_images', (table) => {
      table.dropColumn('thumb_url');
    });
  }
};

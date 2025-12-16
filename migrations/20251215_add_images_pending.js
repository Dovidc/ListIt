/**
 * Add images_pending column to listings table.
 *
 * This tracks how many images are expected to be uploaded for a "shell" listing
 * created via /api/listings/create-shell endpoint. Once all images are uploaded
 * via /api/uploads/finalize, this count decrements to 0.
 *
 * A null or 0 value means all images have been attached (or no images expected).
 */
exports.up = async (knex) => {
  // Add column if it doesn't exist (SQLite doesn't support IF NOT EXISTS for ALTER)
  const hasColumn = await knex.schema.hasColumn('listings', 'images_pending');
  if (!hasColumn) {
    await knex.schema.alterTable('listings', (table) => {
      table.integer('images_pending').nullable().defaultTo(null);
    });
  }
};

exports.down = async (knex) => {
  const hasColumn = await knex.schema.hasColumn('listings', 'images_pending');
  if (hasColumn) {
    await knex.schema.alterTable('listings', (table) => {
      table.dropColumn('images_pending');
    });
  }
};

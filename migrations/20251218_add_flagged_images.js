exports.up = async (knex) => {
  // Add images column to flagged_attempts table to store associated image URLs
  await knex.raw(`
    ALTER TABLE flagged_attempts
    ADD COLUMN IF NOT EXISTS images TEXT
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    ALTER TABLE flagged_attempts
    DROP COLUMN IF EXISTS images
  `);
};

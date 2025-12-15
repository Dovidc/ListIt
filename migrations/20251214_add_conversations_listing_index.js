exports.up = async (knex) => {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_conversations_listing_id
    ON conversations(listing_id)
  `);
};

exports.down = async (knex) => {
  await knex.raw(`DROP INDEX IF EXISTS idx_conversations_listing_id`);
};

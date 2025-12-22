exports.up = async (knex) => {
  await knex.raw(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_free INTEGER DEFAULT 0;`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_listings_is_free ON listings(is_free, id DESC);`);
};

exports.down = async (knex) => {
  await knex.raw(`DROP INDEX IF EXISTS idx_listings_is_free;`);
  await knex.raw(`ALTER TABLE listings DROP COLUMN IF EXISTS is_free;`);
};

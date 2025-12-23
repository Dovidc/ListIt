exports.up = async (knex) => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS saved_listings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, listing_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_saved_listings_user ON saved_listings(user_id, created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_saved_listings_listing ON saved_listings(listing_id);`
  ];

  for (const sql of statements) {
    // eslint-disable-next-line no-await-in-loop
    await knex.raw(sql);
  }
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS saved_listings CASCADE;');
};

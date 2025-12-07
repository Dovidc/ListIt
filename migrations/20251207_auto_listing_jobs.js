/**
 * Create auto_listing_jobs table for fire-and-forget listing creation.
 *
 * This table stores durable job metadata that survives application restarts,
 * allowing users to close the app after uploading images and have the listing
 * created in the background.
 */
exports.up = async (knex) => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS auto_listing_jobs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      upload_tokens TEXT NOT NULL,
      location TEXT NOT NULL,
      hint TEXT,
      ai_enabled INTEGER DEFAULT 1,
      enable_nearby INTEGER DEFAULT 0,
      inquiry_enabled INTEGER DEFAULT 0,
      lat REAL,
      lon REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
      error TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      processing_started_at TEXT,
      completed_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_auto_listing_jobs_user_status ON auto_listing_jobs(user_id, status);`,
    `CREATE INDEX IF NOT EXISTS idx_auto_listing_jobs_status ON auto_listing_jobs(status, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_auto_listing_jobs_created ON auto_listing_jobs(created_at DESC);`
  ];

  for (const sql of statements) {
    await knex.raw(sql);
  }
};

exports.down = async (knex) => {
  await knex.raw(`DROP TABLE IF EXISTS auto_listing_jobs CASCADE;`);
};

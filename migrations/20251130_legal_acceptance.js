exports.up = async (knex) => {
  const statements = [
    // Add legal acceptance columns to users table
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_version TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_version TEXT`,

    // Create legal_documents table to track document versions
    `CREATE TABLE IF NOT EXISTS legal_documents (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      version TEXT NOT NULL,
      content TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(type, version)
    )`,

    // Create legal_acceptances table for audit trail
    `CREATE TABLE IF NOT EXISTS legal_acceptances (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      document_version TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT
    )`,

    // Index for quick lookups
    `CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON legal_acceptances(user_id, document_type)`
  ];

  for (const sql of statements) {
    await knex.raw(sql);
  }
};

exports.down = async (knex) => {
  const statements = [
    `DROP TABLE IF EXISTS legal_acceptances CASCADE`,
    `DROP TABLE IF EXISTS legal_documents CASCADE`,
    `ALTER TABLE users DROP COLUMN IF EXISTS tos_accepted_at`,
    `ALTER TABLE users DROP COLUMN IF EXISTS tos_version`,
    `ALTER TABLE users DROP COLUMN IF EXISTS privacy_accepted_at`,
    `ALTER TABLE users DROP COLUMN IF EXISTS privacy_version`
  ];

  for (const sql of statements) {
    await knex.raw(sql);
  }
};

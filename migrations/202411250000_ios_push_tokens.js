exports.up = async (knex) => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS ios_push_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL DEFAULT 'ios',
      fail_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_ios_push_tokens_user ON ios_push_tokens(user_id, updated_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_ios_push_tokens_token ON ios_push_tokens(token);`
  ];

  for (const sql of statements) {
    await knex.raw(sql);
  }
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS ios_push_tokens CASCADE;');
};

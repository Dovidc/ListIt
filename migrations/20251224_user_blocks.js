exports.up = async function (knex) {
  // Create user_blocks table for blocking users
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      id SERIAL PRIMARY KEY,
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE (blocker_id, blocked_id)
    )
  `);

  // Add indexes for faster lookups
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id)');

  // Add is_system_message column to messages table for system notifications
  await knex.raw('ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_system_message INTEGER DEFAULT 0');

  // Allow sender_id to be NULL for system messages
  await knex.raw('ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL');
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS user_blocks CASCADE');
  await knex.raw('ALTER TABLE messages DROP COLUMN IF EXISTS is_system_message');
};

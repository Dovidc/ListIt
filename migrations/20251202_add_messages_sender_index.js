/**
 * Add composite index on messages for efficient "latest message by sender in conversation" queries.
 * Covers queries like: SELECT MAX(created_at) FROM messages WHERE conversation_id = ? AND sender_id = ?
 */
exports.up = function(knex) {
  return knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender
    ON messages(conversation_id, sender_id, created_at DESC)
  `);
};

exports.down = function(knex) {
  return knex.raw(`DROP INDEX IF EXISTS idx_messages_conversation_sender`);
};

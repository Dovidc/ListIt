/**
 * Add Apple IAP columns to users table for tracking iOS subscriptions.
 */
exports.up = async (knex) => {
  const hasAppleTransactionId = await knex.schema.hasColumn('users', 'apple_original_transaction_id');
  const hasAppleExpires = await knex.schema.hasColumn('users', 'apple_subscription_expires_at');

  if (!hasAppleTransactionId || !hasAppleExpires) {
    await knex.schema.alterTable('users', (table) => {
      if (!hasAppleTransactionId) {
        table.text('apple_original_transaction_id').nullable().defaultTo(null);
      }
      if (!hasAppleExpires) {
        table.text('apple_subscription_expires_at').nullable().defaultTo(null);
      }
    });
  }
};

exports.down = async (knex) => {
  const hasAppleTransactionId = await knex.schema.hasColumn('users', 'apple_original_transaction_id');
  const hasAppleExpires = await knex.schema.hasColumn('users', 'apple_subscription_expires_at');

  if (hasAppleTransactionId || hasAppleExpires) {
    await knex.schema.alterTable('users', (table) => {
      if (hasAppleTransactionId) {
        table.dropColumn('apple_original_transaction_id');
      }
      if (hasAppleExpires) {
        table.dropColumn('apple_subscription_expires_at');
      }
    });
  }
};

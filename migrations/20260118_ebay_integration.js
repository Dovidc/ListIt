/**
 * eBay Integration Migration
 *
 * Creates tables for:
 * - ebay_connections: OAuth tokens and user connection status
 * - ebay_listings: Cross-posted listings tracking
 * - ebay_sync_logs: Audit log for API interactions
 * - ebay_category_mappings: Category suggestion cache
 *
 * Also adds sold_on and sold_at columns to listings table.
 */
exports.up = async (knex) => {
  const statements = [
    // eBay Connections table - stores OAuth tokens for each user
    `CREATE TABLE IF NOT EXISTS ebay_connections (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- eBay Account Info
      ebay_user_id TEXT NOT NULL,
      ebay_username TEXT,

      -- OAuth Tokens (encrypted at rest via application layer)
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at TEXT NOT NULL,

      -- Connection Metadata
      scopes TEXT,
      connected_at TEXT NOT NULL,
      last_refreshed_at TEXT,

      -- Status: active, expired, revoked, error
      status TEXT DEFAULT 'active',
      error_message TEXT,

      -- Cross-Posting Settings
      cross_post_enabled INTEGER DEFAULT 0,

      -- Audit
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,

      -- Constraints
      UNIQUE(user_id),
      UNIQUE(ebay_user_id)
    );`,

    // eBay Listings table - tracks cross-posted listings
    `CREATE TABLE IF NOT EXISTS ebay_listings (
      id SERIAL PRIMARY KEY,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      ebay_connection_id INTEGER NOT NULL REFERENCES ebay_connections(id) ON DELETE CASCADE,

      -- eBay Identifiers
      ebay_listing_id TEXT,
      ebay_sku TEXT NOT NULL,
      ebay_offer_id TEXT,

      -- Listing Details (cached from eBay)
      ebay_title TEXT,
      ebay_price REAL,
      ebay_category_id TEXT,
      ebay_category_name TEXT,
      ebay_url TEXT,

      -- Status: pending, publishing, active, sold, ended, error
      status TEXT NOT NULL DEFAULT 'pending',

      -- Sale Info
      sold_at TEXT,
      sale_price REAL,
      buyer_username TEXT,

      -- Error Tracking
      last_error TEXT,
      error_count INTEGER DEFAULT 0,
      last_error_at TEXT,

      -- Sync Tracking
      last_synced_at TEXT,
      sync_version INTEGER DEFAULT 0,

      -- Audit
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      ended_at TEXT,

      -- Constraints
      UNIQUE(listing_id),
      UNIQUE(ebay_sku)
    );`,

    // eBay Sync Logs table - audit trail for all eBay API interactions
    `CREATE TABLE IF NOT EXISTS ebay_sync_logs (
      id SERIAL PRIMARY KEY,
      ebay_listing_id INTEGER REFERENCES ebay_listings(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

      -- Operation Info
      operation TEXT NOT NULL,
      direction TEXT NOT NULL,

      -- Request/Response (stored as JSON text)
      request_payload TEXT,
      response_payload TEXT,
      response_status INTEGER,

      -- Result
      success INTEGER NOT NULL,
      error_message TEXT,
      error_code TEXT,

      -- Timing
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,

      -- Metadata
      idempotency_key TEXT,
      retry_count INTEGER DEFAULT 0,

      created_at TEXT NOT NULL
    );`,

    // eBay Category Mappings table - cache for category suggestions
    `CREATE TABLE IF NOT EXISTS ebay_category_mappings (
      id SERIAL PRIMARY KEY,

      -- Input
      keywords TEXT NOT NULL,

      -- eBay Category
      ebay_category_id TEXT NOT NULL,
      ebay_category_name TEXT NOT NULL,
      ebay_category_path TEXT,

      -- Metadata
      confidence_score REAL,
      use_count INTEGER DEFAULT 0,

      -- Cache Control
      fetched_at TEXT NOT NULL,
      expires_at TEXT,

      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,

      UNIQUE(keywords, ebay_category_id)
    );`,

    // Indexes for ebay_connections
    `CREATE INDEX IF NOT EXISTS idx_ebay_connections_user_id ON ebay_connections(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ebay_connections_token_expires ON ebay_connections(token_expires_at);`,
    `CREATE INDEX IF NOT EXISTS idx_ebay_connections_status ON ebay_connections(status);`,

    // Indexes for ebay_listings
    `CREATE INDEX IF NOT EXISTS idx_ebay_listings_listing_id ON ebay_listings(listing_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ebay_listings_ebay_listing_id ON ebay_listings(ebay_listing_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ebay_listings_status ON ebay_listings(status);`,
    `CREATE INDEX IF NOT EXISTS idx_ebay_listings_connection ON ebay_listings(ebay_connection_id);`,

    // Indexes for ebay_sync_logs
    `CREATE INDEX IF NOT EXISTS idx_ebay_sync_logs_listing ON ebay_sync_logs(ebay_listing_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ebay_sync_logs_user ON ebay_sync_logs(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ebay_sync_logs_created ON ebay_sync_logs(created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_ebay_sync_logs_operation ON ebay_sync_logs(operation);`,

    // Indexes for ebay_category_mappings
    `CREATE INDEX IF NOT EXISTS idx_ebay_category_mappings_keywords ON ebay_category_mappings(keywords);`
  ];

  for (const sql of statements) {
    await knex.raw(sql);
  }

  // Add sold_on and sold_at columns to listings table if they don't exist
  const hasSoldOn = await knex.schema.hasColumn('listings', 'sold_on');
  const hasSoldAt = await knex.schema.hasColumn('listings', 'sold_at');

  if (!hasSoldOn || !hasSoldAt) {
    await knex.schema.alterTable('listings', (table) => {
      if (!hasSoldOn) {
        // Possible values: NULL, 'trovelr', 'ebay', 'facebook'
        table.text('sold_on').nullable().defaultTo(null);
      }
      if (!hasSoldAt) {
        table.text('sold_at').nullable().defaultTo(null);
      }
    });
  }
};

exports.down = async (knex) => {
  // Drop tables in reverse dependency order
  const tables = [
    'ebay_sync_logs',
    'ebay_category_mappings',
    'ebay_listings',
    'ebay_connections'
  ];

  for (const table of tables) {
    await knex.raw(`DROP TABLE IF EXISTS ${table} CASCADE;`);
  }

  // Remove columns from listings table
  const hasSoldOn = await knex.schema.hasColumn('listings', 'sold_on');
  const hasSoldAt = await knex.schema.hasColumn('listings', 'sold_at');

  if (hasSoldOn || hasSoldAt) {
    await knex.schema.alterTable('listings', (table) => {
      if (hasSoldOn) {
        table.dropColumn('sold_on');
      }
      if (hasSoldAt) {
        table.dropColumn('sold_at');
      }
    });
  }
};

exports.up = async (knex) => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      username TEXT UNIQUE,
      reset_token_hash TEXT,
      reset_token_expires_at TEXT,
      is_admin INTEGER DEFAULT 0,
      paypal_email TEXT,
      location_preset TEXT,
      account_status TEXT DEFAULT 'active',
      status_note TEXT,
      status_updated_at TEXT,
      last_login_at TEXT,
      email_verification_code_hash TEXT,
      email_verification_expires_at TEXT,
      supporter_badge TEXT,
      supporter_since TEXT,
      supporter_checkout_id TEXT,
      profile_bg_image_url TEXT,
      profile_about TEXT,
      profile_picture_url TEXT,
      supporter_tier TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT,
      subscription_current_period_end TEXT,
      stripe_customer_id TEXT,
      karma INTEGER DEFAULT 0,
      profile_bg_video_url TEXT,
      profile_avatar_border_color TEXT DEFAULT '#ffffff',
      profile_avatar_border_style TEXT DEFAULT 'solid'
    );`,
    `CREATE TABLE IF NOT EXISTS listings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      image_data TEXT,
      title TEXT,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      price REAL NOT NULL,
      created_at TEXT NOT NULL,
      tags TEXT,
      lat REAL,
      lon REAL,
      enable_nearby INTEGER DEFAULT 0,
      inquiry_enabled INTEGER DEFAULT 0,
      sold INTEGER DEFAULT 0,
      is_test_listing INTEGER DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS listing_images (
      id SERIAL PRIMARY KEY,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      image_data TEXT,
      position INTEGER NOT NULL,
      key TEXT,
      url TEXT,
      width INTEGER,
      height INTEGER,
      bytes INTEGER,
      created_at INTEGER DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS listing_upload_drafts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      key TEXT NOT NULL,
      url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      bytes INTEGER,
      created_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      a_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      b_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
      a_deleted_at TEXT,
      b_deleted_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (a_user_id, b_user_id, listing_id)
    );`,
    `CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS message_images (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      image_data TEXT,
      position INTEGER NOT NULL,
      key TEXT,
      url TEXT,
      width INTEGER,
      height INTEGER,
      bytes INTEGER,
      created_at INTEGER DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      expiration_time INTEGER,
      fail_count INTEGER DEFAULT 0,
      last_failed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS karma_transactions (
      id SERIAL PRIMARY KEY,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seller_points INTEGER NOT NULL,
      buyer_points INTEGER NOT NULL,
      awarded BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS ads (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      target_url TEXT NOT NULL,
      image_url TEXT,
      cta_label TEXT,
      background TEXT,
      is_active INTEGER DEFAULT 1,
      position INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS seller_reports (
      id SERIAL PRIMARY KEY,
      reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
      reasons TEXT NOT NULL,
      details TEXT,
      captcha_question TEXT,
      created_at TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      admin_note TEXT,
      resolved_at TEXT,
      resolved_by INTEGER REFERENCES users(id),
      resolved_note TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS listing_cities (
      city TEXT PRIMARY KEY,
      slug TEXT UNIQUE,
      count INTEGER DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS flagged_attempts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
      listing_title TEXT,
      details TEXT,
      flagged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
    `CREATE INDEX IF NOT EXISTS idx_listing_upload_drafts_user ON listing_upload_drafts(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id, id);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_lat_lon ON listings(lat, lon);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_price_desc ON listings(price DESC, id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_price_asc ON listings(price ASC, id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_enable_nearby_lat_lon ON listings(enable_nearby, lat, lon, id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_location_lower ON listings(LOWER(location));`,
    `CREATE INDEX IF NOT EXISTS idx_listings_sold ON listings(sold, id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images(listing_id, position);`,
    `CREATE INDEX IF NOT EXISTS idx_msg_imgs_msg ON message_images(message_id, position);`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_a_user ON conversations(a_user_id, id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_b_user ON conversations(b_user_id, id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id, updated_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_karma_listing ON karma_transactions(listing_id);`,
    `CREATE INDEX IF NOT EXISTS idx_karma_seller ON karma_transactions(seller_id);`,
    `CREATE INDEX IF NOT EXISTS idx_karma_buyer ON karma_transactions(buyer_id);`,
    `CREATE INDEX IF NOT EXISTS idx_ads_active ON ads(is_active, position DESC, id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_seller_reports_reported ON seller_reports(reported_user_id, status);`,
    `CREATE INDEX IF NOT EXISTS idx_seller_reports_created ON seller_reports(created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_listing_cities_slug ON listing_cities(slug);`,
    `CREATE INDEX IF NOT EXISTS idx_flagged_attempts_flagged_at ON flagged_attempts(flagged_at DESC, id DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_title_trgm ON listings USING gin (LOWER(title) gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_description_trgm ON listings USING gin (LOWER(description) gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_tags_trgm ON listings USING gin (LOWER(COALESCE(tags, '')) gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS idx_listings_location_trgm ON listings USING gin (LOWER(location) gin_trgm_ops);`
  ];

  for (const sql of statements) {
    // eslint-disable-next-line no-await-in-loop
    await knex.raw(sql);
  }
};

exports.down = async (knex) => {
  const tables = [
    'flagged_attempts',
    'listing_cities',
    'seller_reports',
    'ads',
    'karma_transactions',
    'push_subscriptions',
    'message_images',
    'messages',
    'conversations',
    'listing_upload_drafts',
    'listing_images',
    'listings',
    'users'
  ];

  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    await knex.raw(`DROP TABLE IF EXISTS ${table} CASCADE;`);
  }
};

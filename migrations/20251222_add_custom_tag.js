exports.up = async (knex) => {
  // custom_tag is a short text field (max 12 chars) for premium users to add a custom badge to their listings
  await knex.raw(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS custom_tag TEXT DEFAULT NULL;`);
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE listings DROP COLUMN IF EXISTS custom_tag;`);
};

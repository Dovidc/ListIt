exports.up = async (knex) => {
  // custom_tag_color stores the hex color for the custom tag badge (e.g., "#6366f1")
  await knex.raw(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS custom_tag_color TEXT DEFAULT NULL;`);
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE listings DROP COLUMN IF EXISTS custom_tag_color;`);
};

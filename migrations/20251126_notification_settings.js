exports.up = async (knex) => {
  // Check if columns already exist before adding them
  const hasNotificationsDisabled = await knex.schema.hasColumn('users', 'notifications_disabled');
  const hasQuietHoursEnabled = await knex.schema.hasColumn('users', 'quiet_hours_enabled');
  const hasQuietHoursStart = await knex.schema.hasColumn('users', 'quiet_hours_start');
  const hasQuietHoursEnd = await knex.schema.hasColumn('users', 'quiet_hours_end');

  await knex.schema.alterTable('users', (table) => {
    if (!hasNotificationsDisabled) {
      table.boolean('notifications_disabled').defaultTo(false);
    }
    if (!hasQuietHoursEnabled) {
      table.boolean('quiet_hours_enabled').defaultTo(false);
    }
    if (!hasQuietHoursStart) {
      table.string('quiet_hours_start', 5).defaultTo('20:30');
    }
    if (!hasQuietHoursEnd) {
      table.string('quiet_hours_end', 5).defaultTo('09:30');
    }
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('notifications_disabled');
    table.dropColumn('quiet_hours_enabled');
    table.dropColumn('quiet_hours_start');
    table.dropColumn('quiet_hours_end');
  });
};

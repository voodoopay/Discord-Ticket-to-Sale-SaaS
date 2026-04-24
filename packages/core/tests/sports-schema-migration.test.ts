import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('sports schema migration', () => {
  it('includes a compatibility migration for legacy sports_guild_configs columns', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'drizzle/migrations/0026_sports_config_legacy_columns.sql',
    );
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('sports_guild_configs');
    expect(migration).toContain('managed_category_channel_id_legacy');
    expect(migration).toContain('managed_category_channel_id');
    expect(migration).toContain('live_category_channel_id_legacy');
    expect(migration).toContain('live_category_channel_id');
    expect(migration).toContain('broadcast_country_legacy');
    expect(migration).toContain('broadcast_country');
    expect(migration).toContain('information_schema.columns');
  });

  it('includes the shared broadcast countries and live score message migration', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'drizzle/migrations/0027_sports_broadcast_countries.sql',
    );
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('sports_guild_configs');
    expect(migration).toContain('broadcast_countries');
    expect(migration).toContain("ADD COLUMN `broadcast_countries` json DEFAULT ('[]')");
    expect(migration).toContain('JSON_ARRAY(`broadcast_country`)');
    expect(migration).toContain("MODIFY COLUMN `broadcast_countries` json DEFAULT ('[]') NOT NULL");
    expect(migration).toContain('sports_live_event_channels');
    expect(migration).toContain('score_message_id');
  });

  it('includes the sports channel bindings repair migration', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'drizzle/migrations/0028_repair_sports_channel_bindings.sql',
    );
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('sports_channel_bindings');
    expect(migration).toContain('profile_id');
    expect(migration).toContain('ROW_NUMBER() OVER');
    expect(migration).toContain('sports_channel_bindings_guild_sport_uq');
    expect(migration).toContain('DROP INDEX `sports_channel_bindings_profile_sport_uq`');
    expect(migration).toContain('DROP COLUMN `profile_id`');
  });

  it('includes the sports live event channel repair migration', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'drizzle/migrations/0033_repair_sports_live_event_channels.sql',
    );
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('sports_live_event_channels');
    expect(migration).toContain('sports_live_event_channels_profile_event_uq');
    expect(migration).toContain('DROP COLUMN `profile_id`');
    expect(migration).toContain('ROW_NUMBER() OVER');
    expect(migration).toContain('sports_live_event_channels_guild_event_uq');
    expect(migration).toContain('HAVING COUNT(*) > 1');
  });
});

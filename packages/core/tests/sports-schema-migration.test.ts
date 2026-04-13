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
});

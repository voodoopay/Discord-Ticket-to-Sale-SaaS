import { and, eq, lte } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import { sportsChannelBindings, sportsGuildConfigs } from '../infra/db/schema/index.js';

export type SportsGuildConfigRecord = {
  id: string;
  guildId: string;
  enabled: boolean;
  managedCategoryChannelId: string | null;
  liveCategoryChannelId?: string | null;
  localTimeHhmm: string;
  timezone: string;
  broadcastCountry: string;
  nextRunAtUtc: Date;
  lastRunAtUtc: Date | null;
  lastLocalRunDate: string | null;
  updatedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SportsChannelBindingRecord = {
  id: string;
  guildId: string;
  sportId: string | null;
  sportName: string;
  sportSlug: string;
  channelId: string;
  createdAt: Date;
  updatedAt: Date;
};

function mapGuildConfigRow(
  row: typeof sportsGuildConfigs.$inferSelect,
): SportsGuildConfigRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    enabled: row.enabled,
    managedCategoryChannelId: row.managedCategoryChannelId ?? null,
    liveCategoryChannelId: row.liveCategoryChannelId ?? null,
    localTimeHhmm: row.localTimeHhmm,
    timezone: row.timezone,
    broadcastCountry: row.broadcastCountry,
    nextRunAtUtc: row.nextRunAtUtc,
    lastRunAtUtc: row.lastRunAtUtc ?? null,
    lastLocalRunDate: row.lastLocalRunDate ?? null,
    updatedByDiscordUserId: row.updatedByDiscordUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapChannelBindingRow(
  row: typeof sportsChannelBindings.$inferSelect,
): SportsChannelBindingRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    sportId: row.sportId ?? null,
    sportName: row.sportName,
    sportSlug: row.sportSlug,
    channelId: row.channelId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SportsRepository {
  private readonly db = getDb();

  public async getGuildConfig(guildId: string): Promise<SportsGuildConfigRecord | null> {
    const row = await this.db.query.sportsGuildConfigs.findFirst({
      where: eq(sportsGuildConfigs.guildId, guildId),
    });

    return row ? mapGuildConfigRow(row) : null;
  }

  public async upsertGuildConfig(input: {
    guildId: string;
    managedCategoryChannelId: string | null;
    liveCategoryChannelId: string | null;
    localTimeHhmm: string;
    timezone: string;
    broadcastCountry: string;
    nextRunAtUtc: Date;
    updatedByDiscordUserId: string;
  }): Promise<SportsGuildConfigRecord> {
    const existing = await this.getGuildConfig(input.guildId);
    const now = new Date();

    if (existing) {
      await this.db
        .update(sportsGuildConfigs)
        .set({
          enabled: true,
          managedCategoryChannelId: input.managedCategoryChannelId,
          liveCategoryChannelId: input.liveCategoryChannelId,
          localTimeHhmm: input.localTimeHhmm,
          timezone: input.timezone,
          broadcastCountry: input.broadcastCountry,
          nextRunAtUtc: input.nextRunAtUtc,
          updatedByDiscordUserId: input.updatedByDiscordUserId,
          updatedAt: now,
        })
        .where(eq(sportsGuildConfigs.id, existing.id));
    } else {
      await this.db.insert(sportsGuildConfigs).values({
        id: ulid(),
        guildId: input.guildId,
        enabled: true,
        managedCategoryChannelId: input.managedCategoryChannelId,
        liveCategoryChannelId: input.liveCategoryChannelId,
        localTimeHhmm: input.localTimeHhmm,
        timezone: input.timezone,
        broadcastCountry: input.broadcastCountry,
        nextRunAtUtc: input.nextRunAtUtc,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const record = await this.getGuildConfig(input.guildId);
    if (!record) {
      throw new Error('Failed to upsert sports guild config');
    }

    return record;
  }

  public async listDueGuildConfigs(input: {
    now: Date;
    limit: number;
  }): Promise<SportsGuildConfigRecord[]> {
    const rows = await this.db.query.sportsGuildConfigs.findMany({
      where: and(
        eq(sportsGuildConfigs.enabled, true),
        lte(sportsGuildConfigs.nextRunAtUtc, input.now),
      ),
      orderBy: (table, { asc }) => [asc(table.nextRunAtUtc)],
      limit: input.limit,
    });

    return rows.map(mapGuildConfigRow);
  }

  public async setNextRunAt(input: {
    guildId: string;
    nextRunAtUtc: Date;
    updatedByDiscordUserId: string | null;
    lastRunAtUtc?: Date | null;
    lastLocalRunDate?: string | null;
  }): Promise<void> {
    await this.db
      .update(sportsGuildConfigs)
      .set({
        nextRunAtUtc: input.nextRunAtUtc,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
        lastRunAtUtc: input.lastRunAtUtc ?? undefined,
        lastLocalRunDate: input.lastLocalRunDate ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(sportsGuildConfigs.guildId, input.guildId));
  }

  public async listChannelBindings(guildId: string): Promise<SportsChannelBindingRecord[]> {
    const rows = await this.db.query.sportsChannelBindings.findMany({
      where: eq(sportsChannelBindings.guildId, guildId),
      orderBy: (table, { asc }) => [asc(table.sportName)],
    });

    return rows.map(mapChannelBindingRow);
  }

  public async getChannelBindingBySport(input: {
    guildId: string;
    sportName: string;
  }): Promise<SportsChannelBindingRecord | null> {
    const row = await this.db.query.sportsChannelBindings.findFirst({
      where: and(
        eq(sportsChannelBindings.guildId, input.guildId),
        eq(sportsChannelBindings.sportName, input.sportName),
      ),
    });

    return row ? mapChannelBindingRow(row) : null;
  }

  public async upsertChannelBinding(input: {
    guildId: string;
    sportId: string | null;
    sportName: string;
    sportSlug: string;
    channelId: string;
  }): Promise<SportsChannelBindingRecord> {
    const existing = await this.getChannelBindingBySport({
      guildId: input.guildId,
      sportName: input.sportName,
    });
    const now = new Date();

    if (existing) {
      await this.db
        .update(sportsChannelBindings)
        .set({
          sportId: input.sportId,
          sportSlug: input.sportSlug,
          channelId: input.channelId,
          updatedAt: now,
        })
        .where(eq(sportsChannelBindings.id, existing.id));
    } else {
      await this.db.insert(sportsChannelBindings).values({
        id: ulid(),
        guildId: input.guildId,
        sportId: input.sportId,
        sportName: input.sportName,
        sportSlug: input.sportSlug,
        channelId: input.channelId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const record = await this.getChannelBindingBySport({
      guildId: input.guildId,
      sportName: input.sportName,
    });
    if (!record) {
      throw new Error('Failed to upsert sports channel binding');
    }

    return record;
  }
}

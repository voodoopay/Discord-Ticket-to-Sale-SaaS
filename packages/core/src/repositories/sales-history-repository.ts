import { and, eq, lte } from 'drizzle-orm';

import { getDb } from '../infra/db/client.js';
import { guildConfigs } from '../infra/db/schema/index.js';
import type { SalesHistoryAutoClearFrequency } from '../services/sales-history-schedule.js';

export type SalesHistoryAutoClearRecord = {
  tenantId: string;
  guildId: string;
  clearedAt: Date | null;
  autoClearEnabled: boolean;
  autoClearFrequency: SalesHistoryAutoClearFrequency;
  autoClearLocalTimeHhMm: string;
  autoClearTimezone: string;
  autoClearDayOfWeek: number | null;
  autoClearDayOfMonth: number | null;
  autoClearNextRunAtUtc: Date | null;
  autoClearLastRunAtUtc: Date | null;
  autoClearLastLocalRunDate: string | null;
};

function mapAutoClearRow(
  row: typeof guildConfigs.$inferSelect,
): SalesHistoryAutoClearRecord {
  return {
    tenantId: row.tenantId,
    guildId: row.guildId,
    clearedAt: row.salesHistoryClearedAt ?? null,
    autoClearEnabled: row.salesHistoryAutoClearEnabled,
    autoClearFrequency: row.salesHistoryAutoClearFrequency,
    autoClearLocalTimeHhMm: row.salesHistoryAutoClearLocalTimeHhMm,
    autoClearTimezone: row.salesHistoryAutoClearTimezone,
    autoClearDayOfWeek: row.salesHistoryAutoClearDayOfWeek ?? null,
    autoClearDayOfMonth: row.salesHistoryAutoClearDayOfMonth ?? null,
    autoClearNextRunAtUtc: row.salesHistoryAutoClearNextRunAtUtc ?? null,
    autoClearLastRunAtUtc: row.salesHistoryAutoClearLastRunAtUtc ?? null,
    autoClearLastLocalRunDate: row.salesHistoryAutoClearLastLocalRunDate ?? null,
  };
}

export class SalesHistoryRepository {
  private readonly db = getDb();

  public async getGuildAutoClearConfig(input: {
    tenantId: string;
    guildId: string;
  }): Promise<SalesHistoryAutoClearRecord | null> {
    const row = await this.db.query.guildConfigs.findFirst({
      where: and(eq(guildConfigs.tenantId, input.tenantId), eq(guildConfigs.guildId, input.guildId)),
    });

    return row ? mapAutoClearRow(row) : null;
  }

  public async listDueGuildAutoClears(input: {
    now: Date;
    limit: number;
  }): Promise<SalesHistoryAutoClearRecord[]> {
    const rows = await this.db.query.guildConfigs.findMany({
      where: and(
        eq(guildConfigs.salesHistoryAutoClearEnabled, true),
        lte(guildConfigs.salesHistoryAutoClearNextRunAtUtc, input.now),
      ),
      orderBy: (table, { asc }) => [asc(table.salesHistoryAutoClearNextRunAtUtc)],
      limit: input.limit,
    });

    return rows.map(mapAutoClearRow);
  }

  public async clearGuildHistory(input: {
    tenantId: string;
    guildId: string;
    clearedAt: Date;
  }): Promise<void> {
    await this.db
      .update(guildConfigs)
      .set({
        salesHistoryClearedAt: input.clearedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(guildConfigs.tenantId, input.tenantId), eq(guildConfigs.guildId, input.guildId)));
  }

  public async completeAutoClearRun(input: {
    tenantId: string;
    guildId: string;
    clearedAt: Date;
    nextRunAtUtc: Date;
    lastRunAtUtc: Date;
    lastLocalRunDate: string;
  }): Promise<void> {
    await this.db
      .update(guildConfigs)
      .set({
        salesHistoryClearedAt: input.clearedAt,
        salesHistoryAutoClearNextRunAtUtc: input.nextRunAtUtc,
        salesHistoryAutoClearLastRunAtUtc: input.lastRunAtUtc,
        salesHistoryAutoClearLastLocalRunDate: input.lastLocalRunDate,
        updatedAt: new Date(),
      })
      .where(and(eq(guildConfigs.tenantId, input.tenantId), eq(guildConfigs.guildId, input.guildId)));
  }
}

import { and, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import { sportsLiveEventChannels } from '../infra/db/schema/index.js';

export type SportsLiveEventChannelRecord = {
  id: string;
  guildId: string;
  sportName: string;
  eventId: string;
  eventName: string;
  sportChannelId: string;
  eventChannelId: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'cleanup_due' | 'deleted' | 'failed';
  kickoffAtUtc: Date;
  lastScoreSnapshot: Record<string, unknown> | null;
  lastStateSnapshot: Record<string, unknown> | null;
  lastSyncedAtUtc: Date | null;
  finishedAtUtc: Date | null;
  deleteAfterUtc: Date | null;
  highlightsPosted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function mapSportsLiveEventChannelRow(
  row: typeof sportsLiveEventChannels.$inferSelect,
): SportsLiveEventChannelRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    sportName: row.sportName,
    eventId: row.eventId,
    eventName: row.eventName,
    sportChannelId: row.sportChannelId,
    eventChannelId: row.eventChannelId ?? null,
    status: row.status,
    kickoffAtUtc: row.kickoffAtUtc,
    lastScoreSnapshot: row.lastScoreSnapshot ?? null,
    lastStateSnapshot: row.lastStateSnapshot ?? null,
    lastSyncedAtUtc: row.lastSyncedAtUtc ?? null,
    finishedAtUtc: row.finishedAtUtc ?? null,
    deleteAfterUtc: row.deleteAfterUtc ?? null,
    highlightsPosted: row.highlightsPosted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SportsLiveEventRepository {
  private readonly db = getDb();

  public async getTrackedEvent(input: {
    guildId: string;
    eventId: string;
  }): Promise<SportsLiveEventChannelRecord | null> {
    const row = await this.db.query.sportsLiveEventChannels.findFirst({
      where: and(
        eq(sportsLiveEventChannels.guildId, input.guildId),
        eq(sportsLiveEventChannels.eventId, input.eventId),
      ),
    });

    return row ? mapSportsLiveEventChannelRow(row) : null;
  }

  public async listTrackedEvents(input: {
    guildId: string;
    statuses?: SportsLiveEventChannelRecord['status'][];
  }): Promise<SportsLiveEventChannelRecord[]> {
    const rows = await this.db.query.sportsLiveEventChannels.findMany({
      where:
        input.statuses && input.statuses.length > 0
          ? and(
              eq(sportsLiveEventChannels.guildId, input.guildId),
              inArray(sportsLiveEventChannels.status, input.statuses),
            )
          : eq(sportsLiveEventChannels.guildId, input.guildId),
    });

    return rows.map((row) => mapSportsLiveEventChannelRow(row));
  }

  public async markHighlightsPosted(input: {
    guildId: string;
    eventId: string;
    postedAtUtc: Date;
  }): Promise<SportsLiveEventChannelRecord | null> {
    await this.db
      .update(sportsLiveEventChannels)
      .set({
        highlightsPosted: true,
        lastSyncedAtUtc: input.postedAtUtc,
        updatedAt: input.postedAtUtc,
      })
      .where(
        and(
          eq(sportsLiveEventChannels.guildId, input.guildId),
          eq(sportsLiveEventChannels.eventId, input.eventId),
        ),
      );

    return this.getTrackedEvent({
      guildId: input.guildId,
      eventId: input.eventId,
    });
  }

  public async markFailed(input: {
    guildId: string;
    eventId: string;
    failedAtUtc: Date;
  }): Promise<SportsLiveEventChannelRecord | null> {
    await this.db
      .update(sportsLiveEventChannels)
      .set({
        status: 'failed',
        lastSyncedAtUtc: input.failedAtUtc,
        updatedAt: input.failedAtUtc,
      })
      .where(
        and(
          eq(sportsLiveEventChannels.guildId, input.guildId),
          eq(sportsLiveEventChannels.eventId, input.eventId),
        ),
      );

    return this.getTrackedEvent({
      guildId: input.guildId,
      eventId: input.eventId,
    });
  }

  public async upsertTrackedEvent(input: {
    guildId: string;
    sportName: string;
    eventId: string;
    eventName: string;
    sportChannelId: string;
    kickoffAtUtc: Date;
    eventChannelId: string | null;
    status: SportsLiveEventChannelRecord['status'];
    lastScoreSnapshot: Record<string, unknown> | null;
    lastStateSnapshot: Record<string, unknown> | null;
    lastSyncedAtUtc: Date | null;
    finishedAtUtc: Date | null;
    deleteAfterUtc: Date | null;
    highlightsPosted?: boolean;
  }): Promise<SportsLiveEventChannelRecord> {
    const now = new Date();

    await this.db
      .insert(sportsLiveEventChannels)
      .values({
        id: ulid(),
        guildId: input.guildId,
        sportName: input.sportName,
        eventId: input.eventId,
        eventName: input.eventName,
        sportChannelId: input.sportChannelId,
        eventChannelId: input.eventChannelId,
        status: input.status,
        kickoffAtUtc: input.kickoffAtUtc,
        lastScoreSnapshot: input.lastScoreSnapshot,
        lastStateSnapshot: input.lastStateSnapshot,
        lastSyncedAtUtc: input.lastSyncedAtUtc,
        finishedAtUtc: input.finishedAtUtc,
        deleteAfterUtc: input.deleteAfterUtc,
        highlightsPosted: input.highlightsPosted ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          sportName: input.sportName,
          eventName: input.eventName,
          sportChannelId: input.sportChannelId,
          eventChannelId: input.eventChannelId,
          status: input.status,
          kickoffAtUtc: input.kickoffAtUtc,
          lastScoreSnapshot: input.lastScoreSnapshot,
          lastStateSnapshot: input.lastStateSnapshot,
          lastSyncedAtUtc: input.lastSyncedAtUtc,
          finishedAtUtc: input.finishedAtUtc,
          deleteAfterUtc: input.deleteAfterUtc,
          highlightsPosted: input.highlightsPosted ?? false,
          updatedAt: now,
        },
      });

    const record = await this.getTrackedEvent({
      guildId: input.guildId,
      eventId: input.eventId,
    });
    if (!record) {
      throw new Error('Failed to load sports live event channel');
    }

    return record;
  }

  public async markFinished(input: {
    guildId: string;
    eventId: string;
    finishedAtUtc: Date;
    deleteAfterUtc: Date;
  }): Promise<SportsLiveEventChannelRecord | null> {
    await this.db
      .update(sportsLiveEventChannels)
      .set({
        status: 'cleanup_due',
        finishedAtUtc: input.finishedAtUtc,
        deleteAfterUtc: input.deleteAfterUtc,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sportsLiveEventChannels.guildId, input.guildId),
          eq(sportsLiveEventChannels.eventId, input.eventId),
        ),
      );

    return this.getTrackedEvent({
      guildId: input.guildId,
      eventId: input.eventId,
    });
  }

  public async markDeleted(input: {
    guildId: string;
    eventId: string;
    deletedAtUtc: Date;
  }): Promise<SportsLiveEventChannelRecord | null> {
    await this.db
      .update(sportsLiveEventChannels)
      .set({
        status: 'deleted',
        eventChannelId: null,
        lastSyncedAtUtc: input.deletedAtUtc,
        updatedAt: input.deletedAtUtc,
      })
      .where(
        and(
          eq(sportsLiveEventChannels.guildId, input.guildId),
          eq(sportsLiveEventChannels.eventId, input.eventId),
        ),
      );

    return this.getTrackedEvent({
      guildId: input.guildId,
      eventId: input.eventId,
    });
  }
}

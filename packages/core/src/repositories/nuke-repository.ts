import { and, eq, lte, or, sql } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import {
  channelNukeLocks,
  channelNukeRuns,
  channelNukeSchedules,
  orderSessions,
  ticketChannelMetadata,
} from '../infra/db/schema/index.js';

export type ChannelNukeScheduleRecord = {
  id: string;
  tenantId: string;
  guildId: string;
  channelId: string;
  enabled: boolean;
  localTimeHhmm: string;
  timezone: string;
  nextRunAtUtc: Date;
  lastRunAtUtc: Date | null;
  lastLocalRunDate: string | null;
  consecutiveFailures: number;
  updatedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const LOCK_LEASE_TIMESTAMP_TOLERANCE_MS = 999;

function mapScheduleRow(row: typeof channelNukeSchedules.$inferSelect): ChannelNukeScheduleRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guildId: row.guildId,
    channelId: row.channelId,
    enabled: row.enabled,
    localTimeHhmm: row.localTimeHhmm,
    timezone: row.timezone,
    nextRunAtUtc: row.nextRunAtUtc,
    lastRunAtUtc: row.lastRunAtUtc ?? null,
    lastLocalRunDate: row.lastLocalRunDate ?? null,
    consecutiveFailures: row.consecutiveFailures,
    updatedByDiscordUserId: row.updatedByDiscordUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hasMatchingActiveLockLease(input: {
  ownerId: string;
  requestedLeaseUntil: Date;
  now: Date;
  refreshed:
    | {
        ownerId: string;
        leaseUntil: Date;
      }
    | undefined
    | null;
}): boolean {
  if (!input.refreshed || input.refreshed.ownerId !== input.ownerId) {
    return false;
  }

  const refreshedLeaseUntilMs = input.refreshed.leaseUntil.getTime();
  if (refreshedLeaseUntilMs <= input.now.getTime()) {
    return false;
  }

  // MySQL TIMESTAMP columns default to second precision, so a successful write can
  // read back up to 999 ms earlier than the JavaScript Date we originally sent.
  return refreshedLeaseUntilMs >= input.requestedLeaseUntil.getTime() - LOCK_LEASE_TIMESTAMP_TOLERANCE_MS;
}

export class NukeRepository {
  private readonly db = getDb();

  public async getScheduleByChannel(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
  }): Promise<ChannelNukeScheduleRecord | null> {
    const row = await this.db.query.channelNukeSchedules.findFirst({
      where: and(
        eq(channelNukeSchedules.tenantId, input.tenantId),
        eq(channelNukeSchedules.guildId, input.guildId),
        eq(channelNukeSchedules.channelId, input.channelId),
      ),
    });

    return row ? mapScheduleRow(row) : null;
  }

  public async upsertSchedule(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
    localTimeHhmm: string;
    timezone: string;
    nextRunAtUtc: Date;
    updatedByDiscordUserId: string;
  }): Promise<ChannelNukeScheduleRecord> {
    const now = new Date();
    await this.db
      .insert(channelNukeSchedules)
      .values({
        id: ulid(),
        tenantId: input.tenantId,
        guildId: input.guildId,
        channelId: input.channelId,
        enabled: true,
        localTimeHhmm: input.localTimeHhmm,
        timezone: input.timezone,
        nextRunAtUtc: input.nextRunAtUtc,
        consecutiveFailures: 0,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          enabled: true,
          localTimeHhmm: input.localTimeHhmm,
          timezone: input.timezone,
          nextRunAtUtc: input.nextRunAtUtc,
          consecutiveFailures: 0,
          updatedByDiscordUserId: input.updatedByDiscordUserId,
          updatedAt: now,
        },
      });

    const createdOrUpdated = await this.getScheduleByChannel({
      tenantId: input.tenantId,
      guildId: input.guildId,
      channelId: input.channelId,
    });
    if (!createdOrUpdated) {
      throw new Error('Failed to upsert channel nuke schedule');
    }

    return createdOrUpdated;
  }

  public async disableScheduleByChannel(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
    updatedByDiscordUserId: string;
  }): Promise<boolean> {
    const existing = await this.getScheduleByChannel(input);
    if (!existing) {
      return false;
    }

    await this.db
      .update(channelNukeSchedules)
      .set({
        enabled: false,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
        updatedAt: new Date(),
      })
      .where(eq(channelNukeSchedules.id, existing.id));
    return true;
  }

  public async listDueSchedules(input: {
    now: Date;
    limit: number;
  }): Promise<ChannelNukeScheduleRecord[]> {
    const rows = await this.db.query.channelNukeSchedules.findMany({
      where: and(
        eq(channelNukeSchedules.enabled, true),
        lte(channelNukeSchedules.nextRunAtUtc, input.now),
      ),
      orderBy: (table, { asc }) => [asc(table.nextRunAtUtc)],
      limit: input.limit,
    });

    return rows.map(mapScheduleRow);
  }

  public async tryAcquireLock(input: {
    lockKey: string;
    ownerId: string;
    leaseUntil: Date;
  }): Promise<boolean> {
    const now = new Date();
    const existing = await this.db.query.channelNukeLocks.findFirst({
      where: eq(channelNukeLocks.lockKey, input.lockKey),
    });

    if (!existing) {
      try {
        await this.db.insert(channelNukeLocks).values({
          lockKey: input.lockKey,
          ownerId: input.ownerId,
          leaseUntil: input.leaseUntil,
          heartbeatAt: now,
          createdAt: now,
          updatedAt: now,
        });
        return true;
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'ER_DUP_ENTRY'
        ) {
          return false;
        }
        throw error;
      }
    }

    if (existing.ownerId !== input.ownerId && existing.leaseUntil.getTime() > now.getTime()) {
      return false;
    }

    await this.db
      .update(channelNukeLocks)
      .set({
        ownerId: input.ownerId,
        leaseUntil: input.leaseUntil,
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(channelNukeLocks.lockKey, input.lockKey),
          or(
            lte(channelNukeLocks.leaseUntil, now),
            eq(channelNukeLocks.ownerId, input.ownerId),
          ),
        ),
      );

    const refreshed = await this.db.query.channelNukeLocks.findFirst({
      where: eq(channelNukeLocks.lockKey, input.lockKey),
    });

    return hasMatchingActiveLockLease({
      ownerId: input.ownerId,
      requestedLeaseUntil: input.leaseUntil,
      now,
      refreshed,
    });
  }

  public async releaseLock(input: {
    lockKey: string;
    ownerId: string;
  }): Promise<void> {
    await this.db
      .delete(channelNukeLocks)
        .where(and(eq(channelNukeLocks.lockKey, input.lockKey), eq(channelNukeLocks.ownerId, input.ownerId)));
  }

  public async renewLockLease(input: {
    lockKey: string;
    ownerId: string;
    leaseUntil: Date;
  }): Promise<boolean> {
    const now = new Date();
    await this.db
      .update(channelNukeLocks)
      .set({
        leaseUntil: input.leaseUntil,
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(and(eq(channelNukeLocks.lockKey, input.lockKey), eq(channelNukeLocks.ownerId, input.ownerId)));

    const refreshed = await this.db.query.channelNukeLocks.findFirst({
      where: eq(channelNukeLocks.lockKey, input.lockKey),
    });

    return hasMatchingActiveLockLease({
      ownerId: input.ownerId,
      requestedLeaseUntil: input.leaseUntil,
      now,
      refreshed,
    });
  }

  public async createRun(input: {
    scheduleId: string | null;
    tenantId: string;
    guildId: string;
    channelId: string;
    triggerType: 'scheduled' | 'manual' | 'retry';
    idempotencyKey: string;
    actorDiscordUserId: string | null;
    correlationId: string;
  }): Promise<{ created: boolean; runId: string }> {
    const runId = ulid();
    try {
      await this.db.insert(channelNukeRuns).values({
        id: runId,
        scheduleId: input.scheduleId,
        tenantId: input.tenantId,
        guildId: input.guildId,
        channelId: input.channelId,
        triggerType: input.triggerType,
        idempotencyKey: input.idempotencyKey,
        status: 'queued',
        attempt: 0,
        actorDiscordUserId: input.actorDiscordUserId,
        correlationId: input.correlationId,
      });
      return { created: true, runId };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        const existing = await this.db.query.channelNukeRuns.findFirst({
          where: eq(channelNukeRuns.idempotencyKey, input.idempotencyKey),
        });
        return { created: false, runId: existing?.id ?? runId };
      }
      throw error;
    }
  }

  public async markRunStarted(runId: string): Promise<void> {
    await this.db
      .update(channelNukeRuns)
      .set({
        status: 'running',
        attempt: 1,
        startedAt: new Date(),
      })
      .where(eq(channelNukeRuns.id, runId));
  }

  public async markRunSuccess(input: {
    runId: string;
    oldChannelId: string;
    newChannelId: string;
  }): Promise<void> {
    await this.db
      .update(channelNukeRuns)
      .set({
        status: 'success',
        oldChannelId: input.oldChannelId,
        newChannelId: input.newChannelId,
        finishedAt: new Date(),
      })
      .where(eq(channelNukeRuns.id, input.runId));
  }

  public async markRunPartial(input: {
    runId: string;
    oldChannelId: string;
    newChannelId: string | null;
    errorMessage: string;
  }): Promise<void> {
    await this.db
      .update(channelNukeRuns)
      .set({
        status: 'partial',
        oldChannelId: input.oldChannelId,
        newChannelId: input.newChannelId,
        errorMessage: input.errorMessage,
        finishedAt: new Date(),
      })
      .where(eq(channelNukeRuns.id, input.runId));
  }

  public async markRunFailed(input: {
    runId: string;
    errorMessage: string;
  }): Promise<void> {
    await this.db
      .update(channelNukeRuns)
      .set({
        status: 'failed',
        errorMessage: input.errorMessage,
        finishedAt: new Date(),
      })
      .where(eq(channelNukeRuns.id, input.runId));
  }

  public async bumpScheduleFailure(input: {
    scheduleId: string;
    updatedByDiscordUserId: string | null;
  }): Promise<ChannelNukeScheduleRecord | null> {
    const now = new Date();
    await this.db
      .update(channelNukeSchedules)
      .set({
        consecutiveFailures: sql`${channelNukeSchedules.consecutiveFailures} + 1`,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
        updatedAt: now,
      })
      .where(eq(channelNukeSchedules.id, input.scheduleId));

    const refreshed = await this.db.query.channelNukeSchedules.findFirst({
      where: eq(channelNukeSchedules.id, input.scheduleId),
    });
    return refreshed ? mapScheduleRow(refreshed) : null;
  }

  public async disableScheduleById(input: {
    scheduleId: string;
    updatedByDiscordUserId: string | null;
  }): Promise<void> {
    await this.db
      .update(channelNukeSchedules)
      .set({
        enabled: false,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
        updatedAt: new Date(),
      })
      .where(eq(channelNukeSchedules.id, input.scheduleId));
  }

  public async setScheduleNextRunById(input: {
    scheduleId: string;
    nextRunAtUtc: Date;
    updatedByDiscordUserId: string | null;
    lastLocalRunDate?: string | null;
    lastRunAtUtc?: Date | null;
  }): Promise<void> {
    await this.db
      .update(channelNukeSchedules)
      .set({
        nextRunAtUtc: input.nextRunAtUtc,
        lastLocalRunDate: input.lastLocalRunDate ?? undefined,
        lastRunAtUtc: input.lastRunAtUtc ?? undefined,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
        updatedAt: new Date(),
      })
      .where(eq(channelNukeSchedules.id, input.scheduleId));
  }

  public async finalizeSuccessfulNuke(input: {
    tenantId: string;
    guildId: string;
    oldChannelId: string;
    newChannelId: string;
    scheduleId: string | null;
    nextRunAtUtc: Date | null;
    lastLocalRunDate: string | null;
    updatedByDiscordUserId: string | null;
  }): Promise<void> {
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const scheduleById =
        input.scheduleId && input.nextRunAtUtc && input.lastLocalRunDate
          ? await tx.query.channelNukeSchedules.findFirst({
              where: eq(channelNukeSchedules.id, input.scheduleId),
            })
          : null;

      if (scheduleById && input.nextRunAtUtc && input.lastLocalRunDate) {
        await tx
          .update(channelNukeSchedules)
          .set({
            channelId: input.newChannelId,
            nextRunAtUtc: input.nextRunAtUtc,
            lastRunAtUtc: now,
            lastLocalRunDate: input.lastLocalRunDate,
            consecutiveFailures: 0,
            updatedByDiscordUserId: input.updatedByDiscordUserId,
            updatedAt: now,
          })
          .where(eq(channelNukeSchedules.id, scheduleById.id));
      } else {
        await tx
          .update(channelNukeSchedules)
          .set({
            channelId: input.newChannelId,
            updatedByDiscordUserId: input.updatedByDiscordUserId,
            updatedAt: now,
          })
          .where(
            and(
              eq(channelNukeSchedules.tenantId, input.tenantId),
              eq(channelNukeSchedules.guildId, input.guildId),
              eq(channelNukeSchedules.channelId, input.oldChannelId),
            ),
          );
      }

      await tx
        .update(ticketChannelMetadata)
        .set({
          channelId: input.newChannelId,
          updatedAt: now,
        })
        .where(
          and(
            eq(ticketChannelMetadata.tenantId, input.tenantId),
            eq(ticketChannelMetadata.guildId, input.guildId),
            eq(ticketChannelMetadata.channelId, input.oldChannelId),
          ),
        );

      await tx
        .update(orderSessions)
        .set({
          ticketChannelId: input.newChannelId,
          updatedAt: now,
        })
        .where(
          and(
            eq(orderSessions.tenantId, input.tenantId),
            eq(orderSessions.guildId, input.guildId),
            eq(orderSessions.ticketChannelId, input.oldChannelId),
            eq(orderSessions.status, 'pending_payment'),
          ),
        );
    });
  }
}

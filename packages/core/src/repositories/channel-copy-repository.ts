import { and, desc, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import { channelCopyAuthorizedUsers, channelCopyJobs } from '../infra/db/schema/index.js';
import { isMysqlDuplicateEntryError } from '../utils/mysql-errors.js';

export type ChannelCopyJobStatus =
  | 'awaiting_confirmation'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

export type ChannelCopyAuthorizedUserRecord = {
  id: string;
  guildId: string;
  discordUserId: string;
  grantedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ChannelCopyJobRecord = {
  id: string;
  destinationGuildId: string;
  sourceGuildId: string;
  sourceChannelId: string;
  destinationChannelId: string;
  requestedByDiscordUserId: string;
  confirmToken: string | null;
  status: ChannelCopyJobStatus;
  forceConfirmed: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastProcessedSourceMessageId: string | null;
  scannedMessageCount: number;
  copiedMessageCount: number;
  skippedMessageCount: number;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const INCOMPLETE_CHANNEL_COPY_JOB_STATUSES: ChannelCopyJobStatus[] = [
  'awaiting_confirmation',
  'queued',
  'running',
];

function mapAuthorizedUserRow(
  row: typeof channelCopyAuthorizedUsers.$inferSelect,
): ChannelCopyAuthorizedUserRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    discordUserId: row.discordUserId,
    grantedByDiscordUserId: row.grantedByDiscordUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapJobRow(row: typeof channelCopyJobs.$inferSelect): ChannelCopyJobRecord {
  return {
    id: row.id,
    destinationGuildId: row.destinationGuildId,
    sourceGuildId: row.sourceGuildId,
    sourceChannelId: row.sourceChannelId,
    destinationChannelId: row.destinationChannelId,
    requestedByDiscordUserId: row.requestedByDiscordUserId,
    confirmToken: row.confirmToken,
    status: row.status,
    forceConfirmed: row.forceConfirmed,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    lastProcessedSourceMessageId: row.lastProcessedSourceMessageId ?? null,
    scannedMessageCount: row.scannedMessageCount,
    copiedMessageCount: row.copiedMessageCount,
    skippedMessageCount: row.skippedMessageCount,
    failureMessage: row.failureMessage ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ChannelCopyRepository {
  private readonly db = getDb();

  private async updateAuthorizedUserByGuildAndDiscordId(input: {
    guildId: string;
    discordUserId: string;
    grantedByDiscordUserId: string | null;
    updatedAt: Date;
  }): Promise<void> {
    await this.db
      .update(channelCopyAuthorizedUsers)
      .set({
        grantedByDiscordUserId: input.grantedByDiscordUserId,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(channelCopyAuthorizedUsers.guildId, input.guildId),
          eq(channelCopyAuthorizedUsers.discordUserId, input.discordUserId),
        ),
      );
  }

  private async getAuthorizedUserByDiscordId(input: {
    guildId: string;
    discordUserId: string;
  }): Promise<ChannelCopyAuthorizedUserRecord | null> {
    const row = await this.db.query.channelCopyAuthorizedUsers.findFirst({
      where: and(
        eq(channelCopyAuthorizedUsers.guildId, input.guildId),
        eq(channelCopyAuthorizedUsers.discordUserId, input.discordUserId),
      ),
      orderBy: (table, { desc: orderDesc }) => [orderDesc(table.updatedAt), orderDesc(table.createdAt)],
    });

    return row ? mapAuthorizedUserRow(row) : null;
  }

  private async getJobById(jobId: string): Promise<ChannelCopyJobRecord | null> {
    const row = await this.db.query.channelCopyJobs.findFirst({
      where: eq(channelCopyJobs.id, jobId),
    });

    return row ? mapJobRow(row) : null;
  }

  public async getJobByIdOrNull(jobId: string): Promise<ChannelCopyJobRecord | null> {
    return this.getJobById(jobId);
  }

  public async listAuthorizedUsers(input: {
    guildId: string;
  }): Promise<ChannelCopyAuthorizedUserRecord[]> {
    const rows = await this.db.query.channelCopyAuthorizedUsers.findMany({
      where: eq(channelCopyAuthorizedUsers.guildId, input.guildId),
      orderBy: (table, { desc: orderDesc }) => [orderDesc(table.updatedAt), orderDesc(table.createdAt)],
    });

    return rows.map(mapAuthorizedUserRow);
  }

  public async upsertAuthorizedUser(input: {
    guildId: string;
    discordUserId: string;
    grantedByDiscordUserId: string | null;
  }): Promise<{ created: boolean; record: ChannelCopyAuthorizedUserRecord }> {
    const existing = await this.getAuthorizedUserByDiscordId({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    const now = new Date();
    let created = false;

    if (existing) {
      await this.updateAuthorizedUserByGuildAndDiscordId({
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        grantedByDiscordUserId: input.grantedByDiscordUserId,
        updatedAt: now,
      });
    } else {
      try {
        await this.db.insert(channelCopyAuthorizedUsers).values({
          id: ulid(),
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          grantedByDiscordUserId: input.grantedByDiscordUserId,
          createdAt: now,
          updatedAt: now,
        });
        created = true;
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }

        await this.updateAuthorizedUserByGuildAndDiscordId({
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          grantedByDiscordUserId: input.grantedByDiscordUserId,
          updatedAt: now,
        });
      }
    }

    const record = await this.getAuthorizedUserByDiscordId({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    if (!record) {
      throw new Error('Failed to upsert channel copy authorized user');
    }

    return {
      created,
      record,
    };
  }

  public async revokeAuthorizedUser(input: {
    guildId: string;
    discordUserId: string;
  }): Promise<boolean> {
    const existing = await this.getAuthorizedUserByDiscordId({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    if (!existing) {
      return false;
    }

    await this.db
      .delete(channelCopyAuthorizedUsers)
      .where(
        and(
          eq(channelCopyAuthorizedUsers.guildId, input.guildId),
          eq(channelCopyAuthorizedUsers.discordUserId, input.discordUserId),
        ),
      );

    return true;
  }

  public async findLatestIncompleteJob(input: {
    sourceChannelId: string;
    destinationChannelId: string;
    requestedByDiscordUserId: string;
  }): Promise<ChannelCopyJobRecord | null> {
    const row = await this.db.query.channelCopyJobs.findFirst({
      where: and(
        eq(channelCopyJobs.sourceChannelId, input.sourceChannelId),
        eq(channelCopyJobs.destinationChannelId, input.destinationChannelId),
        eq(channelCopyJobs.requestedByDiscordUserId, input.requestedByDiscordUserId),
        inArray(channelCopyJobs.status, INCOMPLETE_CHANNEL_COPY_JOB_STATUSES),
      ),
      orderBy: [desc(channelCopyJobs.updatedAt), desc(channelCopyJobs.createdAt)],
    });

    return row ? mapJobRow(row) : null;
  }

  public async findNextRunnableJob(): Promise<ChannelCopyJobRecord | null> {
    const runningRow = await this.db.query.channelCopyJobs.findFirst({
      where: eq(channelCopyJobs.status, 'running'),
      orderBy: [desc(channelCopyJobs.updatedAt), desc(channelCopyJobs.createdAt)],
    });
    if (runningRow) {
      return mapJobRow(runningRow);
    }

    const queuedRow = await this.db.query.channelCopyJobs.findFirst({
      where: eq(channelCopyJobs.status, 'queued'),
      orderBy: [desc(channelCopyJobs.updatedAt), desc(channelCopyJobs.createdAt)],
    });

    return queuedRow ? mapJobRow(queuedRow) : null;
  }

  public async createJob(input: {
    destinationGuildId: string;
    sourceGuildId: string;
    sourceChannelId: string;
    destinationChannelId: string;
    requestedByDiscordUserId: string;
    confirmToken: string | null;
    status: ChannelCopyJobStatus;
    forceConfirmed: boolean;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    lastProcessedSourceMessageId?: string | null;
    scannedMessageCount?: number;
    copiedMessageCount?: number;
    skippedMessageCount?: number;
    failureMessage?: string | null;
  }): Promise<ChannelCopyJobRecord> {
    const now = new Date();
    const jobId = ulid();

    await this.db.insert(channelCopyJobs).values({
      id: jobId,
      destinationGuildId: input.destinationGuildId,
      sourceGuildId: input.sourceGuildId,
      sourceChannelId: input.sourceChannelId,
      destinationChannelId: input.destinationChannelId,
      requestedByDiscordUserId: input.requestedByDiscordUserId,
      confirmToken: input.confirmToken,
      status: input.status,
      forceConfirmed: input.forceConfirmed,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      lastProcessedSourceMessageId: input.lastProcessedSourceMessageId ?? null,
      scannedMessageCount: input.scannedMessageCount ?? 0,
      copiedMessageCount: input.copiedMessageCount ?? 0,
      skippedMessageCount: input.skippedMessageCount ?? 0,
      failureMessage: input.failureMessage ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const record = await this.getJobById(jobId);
    if (!record) {
      throw new Error('Failed to create channel copy job');
    }

    return record;
  }

  public async updateJob(input: {
    jobId: string;
    confirmToken?: string | null;
    status?: ChannelCopyJobStatus;
    forceConfirmed?: boolean;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    lastProcessedSourceMessageId?: string | null;
    scannedMessageCount?: number;
    copiedMessageCount?: number;
    skippedMessageCount?: number;
    failureMessage?: string | null;
  }): Promise<ChannelCopyJobRecord> {
    await this.db
      .update(channelCopyJobs)
      .set({
        confirmToken: input.confirmToken,
        status: input.status,
        forceConfirmed: input.forceConfirmed,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        lastProcessedSourceMessageId: input.lastProcessedSourceMessageId,
        scannedMessageCount: input.scannedMessageCount,
        copiedMessageCount: input.copiedMessageCount,
        skippedMessageCount: input.skippedMessageCount,
        failureMessage: input.failureMessage,
        updatedAt: new Date(),
      })
      .where(eq(channelCopyJobs.id, input.jobId));

    const record = await this.getJobById(input.jobId);
    if (!record) {
      throw new Error('Failed to update channel copy job');
    }

    return record;
  }
}

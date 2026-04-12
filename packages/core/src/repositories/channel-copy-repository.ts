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
      await this.db
        .update(channelCopyAuthorizedUsers)
        .set({
          grantedByDiscordUserId: input.grantedByDiscordUserId,
          updatedAt: now,
        })
        .where(eq(channelCopyAuthorizedUsers.id, existing.id));
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
}

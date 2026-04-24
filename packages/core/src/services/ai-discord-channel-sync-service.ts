import { createHash } from 'node:crypto';

import { err, ok, type Result } from 'neverthrow';

import { getEnv } from '../config/env.js';
import { AppError, fromUnknownError } from '../domain/errors.js';
import {
  AiKnowledgeRepository,
  type AiDiscordChannelSourceRecord,
} from '../repositories/ai-knowledge-repository.js';

export const AI_DISCORD_CHANNEL_BACKFILL_LIMIT = 500;

type DiscordMessagePayload = {
  id: string;
  channel_id?: string;
  author?: {
    id?: string;
    bot?: boolean;
  };
  content?: string;
  embeds?: DiscordEmbedPayload[];
  attachments?: DiscordAttachmentPayload[];
  timestamp?: string;
  edited_timestamp?: string | null;
};

type DiscordEmbedPayload = {
  title?: string | null;
  description?: string | null;
  url?: string | null;
  author?: {
    name?: string | null;
    url?: string | null;
  } | null;
  fields?: Array<{
    name?: string | null;
    value?: string | null;
  }>;
  footer?: {
    text?: string | null;
  } | null;
};

type DiscordAttachmentPayload = {
  filename?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
};

export type AiDiscordChannelSourceSummary = {
  sourceId: string;
  guildId: string;
  channelId: string;
  status: AiDiscordChannelSourceRecord['status'];
  lastSyncedAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncError: string | null;
  lastMessageId: string | null;
  messageCount: number;
  createdByDiscordUserId: string | null;
  updatedByDiscordUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiDiscordChannelSyncResult = {
  sourceId: string;
  channelId: string;
  messageCount: number;
  lastMessageId: string | null;
};

export type AiDiscordChannelSyncRepositoryLike = Pick<
  AiKnowledgeRepository,
  | 'getDiscordChannelSource'
  | 'listDiscordChannelSources'
  | 'createDiscordChannelSource'
  | 'deleteDiscordChannelSource'
  | 'markDiscordChannelSyncStarted'
  | 'replaceDiscordChannelMessages'
  | 'markDiscordChannelSyncCompleted'
  | 'markDiscordChannelSyncFailed'
  | 'deleteDiscordChannelMessage'
>;

function mapChannelSourceSummary(source: AiDiscordChannelSourceRecord): AiDiscordChannelSourceSummary {
  return {
    sourceId: source.id,
    guildId: source.guildId,
    channelId: source.channelId,
    status: source.status,
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    lastSyncStartedAt: source.lastSyncStartedAt?.toISOString() ?? null,
    lastSyncError: source.lastSyncError,
    lastMessageId: source.lastMessageId,
    messageCount: source.messageCount,
    createdByDiscordUserId: source.createdByDiscordUserId,
    updatedByDiscordUserId: source.updatedByDiscordUserId,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

function normalizeDiscordMessageContent(value: string): string {
  return value.trim().replace(/\r\n?/gu, '\n');
}

function pushNormalizedDiscordPart(parts: string[], value: string | null | undefined): void {
  const normalized = normalizeDiscordMessageContent(value ?? '');
  if (normalized) {
    parts.push(normalized);
  }
}

function extractDiscordMessageKnowledgeText(message: DiscordMessagePayload): string {
  const parts: string[] = [];
  pushNormalizedDiscordPart(parts, message.content);

  for (const embed of message.embeds ?? []) {
    pushNormalizedDiscordPart(parts, embed.author?.name);
    pushNormalizedDiscordPart(parts, embed.author?.url);
    pushNormalizedDiscordPart(parts, embed.title);
    pushNormalizedDiscordPart(parts, embed.description);
    pushNormalizedDiscordPart(parts, embed.url);
    for (const field of embed.fields ?? []) {
      pushNormalizedDiscordPart(parts, field.name);
      pushNormalizedDiscordPart(parts, field.value);
    }
    pushNormalizedDiscordPart(parts, embed.footer?.text);
  }

  for (const attachment of message.attachments ?? []) {
    pushNormalizedDiscordPart(parts, attachment.title);
    pushNormalizedDiscordPart(parts, attachment.filename);
    pushNormalizedDiscordPart(parts, attachment.description);
    pushNormalizedDiscordPart(parts, attachment.url);
  }

  return parts.join('\n');
}

function parseDiscordTimestamp(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class AiDiscordChannelSyncService {
  constructor(
    private readonly repository: AiDiscordChannelSyncRepositoryLike = new AiKnowledgeRepository(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  public async listChannelSources(input: {
    guildId: string;
  }): Promise<Result<AiDiscordChannelSourceSummary[], AppError>> {
    try {
      const sources = await this.repository.listDiscordChannelSources({ guildId: input.guildId });
      return ok(sources.map(mapChannelSourceSummary));
    } catch {
      return err(
        new AppError(
          'AI_DISCORD_CHANNEL_SOURCES_READ_FAILED',
          'Discord channel sources could not be loaded due to an internal error.',
          500,
        ),
      );
    }
  }

  public async listAllChannelSources(): Promise<Result<AiDiscordChannelSourceSummary[], AppError>> {
    try {
      const sources = await this.repository.listDiscordChannelSources();
      return ok(sources.map(mapChannelSourceSummary));
    } catch {
      return err(
        new AppError(
          'AI_DISCORD_CHANNEL_SOURCES_READ_FAILED',
          'Discord channel sources could not be loaded due to an internal error.',
          500,
        ),
      );
    }
  }

  public async createChannelSource(input: {
    guildId: string;
    channelId: string;
    actorDiscordUserId: string;
  }): Promise<Result<{ source: AiDiscordChannelSourceSummary; syncResult: AiDiscordChannelSyncResult }, AppError>> {
    try {
      const channelId = input.channelId.trim();
      if (!/^\d{5,32}$/u.test(channelId)) {
        return err(new AppError('AI_DISCORD_CHANNEL_INVALID', 'Discord channel ID is invalid.', 422));
      }

      const created = await this.repository.createDiscordChannelSource({
        guildId: input.guildId,
        channelId,
        createdByDiscordUserId: input.actorDiscordUserId,
      });
      const syncResult = await this.syncChannelSource({
        guildId: input.guildId,
        sourceId: created.record.id,
        actorDiscordUserId: input.actorDiscordUserId,
      });

      if (syncResult.isErr()) {
        return err(syncResult.error);
      }

      const refreshed = await this.repository.getDiscordChannelSource({
        guildId: input.guildId,
        sourceId: created.record.id,
      });

      return ok({
        source: mapChannelSourceSummary(refreshed ?? created.record),
        syncResult: syncResult.value,
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_DISCORD_CHANNEL_SOURCE_WRITE_FAILED',
              'Discord channel source could not be saved due to an internal error.',
              500,
            ),
      );
    }
  }

  public async deleteChannelSource(input: {
    guildId: string;
    sourceId: string;
  }): Promise<Result<{ deleted: boolean }, AppError>> {
    try {
      const deleted = await this.repository.deleteDiscordChannelSource(input);
      if (!deleted) {
        return err(new AppError('AI_DISCORD_CHANNEL_SOURCE_NOT_FOUND', 'Discord channel source was not found.', 404));
      }

      return ok({ deleted: true });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_DISCORD_CHANNEL_SOURCE_WRITE_FAILED',
              'Discord channel source could not be deleted due to an internal error.',
              500,
            ),
      );
    }
  }

  public async syncChannelSource(input: {
    guildId: string;
    sourceId: string;
    actorDiscordUserId?: string | null;
  }): Promise<Result<AiDiscordChannelSyncResult, AppError>> {
    const source = await this.repository.getDiscordChannelSource({
      guildId: input.guildId,
      sourceId: input.sourceId,
    });
    if (!source) {
      return err(new AppError('AI_DISCORD_CHANNEL_SOURCE_NOT_FOUND', 'Discord channel source was not found.', 404));
    }

    try {
      await this.repository.markDiscordChannelSyncStarted({
        guildId: input.guildId,
        sourceId: input.sourceId,
        updatedByDiscordUserId: input.actorDiscordUserId ?? null,
      });

      const messages = await this.fetchChannelMessages(source.channelId);
      const syncMessages = messages
        .map((message) => {
          const contentText = extractDiscordMessageKnowledgeText(message);
          return {
            message,
            contentText,
          };
        })
        .filter((entry) => entry.contentText.length > 0)
        .map((entry) => ({
          messageId: entry.message.id,
          channelId: source.channelId,
          authorId: entry.message.author?.id ?? null,
          contentText: entry.contentText,
          contentHash: createHash('sha256').update(entry.contentText).digest('hex'),
          messageCreatedAt: parseDiscordTimestamp(entry.message.timestamp),
          messageEditedAt: parseDiscordTimestamp(entry.message.edited_timestamp),
          metadataJson: {
            channelId: source.channelId,
            authorId: entry.message.author?.id ?? null,
            authorBot: Boolean(entry.message.author?.bot),
            discordTimestamp: entry.message.timestamp ?? null,
          },
        }));

      await this.repository.replaceDiscordChannelMessages({
        guildId: input.guildId,
        sourceId: input.sourceId,
        channelId: source.channelId,
        messages: syncMessages,
      });

      const newestMessageId = syncMessages[0]?.messageId ?? null;
      await this.repository.markDiscordChannelSyncCompleted({
        guildId: input.guildId,
        sourceId: input.sourceId,
        messageCount: syncMessages.length,
        lastMessageId: newestMessageId,
        updatedByDiscordUserId: input.actorDiscordUserId ?? null,
      });

      return ok({
        sourceId: input.sourceId,
        channelId: source.channelId,
        messageCount: syncMessages.length,
        lastMessageId: newestMessageId,
      });
    } catch (error) {
      const message = fromUnknownError(error).message || 'Discord channel sync failed.';
      await this.repository.markDiscordChannelSyncFailed({
        guildId: input.guildId,
        sourceId: input.sourceId,
        errorMessage: message,
        updatedByDiscordUserId: input.actorDiscordUserId ?? null,
      });
      return err(
        error instanceof AppError
          ? error
          : new AppError('AI_DISCORD_CHANNEL_SYNC_FAILED', message, 502),
      );
    }
  }

  public async deleteSyncedMessage(input: {
    guildId: string;
    channelId: string;
    messageId: string;
  }): Promise<Result<{ deleted: boolean }, AppError>> {
    try {
      return ok({ deleted: await this.repository.deleteDiscordChannelMessage(input) });
    } catch {
      return err(
        new AppError(
          'AI_DISCORD_CHANNEL_MESSAGE_DELETE_FAILED',
          'Synced Discord message could not be removed due to an internal error.',
          500,
        ),
      );
    }
  }

  private async fetchChannelMessages(channelId: string): Promise<DiscordMessagePayload[]> {
    const env = getEnv();
    const token = env.AI_DISCORD_TOKEN.trim();
    if (!token) {
      throw new AppError('AI_DISCORD_TOKEN_MISSING', 'AI bot token is not configured.', 500);
    }

    const messages: DiscordMessagePayload[] = [];
    let before: string | null = null;

    while (messages.length < AI_DISCORD_CHANNEL_BACKFILL_LIMIT) {
      const pageLimit = Math.min(100, AI_DISCORD_CHANNEL_BACKFILL_LIMIT - messages.length);
      const url = new URL(`${env.DISCORD_API_BASE_URL}/channels/${channelId}/messages`);
      url.searchParams.set('limit', String(pageLimit));
      if (before) {
        url.searchParams.set('before', before);
      }

      const response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bot ${token}`,
        },
      });
      if (!response.ok) {
        throw new AppError(
          'AI_DISCORD_CHANNEL_HISTORY_FAILED',
          `Discord channel history could not be loaded (${response.status}).`,
          response.status === 403 || response.status === 404 ? 422 : 502,
        );
      }

      const page = (await response.json()) as DiscordMessagePayload[];
      messages.push(...page);
      if (page.length < pageLimit) {
        break;
      }
      before = page.at(-1)?.id ?? null;
      if (!before) {
        break;
      }
    }

    return messages;
  }
}

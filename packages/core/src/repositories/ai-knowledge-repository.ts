import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import {
  aiCustomQas,
  aiDiscordChannelCategorySources,
  aiDiscordChannelMessages,
  aiDiscordChannelSources,
  aiKnowledgeDocuments,
  aiWebsiteSources,
} from '../infra/db/schema/index.js';
import { isMysqlDuplicateEntryError } from '../utils/mysql-errors.js';

export type AiWebsiteSourceStatus = 'pending' | 'syncing' | 'ready' | 'failed';
export type AiDiscordChannelSourceStatus = 'pending' | 'syncing' | 'ready' | 'failed';

export type AiWebsiteSourceRecord = {
  id: string;
  guildId: string;
  url: string;
  status: AiWebsiteSourceStatus;
  lastSyncedAt: Date | null;
  lastSyncStartedAt: Date | null;
  lastSyncError: string | null;
  httpStatus: number | null;
  contentHash: string | null;
  pageTitle: string | null;
  createdByDiscordUserId: string | null;
  updatedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiKnowledgeDocumentRecord = {
  id: string;
  guildId: string;
  sourceId: string;
  documentType: string;
  contentText: string;
  contentHash: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type AiCustomQaRecord = {
  id: string;
  guildId: string;
  question: string;
  answer: string;
  createdByDiscordUserId: string | null;
  updatedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiDiscordChannelSourceRecord = {
  id: string;
  guildId: string;
  channelId: string;
  status: AiDiscordChannelSourceStatus;
  lastSyncedAt: Date | null;
  lastSyncStartedAt: Date | null;
  lastSyncError: string | null;
  lastMessageId: string | null;
  messageCount: number;
  createdByDiscordUserId: string | null;
  updatedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiDiscordChannelCategorySourceRecord = {
  id: string;
  guildId: string;
  categoryId: string;
  createdByDiscordUserId: string | null;
  updatedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiDiscordChannelMessageRecord = {
  id: string;
  guildId: string;
  sourceId: string;
  channelId: string;
  messageId: string;
  authorId: string | null;
  contentText: string;
  contentHash: string;
  messageCreatedAt: Date | null;
  messageEditedAt: Date | null;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type AiSyncDocumentInput = {
  documentType: string;
  contentText: string;
  contentHash: string;
  metadataJson: Record<string, unknown>;
};

export type AiSyncDiscordChannelMessageInput = {
  messageId: string;
  channelId: string;
  authorId: string | null;
  contentText: string;
  contentHash: string;
  messageCreatedAt: Date | null;
  messageEditedAt: Date | null;
  metadataJson: Record<string, unknown>;
};

export type AiRetrievedEvidence = {
  sourceType: 'website_document' | 'custom_qa' | 'discord_channel_message';
  sourceId: string;
  content: string;
  title: string | null;
  url: string | null;
  question: string | null;
  answer: string | null;
  channelId: string | null;
  messageId: string | null;
  score: number;
};

export type AiDiagnosticsSourceSnapshot = {
  sourceId: string;
  url: string;
  status: AiWebsiteSourceStatus;
  pageTitle: string | null;
  httpStatus: number | null;
  lastSyncedAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncError: string | null;
  documentCount: number;
  updatedAt: string;
};

export type AiGuildDiagnosticsSnapshot = {
  guildId: string;
  totals: {
    sourceCount: number;
    readySourceCount: number;
    failedSourceCount: number;
    syncingSourceCount: number;
    pendingSourceCount: number;
    documentCount: number;
    customQaCount: number;
  };
  lastSyncedAt: string | null;
  sources: AiDiagnosticsSourceSnapshot[];
};

function mapWebsiteSourceRow(row: typeof aiWebsiteSources.$inferSelect): AiWebsiteSourceRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    url: row.url,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt ?? null,
    lastSyncStartedAt: row.lastSyncStartedAt ?? null,
    lastSyncError: row.lastSyncError ?? null,
    httpStatus: row.httpStatus ?? null,
    contentHash: row.contentHash ?? null,
    pageTitle: row.pageTitle ?? null,
    createdByDiscordUserId: row.createdByDiscordUserId ?? null,
    updatedByDiscordUserId: row.updatedByDiscordUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapKnowledgeDocumentRow(
  row: typeof aiKnowledgeDocuments.$inferSelect,
): AiKnowledgeDocumentRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    sourceId: row.sourceId,
    documentType: row.documentType,
    contentText: row.contentText,
    contentHash: row.contentHash,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCustomQaRow(row: typeof aiCustomQas.$inferSelect): AiCustomQaRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    question: row.question,
    answer: row.answer,
    createdByDiscordUserId: row.createdByDiscordUserId ?? null,
    updatedByDiscordUserId: row.updatedByDiscordUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDiscordChannelSourceRow(
  row: typeof aiDiscordChannelSources.$inferSelect,
): AiDiscordChannelSourceRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt ?? null,
    lastSyncStartedAt: row.lastSyncStartedAt ?? null,
    lastSyncError: row.lastSyncError ?? null,
    lastMessageId: row.lastMessageId ?? null,
    messageCount: row.messageCount,
    createdByDiscordUserId: row.createdByDiscordUserId ?? null,
    updatedByDiscordUserId: row.updatedByDiscordUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDiscordChannelCategorySourceRow(
  row: typeof aiDiscordChannelCategorySources.$inferSelect,
): AiDiscordChannelCategorySourceRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    categoryId: row.categoryId,
    createdByDiscordUserId: row.createdByDiscordUserId ?? null,
    updatedByDiscordUserId: row.updatedByDiscordUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDiscordChannelMessageRow(
  row: typeof aiDiscordChannelMessages.$inferSelect,
): AiDiscordChannelMessageRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    sourceId: row.sourceId,
    channelId: row.channelId,
    messageId: row.messageId,
    authorId: row.authorId ?? null,
    contentText: row.contentText,
    contentHash: row.contentHash,
    messageCreatedAt: row.messageCreatedAt ?? null,
    messageEditedAt: row.messageEditedAt ?? null,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function tokenize(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length >= 2);

  return [...new Set(tokens)];
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function countTokenMatches(tokens: string[], haystack: string): number {
  let score = 0;

  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

export class AiKnowledgeRepository {
  private readonly db = getDb();

  public async getWebsiteSource(input: {
    guildId: string;
    sourceId: string;
  }): Promise<AiWebsiteSourceRecord | null> {
    const row = await this.db.query.aiWebsiteSources.findFirst({
      where: and(
        eq(aiWebsiteSources.guildId, input.guildId),
        eq(aiWebsiteSources.id, input.sourceId),
      ),
    });

    return row ? mapWebsiteSourceRow(row) : null;
  }

  public async listWebsiteSources(input: { guildId?: string } = {}): Promise<AiWebsiteSourceRecord[]> {
    const rows = await this.db.query.aiWebsiteSources.findMany({
      where: input.guildId ? eq(aiWebsiteSources.guildId, input.guildId) : undefined,
      orderBy: (table, { desc, asc }) => [
        desc(table.updatedAt),
        asc(table.guildId),
        asc(table.url),
        asc(table.id),
      ],
    });

    return rows.map(mapWebsiteSourceRow);
  }

  public async createWebsiteSource(input: {
    guildId: string;
    url: string;
    createdByDiscordUserId?: string | null;
  }): Promise<{ created: boolean; record: AiWebsiteSourceRecord }> {
    const existing = await this.db.query.aiWebsiteSources.findFirst({
      where: and(
        eq(aiWebsiteSources.guildId, input.guildId),
        eq(aiWebsiteSources.url, input.url),
      ),
    });

    if (existing) {
      return {
        created: false,
        record: mapWebsiteSourceRow(existing),
      };
    }

    const now = new Date();
    const sourceId = ulid();

    try {
      await this.db.insert(aiWebsiteSources).values({
        id: sourceId,
        guildId: input.guildId,
        url: input.url,
        status: 'pending',
        createdByDiscordUserId: input.createdByDiscordUserId ?? null,
        updatedByDiscordUserId: input.createdByDiscordUserId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }

      const duplicate = await this.db.query.aiWebsiteSources.findFirst({
        where: and(
          eq(aiWebsiteSources.guildId, input.guildId),
          eq(aiWebsiteSources.url, input.url),
        ),
      });

      if (!duplicate) {
        throw error;
      }

      return {
        created: false,
        record: mapWebsiteSourceRow(duplicate),
      };
    }

    const created = await this.getWebsiteSource({
      guildId: input.guildId,
      sourceId,
    });

    if (!created) {
      throw new Error('Failed to create AI website source');
    }

    return {
      created: true,
      record: created,
    };
  }

  public async deleteWebsiteSource(input: {
    guildId: string;
    sourceId: string;
  }): Promise<boolean> {
    const existing = await this.getWebsiteSource(input);
    if (!existing) {
      return false;
    }

    await this.db
      .delete(aiWebsiteSources)
      .where(
        and(eq(aiWebsiteSources.guildId, input.guildId), eq(aiWebsiteSources.id, input.sourceId)),
      );

    return true;
  }

  public async listKnowledgeDocuments(input: {
    guildId: string;
    sourceId?: string;
  }): Promise<AiKnowledgeDocumentRecord[]> {
    const rows = await this.db.query.aiKnowledgeDocuments.findMany({
      where:
        input.sourceId == null
          ? eq(aiKnowledgeDocuments.guildId, input.guildId)
          : and(
              eq(aiKnowledgeDocuments.guildId, input.guildId),
              eq(aiKnowledgeDocuments.sourceId, input.sourceId),
            ),
      orderBy: (table, { desc, asc }) => [desc(table.updatedAt), asc(table.id)],
    });

    return rows.map(mapKnowledgeDocumentRow);
  }

  public async getCustomQa(input: {
    guildId: string;
    customQaId: string;
  }): Promise<AiCustomQaRecord | null> {
    const row = await this.db.query.aiCustomQas.findFirst({
      where: and(eq(aiCustomQas.guildId, input.guildId), eq(aiCustomQas.id, input.customQaId)),
    });

    return row ? mapCustomQaRow(row) : null;
  }

  public async listCustomQas(input: { guildId: string }): Promise<AiCustomQaRecord[]> {
    const rows = await this.db.query.aiCustomQas.findMany({
      where: eq(aiCustomQas.guildId, input.guildId),
      orderBy: (table, { desc, asc }) => [desc(table.updatedAt), asc(table.id)],
    });

    return rows.map(mapCustomQaRow);
  }

  public async createCustomQa(input: {
    guildId: string;
    question: string;
    answer: string;
    createdByDiscordUserId?: string | null;
  }): Promise<AiCustomQaRecord> {
    const now = new Date();
    const customQaId = ulid();

    await this.db.insert(aiCustomQas).values({
      id: customQaId,
      guildId: input.guildId,
      question: input.question,
      answer: input.answer,
      createdByDiscordUserId: input.createdByDiscordUserId ?? null,
      updatedByDiscordUserId: input.createdByDiscordUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.getCustomQa({
      guildId: input.guildId,
      customQaId,
    });
    if (!created) {
      throw new Error('Failed to create AI custom Q&A');
    }

    return created;
  }

  public async updateCustomQa(input: {
    guildId: string;
    customQaId: string;
    question: string;
    answer: string;
    updatedByDiscordUserId?: string | null;
  }): Promise<AiCustomQaRecord | null> {
    const existing = await this.getCustomQa({
      guildId: input.guildId,
      customQaId: input.customQaId,
    });
    if (!existing) {
      return null;
    }

    const now = new Date();
    await this.db
      .update(aiCustomQas)
      .set({
        question: input.question,
        answer: input.answer,
        updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
        updatedAt: now,
      })
      .where(and(eq(aiCustomQas.guildId, input.guildId), eq(aiCustomQas.id, input.customQaId)));

    return this.getCustomQa({
      guildId: input.guildId,
      customQaId: input.customQaId,
    });
  }

  public async deleteCustomQa(input: {
    guildId: string;
    customQaId: string;
  }): Promise<boolean> {
    const existing = await this.getCustomQa(input);
    if (!existing) {
      return false;
    }

    await this.db
      .delete(aiCustomQas)
      .where(and(eq(aiCustomQas.guildId, input.guildId), eq(aiCustomQas.id, input.customQaId)));

    return true;
  }

  public async getDiscordChannelSource(input: {
    guildId: string;
    sourceId: string;
  }): Promise<AiDiscordChannelSourceRecord | null> {
    const row = await this.db.query.aiDiscordChannelSources.findFirst({
      where: and(
        eq(aiDiscordChannelSources.guildId, input.guildId),
        eq(aiDiscordChannelSources.id, input.sourceId),
      ),
    });

    return row ? mapDiscordChannelSourceRow(row) : null;
  }

  public async listDiscordChannelSources(input: {
    guildId?: string;
  } = {}): Promise<AiDiscordChannelSourceRecord[]> {
    const rows = await this.db.query.aiDiscordChannelSources.findMany({
      where: input.guildId ? eq(aiDiscordChannelSources.guildId, input.guildId) : undefined,
      orderBy: (table, { desc, asc }) => [
        desc(table.updatedAt),
        asc(table.guildId),
        asc(table.channelId),
      ],
    });

    return rows.map(mapDiscordChannelSourceRow);
  }

  public async listDiscordChannelCategorySources(input: {
    guildId?: string;
  } = {}): Promise<AiDiscordChannelCategorySourceRecord[]> {
    const rows = await this.db.query.aiDiscordChannelCategorySources.findMany({
      where: input.guildId ? eq(aiDiscordChannelCategorySources.guildId, input.guildId) : undefined,
      orderBy: (table, { asc }) => [asc(table.guildId), asc(table.categoryId), asc(table.id)],
    });

    return rows.map(mapDiscordChannelCategorySourceRow);
  }

  public async createDiscordChannelCategorySource(input: {
    guildId: string;
    categoryId: string;
    createdByDiscordUserId?: string | null;
  }): Promise<{ created: boolean; record: AiDiscordChannelCategorySourceRecord }> {
    const existing = await this.db.query.aiDiscordChannelCategorySources.findFirst({
      where: and(
        eq(aiDiscordChannelCategorySources.guildId, input.guildId),
        eq(aiDiscordChannelCategorySources.categoryId, input.categoryId),
      ),
    });

    if (existing) {
      return { created: false, record: mapDiscordChannelCategorySourceRow(existing) };
    }

    const now = new Date();
    const sourceId = ulid();
    await this.db.insert(aiDiscordChannelCategorySources).values({
      id: sourceId,
      guildId: input.guildId,
      categoryId: input.categoryId,
      createdByDiscordUserId: input.createdByDiscordUserId ?? null,
      updatedByDiscordUserId: input.createdByDiscordUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.db.query.aiDiscordChannelCategorySources.findFirst({
      where: eq(aiDiscordChannelCategorySources.id, sourceId),
    });
    if (!created) {
      throw new Error('Failed to create AI Discord channel category source');
    }

    return { created: true, record: mapDiscordChannelCategorySourceRow(created) };
  }

  public async deleteDiscordChannelCategorySource(input: {
    guildId: string;
    categoryId: string;
  }): Promise<boolean> {
    const existing = await this.db.query.aiDiscordChannelCategorySources.findFirst({
      where: and(
        eq(aiDiscordChannelCategorySources.guildId, input.guildId),
        eq(aiDiscordChannelCategorySources.categoryId, input.categoryId),
      ),
    });
    if (!existing) {
      return false;
    }

    await this.db
      .delete(aiDiscordChannelCategorySources)
      .where(eq(aiDiscordChannelCategorySources.id, existing.id));

    return true;
  }

  public async createDiscordChannelSource(input: {
    guildId: string;
    channelId: string;
    createdByDiscordUserId?: string | null;
  }): Promise<{ created: boolean; record: AiDiscordChannelSourceRecord }> {
    const existing = await this.db.query.aiDiscordChannelSources.findFirst({
      where: and(
        eq(aiDiscordChannelSources.guildId, input.guildId),
        eq(aiDiscordChannelSources.channelId, input.channelId),
      ),
    });

    if (existing) {
      return { created: false, record: mapDiscordChannelSourceRow(existing) };
    }

    const now = new Date();
    const sourceId = ulid();
    await this.db.insert(aiDiscordChannelSources).values({
      id: sourceId,
      guildId: input.guildId,
      channelId: input.channelId,
      status: 'pending',
      messageCount: 0,
      createdByDiscordUserId: input.createdByDiscordUserId ?? null,
      updatedByDiscordUserId: input.createdByDiscordUserId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.getDiscordChannelSource({ guildId: input.guildId, sourceId });
    if (!created) {
      throw new Error('Failed to create AI Discord channel source');
    }

    return { created: true, record: created };
  }

  public async deleteDiscordChannelSource(input: {
    guildId: string;
    sourceId: string;
  }): Promise<boolean> {
    const existing = await this.getDiscordChannelSource(input);
    if (!existing) {
      return false;
    }

    await this.db
      .delete(aiDiscordChannelSources)
      .where(
        and(
          eq(aiDiscordChannelSources.guildId, input.guildId),
          eq(aiDiscordChannelSources.id, input.sourceId),
        ),
      );

    return true;
  }

  public async markDiscordChannelSyncStarted(input: {
    guildId: string;
    sourceId: string;
    startedAt?: Date;
    updatedByDiscordUserId?: string | null;
  }): Promise<void> {
    const startedAt = input.startedAt ?? new Date();

    await this.db
      .update(aiDiscordChannelSources)
      .set({
        status: 'syncing',
        lastSyncStartedAt: startedAt,
        lastSyncError: null,
        updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
        updatedAt: startedAt,
      })
      .where(
        and(
          eq(aiDiscordChannelSources.guildId, input.guildId),
          eq(aiDiscordChannelSources.id, input.sourceId),
        ),
      );
  }

  public async replaceDiscordChannelMessages(input: {
    guildId: string;
    sourceId: string;
    channelId: string;
    messages: AiSyncDiscordChannelMessageInput[];
  }): Promise<AiDiscordChannelMessageRecord[]> {
    const now = new Date();

    return this.db.transaction(async (tx) => {
      await tx
        .delete(aiDiscordChannelMessages)
        .where(
          and(
            eq(aiDiscordChannelMessages.guildId, input.guildId),
            eq(aiDiscordChannelMessages.sourceId, input.sourceId),
          ),
        );

      if (input.messages.length > 0) {
        await tx.insert(aiDiscordChannelMessages).values(
          input.messages.map((message) => ({
            id: ulid(),
            guildId: input.guildId,
            sourceId: input.sourceId,
            channelId: input.channelId,
            messageId: message.messageId,
            authorId: message.authorId,
            contentText: message.contentText,
            contentHash: message.contentHash,
            messageCreatedAt: message.messageCreatedAt,
            messageEditedAt: message.messageEditedAt,
            metadataJson: message.metadataJson,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      const rows = await tx.query.aiDiscordChannelMessages.findMany({
        where: and(
          eq(aiDiscordChannelMessages.guildId, input.guildId),
          eq(aiDiscordChannelMessages.sourceId, input.sourceId),
        ),
        orderBy: (table, { desc }) => [desc(table.messageCreatedAt), desc(table.messageId)],
      });

      return rows.map(mapDiscordChannelMessageRow);
    });
  }

  public async listDiscordChannelMessages(input: {
    guildId: string;
    sourceId?: string;
  }): Promise<AiDiscordChannelMessageRecord[]> {
    const rows = await this.db.query.aiDiscordChannelMessages.findMany({
      where:
        input.sourceId == null
          ? eq(aiDiscordChannelMessages.guildId, input.guildId)
          : and(
              eq(aiDiscordChannelMessages.guildId, input.guildId),
              eq(aiDiscordChannelMessages.sourceId, input.sourceId),
            ),
      orderBy: (table, { desc }) => [desc(table.messageCreatedAt), desc(table.messageId)],
    });

    return rows.map(mapDiscordChannelMessageRow);
  }

  public async deleteDiscordChannelMessage(input: {
    guildId: string;
    channelId: string;
    messageId: string;
  }): Promise<boolean> {
    const rows = await this.db
      .delete(aiDiscordChannelMessages)
      .where(
        and(
          eq(aiDiscordChannelMessages.guildId, input.guildId),
          eq(aiDiscordChannelMessages.channelId, input.channelId),
          eq(aiDiscordChannelMessages.messageId, input.messageId),
        ),
      );

    return Number(rows[0]?.affectedRows ?? 0) > 0;
  }

  public async markDiscordChannelSyncCompleted(input: {
    guildId: string;
    sourceId: string;
    messageCount: number;
    lastMessageId: string | null;
    syncedAt?: Date;
    updatedByDiscordUserId?: string | null;
  }): Promise<void> {
    const syncedAt = input.syncedAt ?? new Date();

    await this.db
      .update(aiDiscordChannelSources)
      .set({
        status: 'ready',
        lastSyncedAt: syncedAt,
        lastSyncError: null,
        lastMessageId: input.lastMessageId,
        messageCount: input.messageCount,
        updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
        updatedAt: syncedAt,
      })
      .where(
        and(
          eq(aiDiscordChannelSources.guildId, input.guildId),
          eq(aiDiscordChannelSources.id, input.sourceId),
        ),
      );
  }

  public async markDiscordChannelSyncFailed(input: {
    guildId: string;
    sourceId: string;
    errorMessage: string;
    failedAt?: Date;
    updatedByDiscordUserId?: string | null;
  }): Promise<void> {
    const failedAt = input.failedAt ?? new Date();

    await this.db
      .update(aiDiscordChannelSources)
      .set({
        status: 'failed',
        lastSyncError: input.errorMessage,
        updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(aiDiscordChannelSources.guildId, input.guildId),
          eq(aiDiscordChannelSources.id, input.sourceId),
        ),
      );
  }

  public async markSourceSyncStarted(input: {
    guildId: string;
    sourceId: string;
    startedAt?: Date;
    updatedByDiscordUserId?: string | null;
  }): Promise<void> {
    const startedAt = input.startedAt ?? new Date();

    await this.db
      .update(aiWebsiteSources)
      .set({
        status: 'syncing',
        lastSyncStartedAt: startedAt,
        lastSyncError: null,
        updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
        updatedAt: startedAt,
      })
      .where(
        and(eq(aiWebsiteSources.guildId, input.guildId), eq(aiWebsiteSources.id, input.sourceId)),
      );
  }

  public async replaceSourceDocuments(input: {
    guildId: string;
    sourceId: string;
    documents: AiSyncDocumentInput[];
  }): Promise<AiKnowledgeDocumentRecord[]> {
    const now = new Date();

    return this.db.transaction(async (tx) => {
      await tx
        .delete(aiKnowledgeDocuments)
        .where(
          and(
            eq(aiKnowledgeDocuments.guildId, input.guildId),
            eq(aiKnowledgeDocuments.sourceId, input.sourceId),
          ),
        );

      if (input.documents.length === 0) {
        return [];
      }

      await tx.insert(aiKnowledgeDocuments).values(
        input.documents.map((document) => ({
          id: ulid(),
          guildId: input.guildId,
          sourceId: input.sourceId,
          documentType: document.documentType,
          contentText: document.contentText,
          contentHash: document.contentHash,
          metadataJson: document.metadataJson,
          createdAt: now,
          updatedAt: now,
        })),
      );

      const rows = await tx.query.aiKnowledgeDocuments.findMany({
        where: and(
          eq(aiKnowledgeDocuments.guildId, input.guildId),
          eq(aiKnowledgeDocuments.sourceId, input.sourceId),
        ),
        orderBy: (table, { desc, asc }) => [desc(table.updatedAt), asc(table.id)],
      });

      return rows.map(mapKnowledgeDocumentRow);
    });
  }

  public async markSourceSyncCompleted(input: {
    guildId: string;
    sourceId: string;
    httpStatus: number;
    pageTitle: string | null;
    contentHash: string;
    syncedAt?: Date;
    updatedByDiscordUserId?: string | null;
  }): Promise<void> {
    const syncedAt = input.syncedAt ?? new Date();

    await this.db
      .update(aiWebsiteSources)
      .set({
        status: 'ready',
        lastSyncedAt: syncedAt,
        lastSyncError: null,
        httpStatus: input.httpStatus,
        pageTitle: input.pageTitle,
        contentHash: input.contentHash,
        updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
        updatedAt: syncedAt,
      })
      .where(
        and(eq(aiWebsiteSources.guildId, input.guildId), eq(aiWebsiteSources.id, input.sourceId)),
      );
  }

  public async markSourceSyncFailed(input: {
    guildId: string;
    sourceId: string;
    errorMessage: string;
    httpStatus?: number | null;
    failedAt?: Date;
    updatedByDiscordUserId?: string | null;
  }): Promise<void> {
    const failedAt = input.failedAt ?? new Date();

    await this.db
      .update(aiWebsiteSources)
      .set({
        status: 'failed',
        lastSyncError: input.errorMessage,
        httpStatus: input.httpStatus ?? null,
        updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
        updatedAt: failedAt,
      })
      .where(
        and(eq(aiWebsiteSources.guildId, input.guildId), eq(aiWebsiteSources.id, input.sourceId)),
      );
  }

  public async retrieveEvidence(input: {
    guildId: string;
    question: string;
    limit?: number;
  }): Promise<AiRetrievedEvidence[]> {
    const queryTokens = tokenize(input.question);
    const normalizedQuestion = normalizeSearchText(input.question);

    if (queryTokens.length === 0 || !normalizedQuestion) {
      return [];
    }

    const [documents, customQas, websiteSources, discordMessages] = await Promise.all([
      this.listKnowledgeDocuments({ guildId: input.guildId }),
      this.listCustomQas({ guildId: input.guildId }),
      this.listWebsiteSources({ guildId: input.guildId }),
      this.listDiscordChannelMessages({ guildId: input.guildId }),
    ]);

    const sourceById = new Map(websiteSources.map((source) => [source.id, source]));
    const candidates: AiRetrievedEvidence[] = [];

    for (const document of documents) {
      const title =
        typeof document.metadataJson.title === 'string' ? document.metadataJson.title : null;
      const url = typeof document.metadataJson.url === 'string' ? document.metadataJson.url : null;
      const searchable = normalizeSearchText(`${title ?? ''} ${document.contentText}`);
      const score =
        countTokenMatches(queryTokens, searchable) +
        (searchable.includes(normalizedQuestion) ? 4 : 0) +
        (sourceById.get(document.sourceId)?.status === 'ready' ? 1 : 0);

      if (score <= 0) {
        continue;
      }

      candidates.push({
        sourceType: 'website_document',
        sourceId: document.sourceId,
        content: document.contentText,
        title,
        url,
        question: null,
        answer: null,
        channelId: null,
        messageId: null,
        score,
      });
    }

    for (const message of discordMessages) {
      const searchable = normalizeSearchText(message.contentText);
      const score =
        countTokenMatches(queryTokens, searchable) +
        (searchable.includes(normalizedQuestion) ? 4 : 0) +
        1;

      if (score <= 0) {
        continue;
      }

      candidates.push({
        sourceType: 'discord_channel_message',
        sourceId: message.sourceId,
        content: message.contentText,
        title: `#${message.channelId}`,
        url: null,
        question: null,
        answer: null,
        channelId: message.channelId,
        messageId: message.messageId,
        score,
      });
    }

    for (const customQa of customQas) {
      const normalizedQaQuestion = normalizeSearchText(customQa.question);
      const normalizedQaAnswer = normalizeSearchText(customQa.answer);
      const score =
        countTokenMatches(queryTokens, normalizedQaQuestion) * 3 +
        countTokenMatches(queryTokens, normalizedQaAnswer) +
        (normalizedQaQuestion.includes(normalizedQuestion) ? 6 : 0);

      if (score <= 0) {
        continue;
      }

      candidates.push({
        sourceType: 'custom_qa',
        sourceId: customQa.id,
        content: `Q: ${customQa.question}\nA: ${customQa.answer}`,
        title: null,
        url: null,
        question: customQa.question,
        answer: customQa.answer,
        channelId: null,
        messageId: null,
        score,
      });
    }

    return candidates
      .sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId))
      .slice(0, input.limit ?? 5);
  }

  public async getGuildDiagnostics(input: {
    guildId: string;
  }): Promise<AiGuildDiagnosticsSnapshot> {
    const [sources, documents, customQas, discordSources, discordMessages] = await Promise.all([
      this.listWebsiteSources({ guildId: input.guildId }),
      this.listKnowledgeDocuments({ guildId: input.guildId }),
      this.listCustomQas({ guildId: input.guildId }),
      this.listDiscordChannelSources({ guildId: input.guildId }),
      this.listDiscordChannelMessages({ guildId: input.guildId }),
    ]);

    const documentCountBySourceId = new Map<string, number>();
    for (const document of documents) {
      const currentCount = documentCountBySourceId.get(document.sourceId) ?? 0;
      documentCountBySourceId.set(document.sourceId, currentCount + 1);
    }

    const lastSyncedAtDate =
      [...sources, ...discordSources]
        .map((source) => source.lastSyncedAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

    return {
      guildId: input.guildId,
      totals: {
        sourceCount: sources.length + discordSources.length,
        readySourceCount:
          sources.filter((source) => source.status === 'ready').length +
          discordSources.filter((source) => source.status === 'ready').length,
        failedSourceCount:
          sources.filter((source) => source.status === 'failed').length +
          discordSources.filter((source) => source.status === 'failed').length,
        syncingSourceCount:
          sources.filter((source) => source.status === 'syncing').length +
          discordSources.filter((source) => source.status === 'syncing').length,
        pendingSourceCount:
          sources.filter((source) => source.status === 'pending').length +
          discordSources.filter((source) => source.status === 'pending').length,
        documentCount: documents.length + discordMessages.length,
        customQaCount: customQas.length,
      },
      lastSyncedAt: lastSyncedAtDate?.toISOString() ?? null,
      sources: sources.map((source) => ({
        sourceId: source.id,
        url: source.url,
        status: source.status,
        pageTitle: source.pageTitle,
        httpStatus: source.httpStatus,
        lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
        lastSyncStartedAt: source.lastSyncStartedAt?.toISOString() ?? null,
        lastSyncError: source.lastSyncError,
        documentCount: documentCountBySourceId.get(source.id) ?? 0,
        updatedAt: source.updatedAt.toISOString(),
      })),
    };
  }
}

import { err, ok, type Result } from 'neverthrow';

import { AppError } from '../domain/errors.js';
import {
  AiKnowledgeRepository,
  type AiCustomQaRecord,
  type AiWebsiteSourceRecord,
} from '../repositories/ai-knowledge-repository.js';
import {
  AiWebsiteSyncService,
  type AiWebsiteSyncResult,
} from './ai-website-sync-service.js';

export type AiKnowledgeManagementRepositoryLike = Pick<
  AiKnowledgeRepository,
  | 'getWebsiteSource'
  | 'listWebsiteSources'
  | 'createWebsiteSource'
  | 'deleteWebsiteSource'
  | 'listCustomQas'
  | 'createCustomQa'
  | 'updateCustomQa'
  | 'deleteCustomQa'
>;

function mapWebsiteSourceSummary(source: AiWebsiteSourceRecord) {
  return {
    sourceId: source.id,
    guildId: source.guildId,
    url: source.url,
    status: source.status,
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    lastSyncStartedAt: source.lastSyncStartedAt?.toISOString() ?? null,
    lastSyncError: source.lastSyncError,
    httpStatus: source.httpStatus,
    contentHash: source.contentHash,
    pageTitle: source.pageTitle,
    createdByDiscordUserId: source.createdByDiscordUserId,
    updatedByDiscordUserId: source.updatedByDiscordUserId,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

function mapCustomQaSummary(customQa: AiCustomQaRecord) {
  return {
    customQaId: customQa.id,
    guildId: customQa.guildId,
    question: customQa.question,
    answer: customQa.answer,
    createdByDiscordUserId: customQa.createdByDiscordUserId,
    updatedByDiscordUserId: customQa.updatedByDiscordUserId,
    createdAt: customQa.createdAt.toISOString(),
    updatedAt: customQa.updatedAt.toISOString(),
  };
}

function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError('AI_WEBSITE_URL_REQUIRED', 'Website URL is required.', 422);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError('AI_WEBSITE_URL_INVALID', 'Website URL must be a valid absolute URL.', 422);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AppError(
      'AI_WEBSITE_URL_PROTOCOL_UNSUPPORTED',
      'Website URL must start with http:// or https://.',
      422,
    );
  }

  parsed.hash = '';
  return parsed.toString();
}

function normalizeKnowledgeText(value: string, fieldLabel: string): string {
  const normalized = value.trim().replace(/\r\n?/gu, '\n');
  if (!normalized) {
    throw new AppError(
      `AI_${fieldLabel.toUpperCase().replace(/\s+/gu, '_')}_REQUIRED`,
      `${fieldLabel} is required.`,
      422,
    );
  }

  return normalized;
}

export class AiKnowledgeManagementService {
  constructor(
    private readonly repository: AiKnowledgeManagementRepositoryLike = new AiKnowledgeRepository(),
    private readonly syncService: Pick<AiWebsiteSyncService, 'syncSource'> = new AiWebsiteSyncService(),
  ) {}

  public async listWebsiteSources(input: {
    guildId: string;
  }): Promise<
    Result<
      Array<ReturnType<typeof mapWebsiteSourceSummary>>,
      AppError
    >
  > {
    try {
      const sources = await this.repository.listWebsiteSources({ guildId: input.guildId });
      return ok(sources.map(mapWebsiteSourceSummary));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_WEBSITE_SOURCES_READ_FAILED',
              'Website sources could not be loaded due to an internal error.',
              500,
            ),
      );
    }
  }

  public async createWebsiteSource(input: {
    guildId: string;
    url: string;
    actorDiscordUserId: string;
  }): Promise<
    Result<
      {
        source: ReturnType<typeof mapWebsiteSourceSummary>;
        created: boolean;
        syncResult: AiWebsiteSyncResult | null;
      },
      AppError
    >
  > {
    try {
      const url = normalizeWebsiteUrl(input.url);
      const created = await this.repository.createWebsiteSource({
        guildId: input.guildId,
        url,
        createdByDiscordUserId: input.actorDiscordUserId,
      });

      let syncResult: AiWebsiteSyncResult | null = null;
      const syncAttempt = await this.syncService.syncSource({
        guildId: input.guildId,
        sourceId: created.record.id,
        url,
        updatedByDiscordUserId: input.actorDiscordUserId,
      });
      if (syncAttempt.isErr()) {
        return err(syncAttempt.error);
      }
      syncResult = syncAttempt.value;

      const refreshed = await this.repository.getWebsiteSource({
        guildId: input.guildId,
        sourceId: created.record.id,
      });

      return ok({
        source: mapWebsiteSourceSummary(refreshed ?? created.record),
        created: created.created,
        syncResult,
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_WEBSITE_SOURCES_WRITE_FAILED',
              'Website source could not be saved due to an internal error.',
              500,
            ),
      );
    }
  }

  public async syncWebsiteSource(input: {
    guildId: string;
    sourceId: string;
    actorDiscordUserId: string;
  }): Promise<Result<AiWebsiteSyncResult, AppError>> {
    try {
      const source = await this.repository.getWebsiteSource({
        guildId: input.guildId,
        sourceId: input.sourceId,
      });
      if (!source) {
        return err(
          new AppError('AI_WEBSITE_SOURCE_NOT_FOUND', 'Website source was not found.', 404),
        );
      }

      return this.syncService.syncSource({
        guildId: input.guildId,
        sourceId: source.id,
        url: source.url,
        updatedByDiscordUserId: input.actorDiscordUserId,
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_WEBSITE_SYNC_TRIGGER_FAILED',
              'Website sync could not be started due to an internal error.',
              500,
            ),
      );
    }
  }

  public async deleteWebsiteSource(input: {
    guildId: string;
    sourceId: string;
  }): Promise<Result<{ deleted: boolean }, AppError>> {
    try {
      const deleted = await this.repository.deleteWebsiteSource({
        guildId: input.guildId,
        sourceId: input.sourceId,
      });

      if (!deleted) {
        return err(new AppError('AI_WEBSITE_SOURCE_NOT_FOUND', 'Website source was not found.', 404));
      }

      return ok({ deleted: true });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_WEBSITE_SOURCES_WRITE_FAILED',
              'Website source could not be deleted due to an internal error.',
              500,
            ),
      );
    }
  }

  public async listCustomQas(input: {
    guildId: string;
  }): Promise<
    Result<
      Array<ReturnType<typeof mapCustomQaSummary>>,
      AppError
    >
  > {
    try {
      const customQas = await this.repository.listCustomQas({ guildId: input.guildId });
      return ok(customQas.map(mapCustomQaSummary));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_CUSTOM_QA_READ_FAILED',
              'Custom Q&A entries could not be loaded due to an internal error.',
              500,
            ),
      );
    }
  }

  public async createCustomQa(input: {
    guildId: string;
    question: string;
    answer: string;
    actorDiscordUserId: string;
  }): Promise<Result<ReturnType<typeof mapCustomQaSummary>, AppError>> {
    try {
      const question = normalizeKnowledgeText(input.question, 'Question');
      const answer = normalizeKnowledgeText(input.answer, 'Answer');
      const customQa = await this.repository.createCustomQa({
        guildId: input.guildId,
        question,
        answer,
        createdByDiscordUserId: input.actorDiscordUserId,
      });

      return ok(mapCustomQaSummary(customQa));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_CUSTOM_QA_WRITE_FAILED',
              'Custom Q&A entry could not be saved due to an internal error.',
              500,
            ),
      );
    }
  }

  public async updateCustomQa(input: {
    guildId: string;
    customQaId: string;
    question: string;
    answer: string;
    actorDiscordUserId: string;
  }): Promise<Result<ReturnType<typeof mapCustomQaSummary>, AppError>> {
    try {
      const question = normalizeKnowledgeText(input.question, 'Question');
      const answer = normalizeKnowledgeText(input.answer, 'Answer');
      const updated = await this.repository.updateCustomQa({
        guildId: input.guildId,
        customQaId: input.customQaId,
        question,
        answer,
        updatedByDiscordUserId: input.actorDiscordUserId,
      });

      if (!updated) {
        return err(new AppError('AI_CUSTOM_QA_NOT_FOUND', 'Custom Q&A entry was not found.', 404));
      }

      return ok(mapCustomQaSummary(updated));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_CUSTOM_QA_WRITE_FAILED',
              'Custom Q&A entry could not be updated due to an internal error.',
              500,
            ),
      );
    }
  }

  public async deleteCustomQa(input: {
    guildId: string;
    customQaId: string;
  }): Promise<Result<{ deleted: boolean }, AppError>> {
    try {
      const deleted = await this.repository.deleteCustomQa({
        guildId: input.guildId,
        customQaId: input.customQaId,
      });

      if (!deleted) {
        return err(new AppError('AI_CUSTOM_QA_NOT_FOUND', 'Custom Q&A entry was not found.', 404));
      }

      return ok({ deleted: true });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_CUSTOM_QA_WRITE_FAILED',
              'Custom Q&A entry could not be deleted due to an internal error.',
              500,
            ),
      );
    }
  }
}

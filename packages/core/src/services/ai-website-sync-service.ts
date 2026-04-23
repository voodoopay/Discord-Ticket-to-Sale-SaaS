import { createHash } from 'node:crypto';

import { err, ok, type Result } from 'neverthrow';

import { AppError, fromUnknownError } from '../domain/errors.js';
import { AiKnowledgeRepository } from '../repositories/ai-knowledge-repository.js';

export type AiFetchedPage = {
  url: string;
  httpStatus: number;
  title: string | null;
  text: string;
};

export type AiWebsiteFetcher = {
  fetchPage(input: { url: string }): Promise<AiFetchedPage>;
};

export type AiWebsiteSyncRepositoryLike = Pick<
  AiKnowledgeRepository,
  'markSourceSyncStarted' | 'replaceSourceDocuments' | 'markSourceSyncCompleted' | 'markSourceSyncFailed'
>;

export type AiWebsiteSyncResult = {
  sourceId: string;
  url: string;
  pageTitle: string | null;
  httpStatus: number;
  contentHash: string;
  documentCount: number;
  status: 'ready';
  syncedAt: string;
};

function normalizeComparableUrl(value: string): string {
  return new URL(value).toString();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/giu, (_, codePoint: string) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/giu, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    );
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<(?:br|hr)\s*\/?>/giu, '\n')
    .replace(/<\/(?:p|div|section|article|main|aside|header|footer|nav|li|ul|ol|table|tr|td|th|h[1-6])>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ');
}

function normalizeContentText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t\f\v]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function extractTitleFromHtml(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  if (!match) {
    return null;
  }

  const [, title = ''] = match;
  return normalizeContentText(title);
}

export async function fetchWebsitePage(input: { url: string }): Promise<AiFetchedPage> {
  const response = await fetch(input.url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      'user-agent': 'VoodooAiWebsiteSync/1.0',
    },
  });

  if (response.status >= 300 && response.status < 400) {
    throw new AppError(
      'AI_WEBSITE_REDIRECT_BLOCKED',
      'The approved website URL redirected to a different page.',
      422,
    );
  }

  if (!response.ok) {
    throw new AppError(
      'AI_WEBSITE_FETCH_FAILED',
      `The approved website URL returned HTTP ${response.status}.`,
      502,
    );
  }

  const rawBody = await response.text();
  const title = extractTitleFromHtml(rawBody);
  const text = normalizeContentText(stripHtmlToText(rawBody));

  return {
    url: response.url || input.url,
    httpStatus: response.status,
    title,
    text,
  };
}

export class AiWebsiteSyncService {
  constructor(
    private readonly repository: AiWebsiteSyncRepositoryLike = new AiKnowledgeRepository(),
    private readonly websiteFetcher: AiWebsiteFetcher = {
      fetchPage: fetchWebsitePage,
    },
  ) {}

  public async syncSource(input: {
    guildId: string;
    sourceId: string;
    url: string;
    updatedByDiscordUserId?: string | null;
  }): Promise<Result<AiWebsiteSyncResult, AppError>> {
    let started = false;

    try {
      await this.repository.markSourceSyncStarted({
        guildId: input.guildId,
        sourceId: input.sourceId,
        updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
      });
      started = true;

      const page = await this.websiteFetcher.fetchPage({
        url: input.url,
      });

      if (normalizeComparableUrl(page.url) !== normalizeComparableUrl(input.url)) {
        throw new AppError(
          'AI_WEBSITE_URL_MISMATCH',
          'The approved website URL resolved to a different page.',
          422,
        );
      }

      const normalizedText = normalizeContentText(page.text);
      if (!normalizedText) {
        throw new AppError(
          'AI_WEBSITE_EMPTY_CONTENT',
          'The approved website URL did not contain usable text content.',
          422,
        );
      }

      const pageTitle = normalizeContentText(page.title ?? '') || null;
      const contentHash = createHash('sha256').update(normalizedText).digest('hex');
      const syncedAt = new Date();
      const documents = await this.repository.replaceSourceDocuments({
        guildId: input.guildId,
        sourceId: input.sourceId,
        documents: [
          {
            documentType: 'website_page',
            contentText: normalizedText,
            contentHash,
            metadataJson: {
              title: pageTitle,
              url: input.url,
              httpStatus: page.httpStatus,
            },
          },
        ],
      });

      await this.repository.markSourceSyncCompleted({
        guildId: input.guildId,
        sourceId: input.sourceId,
        httpStatus: page.httpStatus,
        pageTitle,
        contentHash,
        syncedAt,
        updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
      });

      return ok({
        sourceId: input.sourceId,
        url: input.url,
        pageTitle,
        httpStatus: page.httpStatus,
        contentHash,
        documentCount: documents.length,
        status: 'ready',
        syncedAt: syncedAt.toISOString(),
      });
    } catch (error) {
      const failure = fromUnknownError(error, 'AI_WEBSITE_SYNC_FAILED');

      if (started) {
        try {
          await this.repository.markSourceSyncFailed({
            guildId: input.guildId,
            sourceId: input.sourceId,
            errorMessage: failure.message,
            updatedByDiscordUserId: input.updatedByDiscordUserId ?? null,
          });
        } catch {
          // Preserve the original sync failure.
        }
      }

      return err(failure);
    }
  }
}

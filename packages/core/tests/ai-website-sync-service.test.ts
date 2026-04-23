import { describe, expect, it, vi } from 'vitest';

import { AiWebsiteSyncService } from '../src/services/ai-website-sync-service.js';

describe('AiWebsiteSyncService', () => {
  it('stores normalized content for an exact approved URL', async () => {
    const repository = {
      markSourceSyncStarted: vi.fn().mockResolvedValue(undefined),
      replaceSourceDocuments: vi.fn().mockResolvedValue([
        {
          id: 'doc-1',
          guildId: 'guild-1',
          sourceId: 'source-1',
          documentType: 'website_page',
          contentText: 'Refunds are accepted within fourteen days.',
          contentHash: 'hash-1',
          metadataJson: {},
          createdAt: new Date('2026-04-23T10:00:00.000Z'),
          updatedAt: new Date('2026-04-23T10:00:00.000Z'),
        },
      ]),
      markSourceSyncCompleted: vi.fn().mockResolvedValue(undefined),
      markSourceSyncFailed: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AiWebsiteSyncService(repository, {
      fetchPage: vi.fn().mockResolvedValue({
        url: 'https://example.com/refunds',
        httpStatus: 200,
        title: 'Refunds',
        text: '  Refunds are accepted within fourteen days.  ',
      }),
    });

    const result = await service.syncSource({
      guildId: 'guild-1',
      sourceId: 'source-1',
      url: 'https://example.com/refunds',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(repository.markSourceSyncStarted).toHaveBeenCalledWith({
      guildId: 'guild-1',
      sourceId: 'source-1',
      updatedByDiscordUserId: null,
    });
    expect(repository.replaceSourceDocuments).toHaveBeenCalledWith({
      guildId: 'guild-1',
      sourceId: 'source-1',
      documents: [
        expect.objectContaining({
          documentType: 'website_page',
          contentText: 'Refunds are accepted within fourteen days.',
          metadataJson: {
            title: 'Refunds',
            url: 'https://example.com/refunds',
            httpStatus: 200,
          },
        }),
      ],
    });
    expect(repository.markSourceSyncCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        sourceId: 'source-1',
        httpStatus: 200,
        pageTitle: 'Refunds',
      }),
    );
    expect(repository.markSourceSyncFailed).not.toHaveBeenCalled();
    expect(result.value).toMatchObject({
      sourceId: 'source-1',
      url: 'https://example.com/refunds',
      pageTitle: 'Refunds',
      httpStatus: 200,
      documentCount: 1,
      status: 'ready',
    });
  });

  it('fails when the fetched page does not match the approved URL', async () => {
    const repository = {
      markSourceSyncStarted: vi.fn().mockResolvedValue(undefined),
      replaceSourceDocuments: vi.fn(),
      markSourceSyncCompleted: vi.fn(),
      markSourceSyncFailed: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AiWebsiteSyncService(repository as never, {
      fetchPage: vi.fn().mockResolvedValue({
        url: 'https://example.com/refunds/',
        httpStatus: 200,
        title: 'Refunds',
        text: 'Refunds are accepted within fourteen days.',
      }),
    });

    const result = await service.syncSource({
      guildId: 'guild-1',
      sourceId: 'source-1',
      url: 'https://example.com/refunds',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.code).toBe('AI_WEBSITE_URL_MISMATCH');
    expect(repository.replaceSourceDocuments).not.toHaveBeenCalled();
    expect(repository.markSourceSyncCompleted).not.toHaveBeenCalled();
    expect(repository.markSourceSyncFailed).toHaveBeenCalledWith({
      guildId: 'guild-1',
      sourceId: 'source-1',
      errorMessage: 'The approved website URL resolved to a different page.',
      updatedByDiscordUserId: null,
    });
  });
});

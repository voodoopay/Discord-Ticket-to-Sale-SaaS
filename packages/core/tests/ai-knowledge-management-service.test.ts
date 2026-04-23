import { describe, expect, it, vi } from 'vitest';

import { AiKnowledgeManagementService } from '../src/services/ai-knowledge-management-service.js';

describe('AiKnowledgeManagementService', () => {
  it('creates and syncs a website source on save', async () => {
    const repository = {
      createWebsiteSource: vi.fn().mockResolvedValue({
        created: true,
        record: {
          id: 'source-1',
          guildId: 'guild-1',
          url: 'https://docs.example.com/faq',
          status: 'pending',
          lastSyncedAt: null,
          lastSyncStartedAt: null,
          lastSyncError: null,
          httpStatus: null,
          contentHash: null,
          pageTitle: null,
          createdByDiscordUserId: 'discord-user-1',
          updatedByDiscordUserId: 'discord-user-1',
          createdAt: new Date('2026-04-23T10:00:00.000Z'),
          updatedAt: new Date('2026-04-23T10:00:00.000Z'),
        },
      }),
      getWebsiteSource: vi.fn().mockResolvedValue({
        id: 'source-1',
        guildId: 'guild-1',
        url: 'https://docs.example.com/faq',
        status: 'ready',
        lastSyncedAt: new Date('2026-04-23T10:05:00.000Z'),
        lastSyncStartedAt: new Date('2026-04-23T10:04:55.000Z'),
        lastSyncError: null,
        httpStatus: 200,
        contentHash: 'hash-1',
        pageTitle: 'FAQ',
        createdByDiscordUserId: 'discord-user-1',
        updatedByDiscordUserId: 'discord-user-1',
        createdAt: new Date('2026-04-23T10:00:00.000Z'),
        updatedAt: new Date('2026-04-23T10:05:00.000Z'),
      }),
      listWebsiteSources: vi.fn(),
      deleteWebsiteSource: vi.fn(),
      listCustomQas: vi.fn(),
      createCustomQa: vi.fn(),
      updateCustomQa: vi.fn(),
      deleteCustomQa: vi.fn(),
    };
    const syncService = {
      syncSource: vi.fn().mockResolvedValue({
        isErr: () => false,
        value: {
          sourceId: 'source-1',
          url: 'https://docs.example.com/faq',
          pageTitle: 'FAQ',
          httpStatus: 200,
          contentHash: 'hash-1',
          documentCount: 1,
          status: 'ready',
          syncedAt: '2026-04-23T10:05:00.000Z',
        },
      }),
    };
    const service = new AiKnowledgeManagementService(repository as never, syncService as never);

    const result = await service.createWebsiteSource({
      guildId: 'guild-1',
      url: ' https://docs.example.com/faq#intro ',
      actorDiscordUserId: 'discord-user-1',
    });

    expect(result.isOk()).toBe(true);
    expect(repository.createWebsiteSource).toHaveBeenCalledWith({
      guildId: 'guild-1',
      url: 'https://docs.example.com/faq',
      createdByDiscordUserId: 'discord-user-1',
    });
    expect(syncService.syncSource).toHaveBeenCalledWith({
      guildId: 'guild-1',
      sourceId: 'source-1',
      url: 'https://docs.example.com/faq',
      updatedByDiscordUserId: 'discord-user-1',
    });
    if (result.isOk()) {
      expect(result.value.source.status).toBe('ready');
      expect(result.value.syncResult?.documentCount).toBe(1);
    }
  });

  it('rejects invalid website URLs before persistence', async () => {
    const service = new AiKnowledgeManagementService(
      {
        getWebsiteSource: vi.fn(),
        listWebsiteSources: vi.fn(),
        createWebsiteSource: vi.fn(),
        deleteWebsiteSource: vi.fn(),
        listCustomQas: vi.fn(),
        createCustomQa: vi.fn(),
        updateCustomQa: vi.fn(),
        deleteCustomQa: vi.fn(),
      } as never,
      { syncSource: vi.fn() } as never,
    );

    const result = await service.createWebsiteSource({
      guildId: 'guild-1',
      url: 'not-a-url',
      actorDiscordUserId: 'discord-user-1',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('AI_WEBSITE_URL_INVALID');
      expect(result.error.statusCode).toBe(422);
    }
  });

  it('creates and updates custom q&a entries with trimmed content', async () => {
    const repository = {
      getWebsiteSource: vi.fn(),
      listWebsiteSources: vi.fn(),
      createWebsiteSource: vi.fn(),
      deleteWebsiteSource: vi.fn(),
      listCustomQas: vi.fn(),
      createCustomQa: vi.fn().mockResolvedValue({
        id: 'qa-1',
        guildId: 'guild-1',
        question: 'What refund window do you offer?',
        answer: 'Refunds are accepted within 7 days of purchase.',
        createdByDiscordUserId: 'discord-user-1',
        updatedByDiscordUserId: 'discord-user-1',
        createdAt: new Date('2026-04-23T10:00:00.000Z'),
        updatedAt: new Date('2026-04-23T10:00:00.000Z'),
      }),
      updateCustomQa: vi.fn().mockResolvedValue({
        id: 'qa-1',
        guildId: 'guild-1',
        question: 'What refund window do you offer?',
        answer: 'Refunds are accepted within 14 days of purchase.',
        createdByDiscordUserId: 'discord-user-1',
        updatedByDiscordUserId: 'discord-user-2',
        createdAt: new Date('2026-04-23T10:00:00.000Z'),
        updatedAt: new Date('2026-04-23T10:10:00.000Z'),
      }),
      deleteCustomQa: vi.fn(),
    };
    const service = new AiKnowledgeManagementService(repository as never, {
      syncSource: vi.fn(),
    } as never);

    const created = await service.createCustomQa({
      guildId: 'guild-1',
      question: '  What refund window do you offer?  ',
      answer: '  Refunds are accepted within 7 days of purchase. ',
      actorDiscordUserId: 'discord-user-1',
    });
    const updated = await service.updateCustomQa({
      guildId: 'guild-1',
      customQaId: 'qa-1',
      question: ' What refund window do you offer? ',
      answer: ' Refunds are accepted within 14 days of purchase. ',
      actorDiscordUserId: 'discord-user-2',
    });

    expect(created.isOk()).toBe(true);
    expect(updated.isOk()).toBe(true);
    expect(repository.createCustomQa).toHaveBeenCalledWith({
      guildId: 'guild-1',
      question: 'What refund window do you offer?',
      answer: 'Refunds are accepted within 7 days of purchase.',
      createdByDiscordUserId: 'discord-user-1',
    });
    expect(repository.updateCustomQa).toHaveBeenCalledWith({
      guildId: 'guild-1',
      customQaId: 'qa-1',
      question: 'What refund window do you offer?',
      answer: 'Refunds are accepted within 14 days of purchase.',
      updatedByDiscordUserId: 'discord-user-2',
    });
  });
});

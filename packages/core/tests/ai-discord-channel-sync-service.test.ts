import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTests } from '../src/config/env.js';
import {
  AiDiscordChannelSyncService,
  AI_DISCORD_CHANNEL_BACKFILL_LIMIT,
} from '../src/services/ai-discord-channel-sync-service.js';

describe('AI Discord channel sync service', () => {
  const originalToken = process.env.AI_DISCORD_TOKEN;
  const originalApiBaseUrl = process.env.DISCORD_API_BASE_URL;
  const originalEnvFile = process.env.VOODOO_ENV_FILE;

  beforeEach(() => {
    process.env.VOODOO_ENV_FILE = '__missing_env_file__.env';
    process.env.AI_DISCORD_TOKEN = 'ai-token';
    process.env.DISCORD_API_BASE_URL = 'https://discord.test/api/v10';
    resetEnvForTests();
  });

  afterEach(() => {
    if (originalToken == null) {
      delete process.env.AI_DISCORD_TOKEN;
    } else {
      process.env.AI_DISCORD_TOKEN = originalToken;
    }
    if (originalApiBaseUrl == null) {
      delete process.env.DISCORD_API_BASE_URL;
    } else {
      process.env.DISCORD_API_BASE_URL = originalApiBaseUrl;
    }
    if (originalEnvFile == null) {
      delete process.env.VOODOO_ENV_FILE;
    } else {
      process.env.VOODOO_ENV_FILE = originalEnvFile;
    }
    resetEnvForTests();
    vi.restoreAllMocks();
  });

  it('backfills up to 500 messages and replaces the stored channel snapshot', async () => {
    const source = {
      id: 'source-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      status: 'pending' as const,
      lastSyncedAt: null,
      lastSyncStartedAt: null,
      lastSyncError: null,
      lastMessageId: null,
      messageCount: 0,
      createdByDiscordUserId: 'user-1',
      updatedByDiscordUserId: 'user-1',
      createdAt: new Date('2026-04-23T00:00:00.000Z'),
      updatedAt: new Date('2026-04-23T00:00:00.000Z'),
    };
    const repository = {
      getDiscordChannelSource: vi.fn().mockResolvedValue(source),
      listDiscordChannelSources: vi.fn(),
      createDiscordChannelSource: vi.fn(),
      deleteDiscordChannelSource: vi.fn(),
      markDiscordChannelSyncStarted: vi.fn().mockResolvedValue(undefined),
      replaceDiscordChannelMessages: vi.fn().mockResolvedValue([]),
      markDiscordChannelSyncCompleted: vi.fn().mockResolvedValue(undefined),
      markDiscordChannelSyncFailed: vi.fn().mockResolvedValue(undefined),
      deleteDiscordChannelMessage: vi.fn(),
    };
    const fetchMock = vi.fn(async (url: URL) => {
      const before = url.searchParams.get('before');
      const offset = before ? Number(before.replace('msg-', '')) + 1 : 0;
      const page = Array.from({ length: 100 }, (_, index) => {
        const idNumber = offset + index;
        return {
          id: `msg-${idNumber}`,
          author: { id: `author-${idNumber}`, bot: false },
          content: `Knowledge message ${idNumber}`,
          timestamp: new Date(Date.UTC(2026, 3, 23, 0, idNumber % 60)).toISOString(),
          edited_timestamp: null,
        };
      });

      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const service = new AiDiscordChannelSyncService(repository, fetchMock as typeof fetch);

    const result = await service.syncChannelSource({ guildId: 'guild-1', sourceId: 'source-1' });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }
    expect(result.value).toEqual({
      sourceId: 'source-1',
      channelId: 'channel-1',
      messageCount: AI_DISCORD_CHANNEL_BACKFILL_LIMIT,
      lastMessageId: 'msg-0',
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(repository.replaceDiscordChannelMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        sourceId: 'source-1',
        channelId: 'channel-1',
        messages: expect.arrayContaining([
          expect.objectContaining({
            messageId: 'msg-0',
            contentText: 'Knowledge message 0',
          }),
        ]),
      }),
    );
    expect(repository.markDiscordChannelSyncCompleted).toHaveBeenCalledWith({
      guildId: 'guild-1',
      sourceId: 'source-1',
      messageCount: AI_DISCORD_CHANNEL_BACKFILL_LIMIT,
      lastMessageId: 'msg-0',
      updatedByDiscordUserId: null,
    });
  });

  it('indexes embed-only knowledge posts', async () => {
    const source = {
      id: 'source-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      status: 'pending' as const,
      lastSyncedAt: null,
      lastSyncStartedAt: null,
      lastSyncError: null,
      lastMessageId: null,
      messageCount: 0,
      createdByDiscordUserId: 'user-1',
      updatedByDiscordUserId: 'user-1',
      createdAt: new Date('2026-04-23T00:00:00.000Z'),
      updatedAt: new Date('2026-04-23T00:00:00.000Z'),
    };
    const repository = {
      getDiscordChannelSource: vi.fn().mockResolvedValue(source),
      listDiscordChannelSources: vi.fn(),
      createDiscordChannelSource: vi.fn(),
      deleteDiscordChannelSource: vi.fn(),
      markDiscordChannelSyncStarted: vi.fn().mockResolvedValue(undefined),
      replaceDiscordChannelMessages: vi.fn().mockResolvedValue([]),
      markDiscordChannelSyncCompleted: vi.fn().mockResolvedValue(undefined),
      markDiscordChannelSyncFailed: vi.fn().mockResolvedValue(undefined),
      deleteDiscordChannelMessage: vi.fn(),
    };
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            id: 'msg-embed',
            author: { id: 'author-1', bot: true },
            content: '',
            timestamp: '2026-04-23T12:00:00.000Z',
            edited_timestamp: null,
            embeds: [
              {
                author: { name: 'Voodoo Docs' },
                title: 'Activation setup',
                description: 'Use /activation grant after installing the bot.',
                url: 'https://voodooai.online/docs/activation',
                fields: [
                  { name: 'Required role', value: 'Server owner or administrator' },
                  { name: 'Failure handling', value: 'Retry after checking bot permissions' },
                ],
                footer: { text: 'Last updated daily' },
              },
            ],
            attachments: [
              {
                filename: 'activation-guide.pdf',
                description: 'Full activation checklist',
              },
            ],
          },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const service = new AiDiscordChannelSyncService(repository, fetchMock as typeof fetch);

    const result = await service.syncChannelSource({ guildId: 'guild-1', sourceId: 'source-1' });

    expect(result.isOk()).toBe(true);
    expect(repository.replaceDiscordChannelMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            messageId: 'msg-embed',
            contentText: [
              'Voodoo Docs',
              'Activation setup',
              'Use /activation grant after installing the bot.',
              'https://voodooai.online/docs/activation',
              'Required role',
              'Server owner or administrator',
              'Failure handling',
              'Retry after checking bot permissions',
              'Last updated daily',
              'activation-guide.pdf',
              'Full activation checklist',
            ].join('\n'),
          }),
        ],
      }),
    );
  });
});

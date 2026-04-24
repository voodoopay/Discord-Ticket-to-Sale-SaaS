import { describe, expect, it, vi } from 'vitest';

import { createAiKnowledgeRefreshScheduler } from './knowledge-refresh.js';

function ok<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

describe('AI knowledge refresh scheduler', () => {
  it('refreshes website and Discord channel sources once per run', async () => {
    const websiteService = {
      listAllWebsiteSources: vi.fn().mockResolvedValue(
        ok([
          {
            guildId: 'guild-1',
            sourceId: 'website-source-1',
            updatedByDiscordUserId: null,
            createdByDiscordUserId: 'user-1',
          },
        ]),
      ),
      syncWebsiteSource: vi.fn().mockResolvedValue(ok({ sourceId: 'website-source-1' })),
    };
    const channelService = {
      listAllChannelSources: vi.fn().mockResolvedValue(
        ok([
          {
            guildId: 'guild-1',
            sourceId: 'channel-source-1',
            updatedByDiscordUserId: 'user-2',
            createdByDiscordUserId: 'user-1',
          },
        ]),
      ),
      syncChannelSource: vi.fn().mockResolvedValue(ok({ sourceId: 'channel-source-1' })),
      reconcileCategorySources: vi.fn().mockResolvedValue(ok({ createdCount: 0, syncedCount: 0 })),
    };
    const scheduler = createAiKnowledgeRefreshScheduler({ websiteService, channelService });

    await scheduler.runOnce();

    expect(websiteService.syncWebsiteSource).toHaveBeenCalledWith({
      guildId: 'guild-1',
      sourceId: 'website-source-1',
      actorDiscordUserId: 'user-1',
    });
    expect(channelService.syncChannelSource).toHaveBeenCalledWith({
      guildId: 'guild-1',
      sourceId: 'channel-source-1',
      actorDiscordUserId: 'user-2',
    });
  });

  it('reconciles auto-selected Discord knowledge categories before channel refresh', async () => {
    const websiteService = {
      listAllWebsiteSources: vi.fn().mockResolvedValue(ok([])),
      syncWebsiteSource: vi.fn(),
    };
    const channelService = {
      reconcileCategorySources: vi.fn().mockResolvedValue(ok({ createdCount: 1, syncedCount: 1 })),
      listAllChannelSources: vi.fn().mockResolvedValue(ok([])),
      syncChannelSource: vi.fn(),
    };
    const scheduler = createAiKnowledgeRefreshScheduler({ websiteService, channelService });

    await scheduler.runOnce();

    expect(channelService.reconcileCategorySources).toHaveBeenCalledBefore(
      channelService.listAllChannelSources,
    );
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getGuildActivationState,
  getGuildSettingsSnapshot,
  getGuildDiagnostics,
  listWebsiteSources,
  listCustomQas,
  listChannelSources,
  listCategorySources,
} = vi.hoisted(() => ({
  getGuildActivationState: vi.fn(),
  getGuildSettingsSnapshot: vi.fn(),
  getGuildDiagnostics: vi.fn(),
  listWebsiteSources: vi.fn(),
  listCustomQas: vi.fn(),
  listChannelSources: vi.fn(),
  listCategorySources: vi.fn(),
}));

const requireAiGuildAccess = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AiAccessService: class {
      public getGuildActivationState = getGuildActivationState;
    },
    AiConfigService: class {
      public getGuildSettingsSnapshot = getGuildSettingsSnapshot;
    },
    AiDiagnosticsService: class {
      public getGuildDiagnostics = getGuildDiagnostics;
    },
    AiKnowledgeManagementService: class {
      public listWebsiteSources = listWebsiteSources;
      public listCustomQas = listCustomQas;
    },
    AiDiscordChannelSyncService: class {
      public listChannelSources = listChannelSources;
      public listCategorySources = listCategorySources;
    },
  };
});

vi.mock('@/lib/ai-guild-access', () => ({
  requireAiGuildAccess,
}));

import { GET } from './route';

describe('ai guild snapshot route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAiGuildAccess.mockResolvedValue({
      ok: true,
      value: {
        session: {
          discordUserId: 'discord-user-1',
        },
        guild: {
          id: 'guild-1',
          name: 'Guild One',
          iconUrl: null,
          owner: true,
          permissions: '8',
        },
      },
    });
    getGuildActivationState.mockResolvedValue({
      isErr: () => false,
      value: {
        activated: true,
        authorizedUserCount: 1,
      },
    });
    getGuildSettingsSnapshot.mockResolvedValue({
      isErr: () => false,
      value: {
        guildId: 'guild-1',
        enabled: true,
        tonePreset: 'professional',
        toneInstructions: 'Stay concise.',
        roleMode: 'allowlist',
        defaultReplyMode: 'inline',
        replyFrequency: 'low',
        unansweredLoggingEnabled: true,
        unansweredLogChannelId: 'log-channel-1',
        replyChannels: [{ channelId: 'channel-1', replyMode: 'thread' }],
        replyChannelCategories: [{ categoryId: 'category-1', replyMode: 'inline' }],
        roleIds: ['role-1'],
        createdAt: '2026-04-23T10:00:00.000Z',
        updatedAt: '2026-04-23T10:10:00.000Z',
      },
    });
    getGuildDiagnostics.mockResolvedValue({
      isErr: () => false,
      value: {
        guildId: 'guild-1',
        totals: {
          sourceCount: 1,
          readySourceCount: 1,
          failedSourceCount: 0,
          syncingSourceCount: 0,
          pendingSourceCount: 0,
          documentCount: 1,
          customQaCount: 1,
        },
        lastSyncedAt: '2026-04-23T10:10:00.000Z',
        sources: [],
      },
    });
    listWebsiteSources.mockResolvedValue({
      isErr: () => false,
      value: [{ sourceId: 'source-1', url: 'https://docs.example.com/faq', status: 'ready' }],
    });
    listCustomQas.mockResolvedValue({
      isErr: () => false,
      value: [{ customQaId: 'qa-1', question: 'What is the refund policy?', answer: '7 days.' }],
    });
    listChannelSources.mockResolvedValue({
      isErr: () => false,
      value: [{ sourceId: 'discord-source-1', channelId: 'channel-2', status: 'ready' }],
    });
    listCategorySources.mockResolvedValue({
      isErr: () => false,
      value: [{ sourceId: 'discord-category-source-1', categoryId: 'category-1' }],
    });
  });

  it('returns the aggregated panel snapshot for an accessible guild', async () => {
    const response = await GET(new NextRequest('https://ai.example.com/api/guilds/guild-1/snapshot'), {
      params: Promise.resolve({ guildId: 'guild-1' }),
    });

    expect(response.status).toBe(200);
    expect(requireAiGuildAccess).toHaveBeenCalled();
    const payload = (await response.json()) as {
      guild: { id: string };
      activation: { activated: boolean };
      settings: {
        tonePreset: string;
        replyFrequency: string;
        unansweredLoggingEnabled: boolean;
        unansweredLogChannelId: string | null;
      };
      websiteSources: Array<{ sourceId: string }>;
      discordChannelSources: Array<{ sourceId: string }>;
      discordChannelCategorySources: Array<{ sourceId: string }>;
      customQas: Array<{ customQaId: string }>;
    };
    expect(payload.guild.id).toBe('guild-1');
    expect(payload.activation.activated).toBe(true);
    expect(payload.settings.tonePreset).toBe('professional');
    expect(payload.settings.replyFrequency).toBe('low');
    expect(payload.settings.unansweredLoggingEnabled).toBe(true);
    expect(payload.settings.unansweredLogChannelId).toBe('log-channel-1');
    expect(payload.websiteSources[0]?.sourceId).toBe('source-1');
    expect(payload.discordChannelSources[0]?.sourceId).toBe('discord-source-1');
    expect(payload.discordChannelCategorySources[0]?.sourceId).toBe('discord-category-source-1');
    expect(payload.customQas[0]?.customQaId).toBe('qa-1');
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createWebsiteSource = vi.hoisted(() => vi.fn());
const requireAiGuildAccess = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AiKnowledgeManagementService: class {
      public createWebsiteSource = createWebsiteSource;
    },
  };
});

vi.mock('@/lib/ai-guild-access', () => ({
  requireAiGuildAccess,
}));

import { POST } from './route';

describe('ai website sources route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAiGuildAccess.mockResolvedValue({
      ok: true,
      value: {
        session: {
          discordUserId: 'discord-user-1',
        },
      },
    });
    createWebsiteSource.mockResolvedValue({
      isErr: () => false,
      value: {
        created: true,
        source: {
          sourceId: 'source-1',
          url: 'https://docs.example.com/faq',
          status: 'ready',
        },
        syncResult: {
          sourceId: 'source-1',
          status: 'ready',
        },
      },
    });
  });

  it('creates and syncs a manual website source on save', async () => {
    const response = await POST(
      new NextRequest('https://ai.example.com/api/guilds/guild-1/website-sources', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://docs.example.com/faq',
        }),
      }),
      {
        params: Promise.resolve({ guildId: 'guild-1' }),
      },
    );

    expect(response.status).toBe(201);
    expect(createWebsiteSource).toHaveBeenCalledWith({
      guildId: 'guild-1',
      url: 'https://docs.example.com/faq',
      actorDiscordUserId: 'discord-user-1',
    });
    const payload = (await response.json()) as { source: { sourceId: string } };
    expect(payload.source.sourceId).toBe('source-1');
  });
});

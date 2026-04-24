import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEnv = vi.hoisted(() => vi.fn());
const requireAiGuildAccess = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getEnv,
  };
});

vi.mock('@/lib/ai-guild-access', () => ({
  requireAiGuildAccess,
}));

let GET: ((request: NextRequest, context: { params: Promise<{ guildId: string }> }) => Promise<Response>) | undefined;

describe('ai discord guild resources route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    getEnv.mockReturnValue({
      AI_DISCORD_CLIENT_ID: 'ai-client-id',
      AI_DISCORD_TOKEN: 'ai-token',
      DISCORD_API_BASE_URL: 'https://discord.com/api/v10',
    });
    requireAiGuildAccess.mockResolvedValue({
      ok: true,
      value: {
        guild: {
          id: 'guild-1',
          name: 'Guild One',
          iconUrl: null,
          owner: true,
          permissions: '8',
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn());
    ({ GET } = await import('./route'));
  });

  it('returns channels and roles when the ai bot is already in the guild', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'category-1', name: 'AI Ops', type: 4, position: 1 },
            { id: 'channel-1', name: 'ask-ai', type: 0, parent_id: 'category-1', position: 2 },
            { id: 'forum-1', name: 'faq-forum', type: 15, parent_id: 'category-1', position: 3 },
            { id: 'media-1', name: 'showcase', type: 16, parent_id: 'category-1', position: 4 },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'guild-1', name: '@everyone', color: 0, managed: false, position: 0 },
            { id: 'role-1', name: 'Premium', color: 123, managed: false, position: 2 },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const response = await GET!(
      new NextRequest('https://ai.example.com/api/discord/guilds/guild-1/resources'),
      {
        params: Promise.resolve({ guildId: 'guild-1' }),
      },
    );

    const payload = (await response.json()) as {
      botInGuild: boolean;
      channels: Array<{ id: string }>;
      categoryChannels: Array<{ id: string }>;
      roles: Array<{ id: string }>;
      inviteUrl: string;
    };
    expect(response.status).toBe(200);
    expect(payload.botInGuild).toBe(true);
    expect(payload.channels).toEqual([
      { id: 'channel-1', name: 'ask-ai', type: 0, parentId: 'category-1' },
      { id: 'forum-1', name: 'faq-forum', type: 15, parentId: 'category-1' },
      { id: 'media-1', name: 'showcase', type: 16, parentId: 'category-1' },
    ]);
    expect(payload.categoryChannels).toEqual([{ id: 'category-1', name: 'AI Ops', type: 4 }]);
    expect(payload.roles).toEqual([{ id: 'role-1', name: 'Premium', color: 123, position: 2 }]);
    expect(payload.inviteUrl).toContain('client_id=ai-client-id');
  });
});

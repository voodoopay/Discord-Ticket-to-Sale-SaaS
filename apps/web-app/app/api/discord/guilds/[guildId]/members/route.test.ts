import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLinkedTenantForGuild, getResolvedBotToken, listTenantMembers } = vi.hoisted(() => ({
  getLinkedTenantForGuild: vi.fn(),
  getResolvedBotToken: vi.fn(),
  listTenantMembers: vi.fn(),
}));

const requireSession = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', () => ({
  TenantService: class {
    public getLinkedTenantForGuild = getLinkedTenantForGuild;
    public listTenantMembers = listTenantMembers;
  },
  AdminService: class {
    public getResolvedBotToken = getResolvedBotToken;
  },
  getEnv: () => ({
    DISCORD_API_BASE_URL: 'https://discord.com/api/v10',
  }),
}));

vi.mock('@/lib/http', () => ({
  requireSession,
  jsonError: vi.fn((error: unknown) => {
    throw error;
  }),
}));

import { GET } from './route';

describe('discord guild member search route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    requireSession.mockResolvedValue({
      ok: true,
      session: {
        userId: 'user-1',
        discordUserId: 'discord-user-1',
        isSuperAdmin: false,
        tenantIds: ['tenant-1'],
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    getLinkedTenantForGuild.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        tenantId: 'tenant-1',
        guildId: 'guild-1',
      },
    });
    listTenantMembers.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        currentRole: 'owner',
        canManageMembers: true,
        canDisconnectGuild: true,
        canDisconnectTelegram: true,
        members: [
          {
            userId: 'user-3',
            discordUserId: 'discord-user-3',
            username: 'existing-worker',
            avatarUrl: null,
            role: 'member',
            removable: true,
          },
        ],
      },
    });
    getResolvedBotToken.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: 'bot-token-123',
    });
  });

  it('returns Discord member search candidates for workspace invites', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            nick: 'Ops Worker',
            user: {
              id: 'discord-user-2',
              username: 'ops-worker',
              global_name: 'Ops Worker',
              avatar: 'avatar-2',
            },
          },
          {
            user: {
              id: 'discord-user-3',
              username: 'existing-worker',
              avatar: null,
            },
          },
        ]),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    const response = await GET(
      new NextRequest(
        'https://voodoopaybot.online/api/discord/guilds/guild-1/members?tenantId=tenant-1&query=ops',
      ),
      {
        params: Promise.resolve({
          guildId: 'guild-1',
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(getLinkedTenantForGuild).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), {
      guildId: 'guild-1',
    });
    expect(listTenantMembers).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), {
      tenantId: 'tenant-1',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/guild-1/members/search?query=ops&limit=8',
      expect.objectContaining({
        headers: {
          Authorization: 'Bot bot-token-123',
        },
      }),
    );

    const payload = (await response.json()) as {
      candidates: Array<{
        discordUserId: string;
        alreadyInWorkspace: boolean;
        currentRole: string | null;
      }>;
    };
    expect(payload.candidates).toEqual([
      expect.objectContaining({
        discordUserId: 'discord-user-2',
        alreadyInWorkspace: false,
        currentRole: null,
      }),
      expect.objectContaining({
        discordUserId: 'discord-user-3',
        alreadyInWorkspace: true,
        currentRole: 'member',
      }),
    ]);
  });

  it('blocks lookups for users who cannot manage workspace access', async () => {
    listTenantMembers.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        currentRole: 'admin',
        canManageMembers: false,
        canDisconnectGuild: false,
        canDisconnectTelegram: true,
        members: [],
      },
    });

    const response = await GET(
      new NextRequest(
        'https://voodoopaybot.online/api/discord/guilds/guild-1/members?tenantId=tenant-1&query=ops',
      ),
      {
        params: Promise.resolve({
          guildId: 'guild-1',
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const { cookies, getSession, listDiscordGuildsByAccessToken } = vi.hoisted(() => ({
  cookies: vi.fn(),
  getSession: vi.fn(),
  listDiscordGuildsByAccessToken: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies,
}));

vi.mock('../../../packages/core/dist/index.js', () => ({
  AuthService: class {
    public getSession = getSession;
    public listDiscordGuildsByAccessToken = listDiscordGuildsByAccessToken;
  },
}));

import { getAiDashboardSessionData } from './ai-session';

function createCookieStore(values: Record<string, string>) {
  return {
    get(name: string) {
      const value = values[name];
      return value ? { name, value } : undefined;
    },
  };
}

describe('getAiDashboardSessionData', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the session cookie is missing', async () => {
    cookies.mockResolvedValue(createCookieStore({}));

    await expect(getAiDashboardSessionData()).resolves.toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('returns owner and admin guilds only', async () => {
    cookies.mockResolvedValue(
      createCookieStore({
        vd_session: 'session-token',
        vd_discord_access_token: 'discord-token',
      }),
    );
    getSession.mockResolvedValue({
      isErr: () => false,
      value: {
        userId: 'user-1',
        discordUserId: 'discord-user-1',
        isSuperAdmin: false,
        tenantIds: [],
        exp: 1,
      },
    });
    listDiscordGuildsByAccessToken.mockResolvedValue({
      isErr: () => false,
      value: [
        { id: 'viewer', name: 'Viewer Guild', permissions: '0', owner: false },
        { id: 'admin', name: 'Admin Guild', permissions: '8', owner: false, icon: 'admin-icon' },
        { id: 'manager', name: 'Manager Guild', permissions: '32', owner: false },
        { id: 'owner', name: 'Owner Guild', permissions: '0', owner: true },
      ],
    });

    const sessionData = await getAiDashboardSessionData();

    expect(sessionData).toMatchObject({
      me: {
        userId: 'user-1',
        discordUserId: 'discord-user-1',
      },
      discordGuildsError: '',
    });
    expect(sessionData?.discordGuilds).toEqual([
      {
        id: 'admin',
        name: 'Admin Guild',
        iconUrl: 'https://cdn.discordapp.com/icons/admin/admin-icon.png',
        owner: false,
        permissions: '8',
      },
      {
        id: 'manager',
        name: 'Manager Guild',
        iconUrl: null,
        owner: false,
        permissions: '32',
      },
      {
        id: 'owner',
        name: 'Owner Guild',
        iconUrl: null,
        owner: true,
        permissions: '0',
      },
    ]);
    expect(listDiscordGuildsByAccessToken).toHaveBeenCalledWith('discord-token');
  });

  it('surfaces a reconnect hint when the Discord access token is missing', async () => {
    cookies.mockResolvedValue(
      createCookieStore({
        vd_session: 'session-token',
      }),
    );
    getSession.mockResolvedValue({
      isErr: () => false,
      value: {
        userId: 'user-1',
        discordUserId: 'discord-user-1',
        isSuperAdmin: true,
        tenantIds: [],
        exp: 1,
      },
    });

    const sessionData = await getAiDashboardSessionData();

    expect(sessionData).toMatchObject({
      me: {
        discordUserId: 'discord-user-1',
      },
      discordGuilds: [],
    });
    expect(sessionData?.discordGuildsError).toContain('exact panel domain');
    expect(listDiscordGuildsByAccessToken).not.toHaveBeenCalled();
  });
});

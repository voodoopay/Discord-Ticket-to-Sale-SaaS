import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTests } from '../src/config/env.js';
import { AuthService } from '../src/services/auth-service.js';

function applyAuthEnv(): void {
  process.env.DISCORD_CLIENT_ID = 'discord-client-id';
  process.env.DISCORD_CLIENT_SECRET = 'discord-client-secret';
  process.env.DISCORD_REDIRECT_URI = 'https://voodoopaybot.online/api/auth/discord/callback';
  process.env.DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
  process.env.SESSION_SECRET = 'test-session-secret-test-session-secret';
}

describe('auth service', () => {
  beforeEach(() => {
    applyAuthEnv();
    resetEnvForTests();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('continues login when guild loading fails after a successful profile fetch', async () => {
    const service = new AuthService();

    vi.spyOn((service as any).userRepository, 'upsertDiscordUser').mockResolvedValue({
      id: 'user-1',
      discordUserId: 'discord-1',
      username: 'merchant',
      avatarUrl: 'https://cdn.discordapp.com/avatar.png',
    });
    vi.spyOn((service as any).userRepository, 'ensureSuperAdmin').mockResolvedValue(undefined);
    vi.spyOn((service as any).userRepository, 'isSuperAdmin').mockResolvedValue(false);
    vi.spyOn((service as any).userRepository, 'getTenantIdsForUser').mockResolvedValue(['tenant-1']);

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'discord-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'discord-1', username: 'merchant', avatar: 'avatar-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }));

    const result = await service.exchangeCodeForSession({
      code: 'oauth-code',
      state: 'oauth-state',
      expectedState: 'oauth-state',
      redirectUri: 'https://voodoopaybot.online/api/auth/discord/callback',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.discordAccessToken).toBe('discord-access-token');
    expect(result.value.guilds).toEqual([]);
    expect(result.value.user.discordUserId).toBe('discord-1');
    expect(result.value.tenantIds).toEqual(['tenant-1']);
  });

  it('uses an overridden Discord OAuth client for login URLs and token exchange', async () => {
    const service = new AuthService({
      discordClientId: 'ai-client-id',
      discordClientSecret: 'ai-client-secret',
    });
    const redirectUri = 'https://www.voodooai.online/api/auth/discord/callback';

    const loginUrl = new URL(service.buildLoginUrl('oauth-state', redirectUri));
    expect(loginUrl.searchParams.get('client_id')).toBe('ai-client-id');
    expect(loginUrl.searchParams.get('redirect_uri')).toBe(redirectUri);

    vi.spyOn((service as any).userRepository, 'upsertDiscordUser').mockResolvedValue({
      id: 'user-1',
      discordUserId: 'discord-1',
      username: 'merchant',
      avatarUrl: null,
    });
    vi.spyOn((service as any).userRepository, 'ensureSuperAdmin').mockResolvedValue(undefined);
    vi.spyOn((service as any).userRepository, 'isSuperAdmin').mockResolvedValue(false);
    vi.spyOn((service as any).userRepository, 'getTenantIdsForUser').mockResolvedValue([]);

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'discord-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'discord-1', username: 'merchant', avatar: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const result = await service.exchangeCodeForSession({
      code: 'oauth-code',
      state: 'oauth-state',
      expectedState: 'oauth-state',
      redirectUri,
    });

    expect(result.isOk()).toBe(true);
    const tokenRequestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(tokenRequestBody).toBeInstanceOf(URLSearchParams);
    expect((tokenRequestBody as URLSearchParams).get('client_id')).toBe('ai-client-id');
    expect((tokenRequestBody as URLSearchParams).get('client_secret')).toBe('ai-client-secret');
  });

  it('fails login when the Discord profile fetch itself fails', async () => {
    const service = new AuthService();

    vi.spyOn((service as any).userRepository, 'upsertDiscordUser').mockResolvedValue({
      id: 'user-1',
      discordUserId: 'discord-1',
      username: 'merchant',
      avatarUrl: null,
    });
    vi.spyOn((service as any).userRepository, 'ensureSuperAdmin').mockResolvedValue(undefined);
    vi.spyOn((service as any).userRepository, 'isSuperAdmin').mockResolvedValue(false);
    vi.spyOn((service as any).userRepository, 'getTenantIdsForUser').mockResolvedValue([]);

    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'discord-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));

    const result = await service.exchangeCodeForSession({
      code: 'oauth-code',
      state: 'oauth-state',
      expectedState: 'oauth-state',
      redirectUri: 'https://voodoopaybot.online/api/auth/discord/callback',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.code).toBe('DISCORD_OAUTH_PROFILE_FAILED');
    expect(result.error.message).toBe('Failed to fetch profile from Discord');
  });
});

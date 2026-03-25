import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { disconnectGuild } = vi.hoisted(() => ({
  disconnectGuild: vi.fn(),
}));

const requireSession = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', () => ({
  TenantService: class {
    public disconnectGuild = disconnectGuild;
  },
}));

vi.mock('@/lib/http', () => ({
  requireSession,
  readJson: vi.fn(async (request: NextRequest) => request.json()),
  jsonError: vi.fn((error: unknown) => {
    throw error;
  }),
}));

import { DELETE } from './route';

describe('guild disconnect route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it('passes the tenant and guild identifiers into tenant-service disconnectGuild', async () => {
    disconnectGuild.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: undefined,
    });

    const response = await DELETE(
      new NextRequest('https://voodoopaybot.online/api/guilds/guild-1/disconnect', {
        method: 'DELETE',
        body: JSON.stringify({ tenantId: 'tenant-1' }),
        headers: {
          'content-type': 'application/json',
        },
      }),
      {
        params: Promise.resolve({
          guildId: 'guild-1',
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(disconnectGuild).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      {
        tenantId: 'tenant-1',
        guildId: 'guild-1',
      },
    );
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clearGuildHistory } = vi.hoisted(() => ({
  clearGuildHistory: vi.fn(),
}));

const requireSession = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', () => ({
  SalesHistoryService: class {
    public clearGuildHistory = clearGuildHistory;
  },
}));

vi.mock('@/lib/http', () => ({
  requireSession,
  readJson: vi.fn(async (request: NextRequest) => request.json()),
  jsonError: vi.fn((error: unknown) => {
    throw error;
  }),
}));

import { POST } from './route';

describe('sales clear route', () => {
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

  it('passes the tenant and guild identifiers into sales-history clearGuildHistory', async () => {
    clearGuildHistory.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        clearedAt: '2026-03-30T10:15:00.000Z',
      },
    });

    const response = await POST(
      new NextRequest('https://voodoopaybot.online/api/guilds/guild-1/sales/clear', {
        method: 'POST',
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
    expect(clearGuildHistory).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      {
        tenantId: 'tenant-1',
        guildId: 'guild-1',
      },
    );
  });
});

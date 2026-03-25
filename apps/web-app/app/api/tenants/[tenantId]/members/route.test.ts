import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listTenantMembers } = vi.hoisted(() => ({
  listTenantMembers: vi.fn(),
}));

const requireSession = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', () => ({
  TenantService: class {
    public listTenantMembers = listTenantMembers;
  },
}));

vi.mock('@/lib/http', () => ({
  requireSession,
  jsonError: vi.fn((error: unknown) => {
    throw error;
  }),
}));

import { GET } from './route';

describe('tenant members route', () => {
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

  it('returns workspace member access state for the requested tenant', async () => {
    listTenantMembers.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        currentRole: 'owner',
        canManageMembers: true,
        canDisconnectGuild: true,
        canDisconnectTelegram: true,
        members: [],
      },
    });

    const response = await GET(new NextRequest('https://voodoopaybot.online/api/tenants/tenant-1/members'), {
      params: Promise.resolve({
        tenantId: 'tenant-1',
      }),
    });

    expect(response.status).toBe(200);
    expect(listTenantMembers).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), {
      tenantId: 'tenant-1',
    });
  });
});

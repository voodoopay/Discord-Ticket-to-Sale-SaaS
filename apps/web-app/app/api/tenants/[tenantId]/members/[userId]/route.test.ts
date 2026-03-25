import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { removeTenantMember } = vi.hoisted(() => ({
  removeTenantMember: vi.fn(),
}));

const requireSession = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', () => ({
  TenantService: class {
    public removeTenantMember = removeTenantMember;
  },
}));

vi.mock('@/lib/http', () => ({
  requireSession,
  jsonError: vi.fn((error: unknown) => {
    throw error;
  }),
}));

import { DELETE } from './route';

describe('tenant member delete route', () => {
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

  it('passes the target workspace member id into tenant-service removeTenantMember', async () => {
    removeTenantMember.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: undefined,
    });

    const response = await DELETE(
      new NextRequest('https://voodoopaybot.online/api/tenants/tenant-1/members/user-2', {
        method: 'DELETE',
      }),
      {
        params: Promise.resolve({
          tenantId: 'tenant-1',
          userId: 'user-2',
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(removeTenantMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      {
        tenantId: 'tenant-1',
        userId: 'user-2',
      },
    );
  });
});

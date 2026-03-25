import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addTenantMember, listTenantMembers } = vi.hoisted(() => ({
  addTenantMember: vi.fn(),
  listTenantMembers: vi.fn(),
}));

const requireSession = vi.hoisted(() => vi.fn());
const readJson = vi.hoisted(() => vi.fn(async (request: NextRequest) => request.json()));

vi.mock('@voodoo/core', () => ({
  TenantService: class {
    public addTenantMember = addTenantMember;
    public listTenantMembers = listTenantMembers;
  },
}));

vi.mock('@/lib/http', () => ({
  requireSession,
  readJson,
  jsonError: vi.fn((error: unknown) => {
    throw error;
  }),
}));

import { GET, POST } from './route';

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
    readJson.mockImplementation(async (request: NextRequest) => request.json());
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

  it('creates a workspace member for the requested tenant', async () => {
    addTenantMember.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        userId: 'user-2',
        discordUserId: 'discord-user-2',
        username: 'worker-user',
        avatarUrl: null,
        role: 'admin',
      },
    });

    const request = new NextRequest('https://voodoopaybot.online/api/tenants/tenant-1/members', {
      method: 'POST',
      body: JSON.stringify({
        discordUserId: 'discord-user-2',
        username: 'worker-user',
        avatarUrl: null,
        role: 'admin',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request, {
      params: Promise.resolve({
        tenantId: 'tenant-1',
      }),
    });

    expect(response.status).toBe(201);
    expect(addTenantMember).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), {
      tenantId: 'tenant-1',
      discordUserId: 'discord-user-2',
      username: 'worker-user',
      avatarUrl: null,
      role: 'admin',
    });
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTenant, listTenants } = vi.hoisted(() => ({
  createTenant: vi.fn(),
  listTenants: vi.fn(),
}));

const requireSession = vi.hoisted(() => vi.fn());
const readJson = vi.hoisted(() => vi.fn(async (request: NextRequest) => request.json()));

vi.mock('@voodoo/core', () => ({
  TenantService: class {
    public createTenant = createTenant;
    public listTenants = listTenants;
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

describe('tenants route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSession.mockResolvedValue({
      ok: true,
      session: {
        userId: 'user-1',
        discordUserId: 'discord-user-1',
        isSuperAdmin: false,
        tenantIds: [],
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    readJson.mockImplementation(async (request: NextRequest) => request.json());
  });

  it('lists the current user workspaces', async () => {
    listTenants.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: [],
    });

    const response = await GET(new NextRequest('https://voodoopaybot.online/api/tenants'));

    expect(response.status).toBe(200);
    expect(listTenants).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('creates a workspace for the logged-in user', async () => {
    createTenant.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        id: 'tenant-2',
        name: 'Merchant Store',
        status: 'active',
      },
    });

    const request = new NextRequest('https://voodoopaybot.online/api/tenants', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Merchant Store',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(createTenant).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), {
      name: 'Merchant Store',
    });
  });
});

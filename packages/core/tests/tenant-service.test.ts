import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionPayload } from '../src/security/session-token.js';
import { TenantService } from '../src/services/tenant-service.js';

function makeSession(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    userId: 'user-1',
    discordUserId: 'discord-user-1',
    isSuperAdmin: false,
    tenantIds: ['tenant-1'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

describe('tenant service destructive controls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks only non-owner, non-self members as removable for workspace owners', async () => {
    const service = new TenantService();

    vi.spyOn((service as any).userRepository, 'getMemberRole').mockResolvedValue('owner');
    vi.spyOn((service as any).tenantRepository, 'listTenantMembers').mockResolvedValue([
      {
        userId: 'user-1',
        discordUserId: 'discord-user-1',
        username: 'owner-user',
        avatarUrl: null,
        role: 'owner',
        createdAt: new Date(),
      },
      {
        userId: 'user-2',
        discordUserId: 'discord-user-2',
        username: 'worker-user',
        avatarUrl: null,
        role: 'admin',
        createdAt: new Date(),
      },
    ]);

    const result = await service.listTenantMembers(makeSession(), {
      tenantId: 'tenant-1',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.canManageMembers).toBe(true);
    expect(result.value.canDisconnectGuild).toBe(true);
    expect(result.value.canDisconnectTelegram).toBe(true);
    expect(result.value.members).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        role: 'owner',
        removable: false,
      }),
      expect.objectContaining({
        userId: 'user-2',
        role: 'admin',
        removable: true,
      }),
    ]);
  });

  it('blocks owner removal even for a workspace owner', async () => {
    const service = new TenantService();

    vi.spyOn((service as any).userRepository, 'getMemberRole')
      .mockResolvedValueOnce('owner')
      .mockResolvedValueOnce('owner');

    const deleteTenantMember = vi.spyOn((service as any).tenantRepository, 'deleteTenantMember');

    const result = await service.removeTenantMember(makeSession(), {
      tenantId: 'tenant-1',
      userId: 'user-2',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.code).toBe('TENANT_OWNER_PROTECTED');
    expect(deleteTenantMember).not.toHaveBeenCalled();
  });

  it('disconnects a guild only when the actor has owner access', async () => {
    const service = new TenantService();

    vi.spyOn((service as any).userRepository, 'getMemberRole').mockResolvedValue('owner');
    vi.spyOn((service as any).tenantRepository, 'getTenantGuild').mockResolvedValue({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      guildName: 'Guild One',
    });
    const disconnectGuildCascade = vi
      .spyOn((service as any).tenantRepository, 'disconnectGuildCascade')
      .mockResolvedValue(undefined);

    const result = await service.disconnectGuild(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
    });

    expect(result.isOk()).toBe(true);
    expect(disconnectGuildCascade).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
    });
  });

  it('allows admins to disconnect an existing Telegram link', async () => {
    const service = new TenantService();

    vi.spyOn((service as any).userRepository, 'getMemberRole').mockResolvedValue('admin');
    vi.spyOn((service as any).tenantRepository, 'getTenantGuild').mockResolvedValue({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      guildName: 'Guild One',
    });
    vi.spyOn((service as any).telegramLinkRepository, 'getByGuild').mockResolvedValue({
      id: 'telegram-link-1',
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      chatId: '-100123',
      chatTitle: 'Ops Chat',
      linkedByDiscordUserId: 'discord-user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const deleteByGuild = vi.spyOn((service as any).telegramLinkRepository, 'deleteByGuild').mockResolvedValue(undefined);

    const result = await service.disconnectTelegramLink(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
    });

    expect(result.isOk()).toBe(true);
    expect(deleteByGuild).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
    });
  });
});

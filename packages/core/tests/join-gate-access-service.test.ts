import { afterEach, describe, expect, it, vi } from 'vitest';

import { JoinGateAccessService } from '../src/services/join-gate-access-service.js';

describe('JoinGateAccessService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats an empty authorized-user list as inactive and disallowed', async () => {
    const service = new JoinGateAccessService();
    const repository = (
      service as unknown as {
        joinGateAccessRepository: {
          listAuthorizedUsers: (input: unknown) => Promise<unknown[]>;
        };
      }
    ).joinGateAccessRepository;

    vi.spyOn(repository, 'listAuthorizedUsers').mockResolvedValue([]);

    const result = await service.getCommandAccessState({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      discordUserId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      locked: true,
      allowed: false,
      activated: false,
      authorizedUserCount: 0,
    });
  });

  it('allows a Discord user when they are on the join-gate guild access list', async () => {
    const service = new JoinGateAccessService();
    const repository = (
      service as unknown as {
        joinGateAccessRepository: {
          listAuthorizedUsers: (input: unknown) => Promise<unknown[]>;
        };
      }
    ).joinGateAccessRepository;

    vi.spyOn(repository, 'listAuthorizedUsers').mockResolvedValue([
      {
        id: 'auth-1',
        tenantId: 'tenant-1',
        guildId: 'guild-1',
        discordUserId: 'user-2',
        grantedByDiscordUserId: 'owner-1',
        createdAt: new Date('2026-03-19T12:00:00.000Z'),
        updatedAt: new Date('2026-03-19T12:00:00.000Z'),
      },
    ]);

    const result = await service.getCommandAccessState({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      discordUserId: 'user-2',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      locked: true,
      allowed: true,
      activated: true,
      authorizedUserCount: 1,
    });
  });
});

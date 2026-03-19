import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@voodoo/core', () => {
  class AppError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    constructor(code: string, message: string, statusCode: number) {
      super(message);
      this.name = 'AppError';
      this.code = code;
      this.statusCode = statusCode;
    }
  }

  class JoinGateAccessService {
    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class JoinGateService {
    public async registerJoin(): Promise<never> {
      throw new Error('Mock registerJoin not implemented');
    }
  }

  class SaleService {}

  class TenantRepository {
    public async getTenantByGuildId(): Promise<never> {
      throw new Error('Mock getTenantByGuildId not implemented');
    }

    public async getGuildConfig(): Promise<never> {
      throw new Error('Mock getGuildConfig not implemented');
    }
  }

  return {
    AppError,
    JoinGateAccessService,
    JoinGateService,
    SaleService,
    TenantRepository,
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
});

import { JoinGateAccessService, JoinGateService, TenantRepository } from '@voodoo/core';

import { handleMemberJoin } from './join-gate-runtime.js';

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

describe('join-gate runtime activation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores member joins until the server is activated for join-gate', async () => {
    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(TenantRepository.prototype, 'getGuildConfig').mockResolvedValue({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      joinGateEnabled: true,
      joinGateFallbackChannelId: 'channel-1',
      joinGateVerifiedRoleId: 'role-1',
      joinGateTicketCategoryId: 'category-1',
      joinGateCurrentLookupChannelId: 'lookup-current',
      joinGateNewLookupChannelId: 'lookup-new',
    } as Awaited<ReturnType<TenantRepository['getGuildConfig']>>);
    vi.spyOn(JoinGateAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: false,
        authorizedUserCount: 0,
      }) as Awaited<ReturnType<JoinGateAccessService['getGuildActivationState']>>,
    );
    const registerJoinSpy = vi.spyOn(JoinGateService.prototype, 'registerJoin');

    const send = vi.fn(async () => undefined);
    await handleMemberJoin({
      guild: { id: 'guild-1', name: 'Guild One' },
      id: 'member-1',
      send,
    } as never);

    expect(registerJoinSpy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

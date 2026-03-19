import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ButtonInteraction } from 'discord.js';

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
    public async markDmStatus(): Promise<never> {
      throw new Error('Mock markDmStatus not implemented');
    }

    public async setSelection(): Promise<never> {
      throw new Error('Mock setSelection not implemented');
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

import { handleJoinGateButton } from './join-gate-runtime.js';

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createResendButtonInteraction(input?: { sendImpl?: () => Promise<void> }) {
  const deferReply = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);
  const followUp = vi.fn(async () => undefined);
  const send = vi.fn(input?.sendImpl ?? (async () => undefined));

  const guild = {
    id: 'guild-1',
    name: 'Guild One',
    members: {
      fetch: vi.fn(async () => ({
        id: 'member-1',
        guild: { id: 'guild-1', name: 'Guild One' },
        send,
      })),
    },
  };

  const interaction = {
    client: {
      guilds: {
        cache: new Map([['guild-1', guild]]),
        fetch: vi.fn(async () => guild),
      },
    },
    customId: 'join-gate:resend-dm:guild-1',
    deferred: false,
    deferReply,
    editReply,
    followUp,
    inGuild: vi.fn().mockReturnValue(true),
    replied: false,
    reply,
    showModal: vi.fn(),
    user: { id: 'member-1' },
  } as unknown as ButtonInteraction;

  return {
    interaction,
    deferReply,
    editReply,
    send,
  };
}

describe('join-gate resend dm button', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-sends the verification DM from the fallback panel', async () => {
    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(TenantRepository.prototype, 'getGuildConfig').mockResolvedValue({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      staffRoleIds: [],
      joinGateEnabled: true,
      joinGateStaffRoleIds: ['role-staff'],
      joinGateFallbackChannelId: 'fallback-1',
      joinGateVerifiedRoleId: 'role-1',
      joinGateTicketCategoryId: 'cat-1',
      joinGateCurrentLookupChannelId: 'current-1',
      joinGateNewLookupChannelId: 'new-1',
      joinGatePanelTitle: 'Welcome',
      joinGatePanelMessage: 'Verify below',
    } as unknown as Awaited<ReturnType<TenantRepository['getGuildConfig']>>);
    vi.spyOn(JoinGateAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<JoinGateAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(JoinGateService.prototype, 'markDmStatus').mockResolvedValue(
      createOkResult({
        id: 'member-record-1',
      }) as Awaited<ReturnType<JoinGateService['markDmStatus']>>,
    );

    const { interaction, deferReply, editReply, send } = createResendButtonInteraction();

    const handled = await handleJoinGateButton(interaction);

    expect(handled).toBe(true);
    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(send).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledWith({
      content: 'I sent the verification DM again. Please check your Discord direct messages.',
    });
  });

  it('tells the user when the DM still cannot be delivered', async () => {
    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(TenantRepository.prototype, 'getGuildConfig').mockResolvedValue({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      staffRoleIds: [],
      joinGateEnabled: true,
      joinGateStaffRoleIds: [],
      joinGateFallbackChannelId: 'fallback-1',
      joinGateVerifiedRoleId: 'role-1',
      joinGateTicketCategoryId: 'cat-1',
      joinGateCurrentLookupChannelId: 'current-1',
      joinGateNewLookupChannelId: 'new-1',
      joinGatePanelTitle: null,
      joinGatePanelMessage: null,
    } as unknown as Awaited<ReturnType<TenantRepository['getGuildConfig']>>);
    vi.spyOn(JoinGateAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<JoinGateAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(JoinGateService.prototype, 'markDmStatus').mockResolvedValue(
      createOkResult({
        id: 'member-record-1',
      }) as Awaited<ReturnType<JoinGateService['markDmStatus']>>,
    );

    const { interaction, editReply } = createResendButtonInteraction({
      sendImpl: async () => {
        throw new Error('DMs blocked');
      },
    });

    const handled = await handleJoinGateButton(interaction);

    expect(handled).toBe(true);
    expect(editReply).toHaveBeenCalledWith({
      content:
        'I could not send the DM. Please enable DMs from this server or continue using the fallback verification panel here.',
    });
  });
});

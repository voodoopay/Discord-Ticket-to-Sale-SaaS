import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

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
    public async getCommandAccessState(): Promise<never> {
      throw new Error('Mock getCommandAccessState not implemented');
    }

    public async listAuthorizedUsers(): Promise<never> {
      throw new Error('Mock listAuthorizedUsers not implemented');
    }

    public async grantUserAccess(): Promise<never> {
      throw new Error('Mock grantUserAccess not implemented');
    }

    public async revokeUserAccess(): Promise<never> {
      throw new Error('Mock revokeUserAccess not implemented');
    }

    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class TenantRepository {
    public async getTenantByGuildId(): Promise<never> {
      throw new Error('Mock getTenantByGuildId not implemented');
    }
  }

  return {
    AppError,
    JoinGateAccessService,
    TenantRepository,
    getEnv: () => ({
      superAdminDiscordIds: (process.env.SUPER_ADMIN_DISCORD_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    }),
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    resetEnvForTests: () => undefined,
  };
});

vi.mock('../join-gate-runtime.js', () => ({
  mapJoinGateError: (error: unknown) => (error instanceof Error ? error.message : 'join-gate error'),
  runJoinGateInstall: vi.fn(async () => undefined),
  runJoinGateStatus: vi.fn(async () => undefined),
  runJoinGateSync: vi.fn(async () => undefined),
}));

import { JoinGateAccessService, resetEnvForTests, TenantRepository } from '@voodoo/core';

import { buildJoinGateAuthorizedUsersMessage, joinGateCommand } from './join-gate.js';

const ORIGINAL_SUPER_ADMIN_DISCORD_IDS = process.env.SUPER_ADMIN_DISCORD_IDS;

type InteractionMocks = {
  interaction: ChatInputCommandInteraction;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
};

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createInteractionMock(input?: {
  userId?: string;
  subcommand?: 'status' | 'sync' | 'install' | 'authorized' | 'grant' | 'revoke';
  targetUserId?: string;
}): InteractionMocks {
  const deferReply = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);

  const interaction = {
    deferred: false,
    deferReply,
    editReply,
    guild: { id: 'guild-1' },
    inGuild: vi.fn().mockReturnValue(true),
    memberPermissions: { has: vi.fn().mockReturnValue(true) },
    options: {
      getSubcommand: vi.fn().mockReturnValue(input?.subcommand ?? 'status'),
      getUser: vi.fn().mockReturnValue({ id: input?.targetUserId ?? 'user-2' }),
    },
    reply,
    user: { id: input?.userId ?? 'user-1' },
  } as unknown as ChatInputCommandInteraction;

  return {
    interaction,
    deferReply,
    editReply,
    reply,
  };
}

describe('join-gate command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('formats the authorized join-gate user list for super admins', () => {
    expect(
      buildJoinGateAuthorizedUsersMessage([
        {
          authorizationId: 'auth-1',
          discordUserId: '123',
          grantedByDiscordUserId: '999',
          createdAt: '2026-03-19T12:00:00.000Z',
          updatedAt: '2026-03-19T12:00:00.000Z',
        },
      ]),
    ).toContain('Authorized `/join-gate` users for this server:');
  });

  it('blocks non-super-admin users from granting /join-gate access', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);

    const { interaction, deferReply, editReply } = createInteractionMock({
      userId: 'user-2',
      subcommand: 'grant',
      targetUserId: 'user-3',
    });

    await joinGateCommand.execute(interaction);

    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(editReply).toHaveBeenCalledWith({
      content: 'Only the configured super admin Discord ID can manage `/join-gate` access.',
    });
  });

  it('blocks regular /join-gate usage when the guild access list is locked and the caller is not authorized', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(JoinGateAccessService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: false,
        activated: false,
        authorizedUserCount: 0,
      }) as Awaited<ReturnType<JoinGateAccessService['getCommandAccessState']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'user-2',
      subcommand: 'status',
    });

    await joinGateCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content:
        'This join-gate worker is locked for this server. A super admin must activate this server by granting your Discord ID access before you can use `/join-gate` commands.',
    });
  });

  it('lets a configured super admin grant /join-gate access', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(JoinGateAccessService.prototype, 'grantUserAccess').mockResolvedValue(
      createOkResult({
        authorizationId: 'auth-1',
        discordUserId: 'user-3',
        created: true,
      }) as Awaited<ReturnType<JoinGateAccessService['grantUserAccess']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'grant',
      targetUserId: 'user-3',
    });

    await joinGateCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: 'Granted `/join-gate` access for <@user-3> in this server.',
    });
  });
});

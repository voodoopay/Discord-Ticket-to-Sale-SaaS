import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

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

  class NukeService {
    public async getCommandAccessState(): Promise<never> {
      throw new Error('Mock getCommandAccessState not implemented');
    }

    public async getChannelSchedule(): Promise<never> {
      throw new Error('Mock getChannelSchedule not implemented');
    }

    public async grantUserAccess(): Promise<never> {
      throw new Error('Mock grantUserAccess not implemented');
    }

    public async runDeleteNow(): Promise<never> {
      throw new Error('Mock runDeleteNow not implemented');
    }

    public async listAuthorizedUsers(): Promise<never> {
      throw new Error('Mock listAuthorizedUsers not implemented');
    }

    public async revokeUserAccess(): Promise<never> {
      throw new Error('Mock revokeUserAccess not implemented');
    }

    public async createChannelSchedule(): Promise<never> {
      throw new Error('Mock createChannelSchedule not implemented');
    }

    public async disableChannelSchedule(): Promise<never> {
      throw new Error('Mock disableChannelSchedule not implemented');
    }

    public async runNukeNow(): Promise<never> {
      throw new Error('Mock runNukeNow not implemented');
    }

    public async deleteChannelSchedule(): Promise<never> {
      throw new Error('Mock deleteChannelSchedule not implemented');
    }
  }

  class TenantRepository {
    public async getTenantByGuildId(): Promise<never> {
      throw new Error('Mock getTenantByGuildId not implemented');
    }
  }

  return {
    AppError,
    NukeService,
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

import { AppError, NukeService, resetEnvForTests, TenantRepository } from '@voodoo/core';

import {
  buildAuthorizedUsersMessage,
  buildScheduleStatusMessage,
  mapNukeError,
  nukeCommand,
} from './nuke.js';

const ORIGINAL_SUPER_ADMIN_DISCORD_IDS = process.env.SUPER_ADMIN_DISCORD_IDS;

type InteractionMocks = {
  interaction: ChatInputCommandInteraction;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  userSend: ReturnType<typeof vi.fn>;
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
  subcommand?:
    | 'authorized'
    | 'grant'
    | 'revoke'
    | 'status'
    | 'schedule'
    | 'disable'
    | 'now'
    | 'delete';
  targetUserId?: string;
  confirmText?: string;
}): InteractionMocks {
  const deferReply = vi.fn(async () => {
    interaction.deferred = true;
  });
  const editReply = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);
  const userSend = vi.fn(async () => undefined);

  const interaction = {
    appPermissions: { has: vi.fn().mockReturnValue(true) },
    channel: { type: ChannelType.GuildText },
    channelId: 'channel-1',
    client: { channels: { fetch: vi.fn() } },
    deferred: false,
    deferReply,
    editReply,
    followUp: vi.fn(async () => undefined),
    guild: { id: 'guild-1' },
    guildId: 'guild-1',
    id: 'interaction-1',
    inGuild: vi.fn().mockReturnValue(true),
    memberPermissions: { has: vi.fn().mockReturnValue(true) },
    options: {
      getString: vi.fn((name: string) => {
        if (name === 'confirm') {
          return input?.confirmText ?? 'NUKE';
        }

        return null;
      }),
      getSubcommand: vi.fn().mockReturnValue(input?.subcommand ?? 'status'),
      getUser: vi.fn().mockReturnValue({ id: input?.targetUserId ?? 'user-2' }),
    },
    replied: false,
    reply,
    user: { id: input?.userId ?? 'user-1', send: userSend },
  } as unknown as ChatInputCommandInteraction & { deferred: boolean };

  return {
    interaction,
    deferReply,
    editReply,
    reply,
    userSend,
  };
}

describe('nuke command helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('shows actionable Discord worker failures instead of the generic internal error message', () => {
    const error = new AppError(
      'NUKE_DISCORD_API_ERROR',
      'Discord rejected the nuke request (500).',
      500,
    );

    expect(mapNukeError(error)).toBe('Discord rejected the nuke request (500).');
  });

  it('keeps unknown worker failures generic', () => {
    const error = new AppError('NUKE_INTERNAL_ERROR', 'database exploded', 500);

    expect(mapNukeError(error)).toBe(
      'Nuke command failed due to an internal worker error. Please try again and check logs.',
    );
  });

  it('formats schedule status output for the /nuke status reply', () => {
    expect(
      buildScheduleStatusMessage({
        scheduleId: 'schedule-1',
        channelId: 'channel-1',
        enabled: true,
        localTimeHhMm: '18:30',
        timezone: 'Europe/Berlin',
        nextRunAtUtc: '2026-03-18T17:30:00.000Z',
        lastRunAtUtc: '2026-03-17T17:30:00.000Z',
        lastLocalRunDate: '2026-03-17',
        consecutiveFailures: 0,
      }),
    ).toContain('Current daily nuke schedule for this channel:');
  });

  it('formats the authorized user list for super admins', () => {
    expect(
      buildAuthorizedUsersMessage([
        {
          authorizationId: 'auth-1',
          discordUserId: '123',
          grantedByDiscordUserId: '999',
          createdAt: '2026-03-17T12:00:00.000Z',
          updatedAt: '2026-03-17T12:00:00.000Z',
        },
      ]),
    ).toContain('Authorized `/nuke` users for this server:');
  });

  it('blocks non-super-admin users from granting /nuke access', async () => {
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

    await nukeCommand.execute(interaction);

    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Only the configured super admin Discord ID can manage `/nuke` access.',
      }),
    );
  });

  it('blocks regular /nuke usage when the guild access list is locked and the caller is not authorized', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(NukeService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: false,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<NukeService['getCommandAccessState']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'user-2',
      subcommand: 'status',
    });

    await nukeCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'This nuke worker is locked for this server. A super admin must activate this server by granting your Discord ID access before you can use `/nuke` commands.',
      }),
    );
  });

  it('shows the current schedule when the caller is authorized for /nuke usage', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(NukeService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<NukeService['getCommandAccessState']>>,
    );
    vi.spyOn(NukeService.prototype, 'getChannelSchedule').mockResolvedValue(
      createOkResult({
        scheduleId: 'schedule-1',
        channelId: 'channel-1',
        enabled: true,
        localTimeHhMm: '18:30',
        timezone: 'Europe/Berlin',
        nextRunAtUtc: '2026-03-18T17:30:00.000Z',
        lastRunAtUtc: '2026-03-17T17:30:00.000Z',
        lastLocalRunDate: '2026-03-17',
        consecutiveFailures: 1,
      }) as Awaited<ReturnType<NukeService['getChannelSchedule']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'user-2',
      subcommand: 'status',
    });

    await nukeCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Status: Enabled'),
      }),
    );
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Schedule ID: `schedule-1`'),
      }),
    );
  });

  it('lets a configured super admin grant /nuke access', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(NukeService.prototype, 'grantUserAccess').mockResolvedValue(
      createOkResult({
        authorizationId: 'auth-1',
        discordUserId: 'user-3',
        created: true,
      }) as Awaited<ReturnType<NukeService['grantUserAccess']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'grant',
      targetUserId: 'user-3',
    });

    await nukeCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Granted `/nuke` access for <@user-3> in this server.',
      }),
    );
  });

  it('deletes the current channel without creating a replacement when /nuke delete is confirmed', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(NukeService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<NukeService['getCommandAccessState']>>,
    );
    vi.spyOn(NukeService.prototype, 'runDeleteNow').mockResolvedValue(
      createOkResult({
        status: 'success',
        oldChannelId: 'channel-1',
        newChannelId: null,
        oldChannelDeleted: true,
        message:
          'Channel deleted successfully. No replacement channel was created. Any stored nuke schedule for this channel was disabled.',
      }) as Awaited<ReturnType<NukeService['runDeleteNow']>>,
    );

    const { interaction, editReply, userSend } = createInteractionMock({
      userId: 'user-2',
      subcommand: 'delete',
      confirmText: 'DELETE',
    });

    await nukeCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          'Deleting this channel now without creating a replacement. If it succeeds, I will DM you the result because this channel will be gone.',
      }),
    );
    expect(userSend).toHaveBeenCalledWith(
      expect.stringContaining('New Channel: (none)'),
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

vi.mock('@voodoo/core', () => {
  class AppError extends Error {}

  class AiAccessService {
    public async listAuthorizedUsers(): Promise<never> {
      throw new Error('Mock listAuthorizedUsers not implemented');
    }

    public async grantUserAccess(): Promise<never> {
      throw new Error('Mock grantUserAccess not implemented');
    }

    public async revokeUserAccess(): Promise<never> {
      throw new Error('Mock revokeUserAccess not implemented');
    }
  }

  return {
    AiAccessService,
    AppError,
    getEnv: () => ({
      superAdminDiscordIds: (process.env.SUPER_ADMIN_DISCORD_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    }),
    resetEnvForTests: () => undefined,
  };
});

import { AiAccessService, resetEnvForTests } from '@voodoo/core';

import { activationCommand } from './activation.js';

const ORIGINAL_SUPER_ADMIN_DISCORD_IDS = process.env.SUPER_ADMIN_DISCORD_IDS;

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createInteractionMock(input?: {
  userId?: string;
  subcommand?: 'grant' | 'revoke' | 'list';
  guildId?: string;
  userIdOption?: string;
  guildFetchRejects?: boolean;
}): {
  interaction: ChatInputCommandInteraction;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
} {
  const deferReply = vi.fn(async () => {
    interaction.deferred = true;
  });
  const editReply = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);

  const interaction = {
    client: {
      guilds: {
        fetch: input?.guildFetchRejects
          ? vi.fn(async () => {
              throw new Error('missing guild');
            })
          : vi.fn(async (guildId: string) => ({
              id: guildId,
              name: 'Remote Guild',
            })),
      },
    },
    deferred: false,
    editReply,
    deferReply,
    followUp: vi.fn(async () => undefined),
    options: {
      getSubcommand: vi.fn().mockReturnValue(input?.subcommand ?? 'grant'),
      getString: vi.fn((name: string) => {
        if (name === 'guild_id') {
          return input?.guildId ?? '123456789012345678';
        }

        return input?.userIdOption ?? '234567890123456789';
      }),
    },
    replied: false,
    reply,
    user: { id: input?.userId ?? 'user-1' },
  } as unknown as ChatInputCommandInteraction & { deferred: boolean };

  return { interaction, deferReply, editReply, reply };
}

describe('ai activation command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('blocks non-super-admin users', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    const { interaction, reply } = createInteractionMock({ userId: 'user-2' });

    await activationCommand.execute(interaction);

    expect(reply).toHaveBeenCalledWith({
      content: 'Only the configured super admin Discord ID can manage AI activation.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('grants remote AI access by guild ID and user ID', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(AiAccessService.prototype, 'grantUserAccess').mockResolvedValue(
      createOkResult({
        authorizationId: 'auth-1',
        discordUserId: '234567890123456789',
        created: true,
      }) as Awaited<ReturnType<AiAccessService['grantUserAccess']>>,
    );

    const { interaction, deferReply, editReply } = createInteractionMock({
      userId: 'owner-1',
    });

    await activationCommand.execute(interaction);

    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(editReply).toHaveBeenCalledWith({
      content: 'Granted AI access for `234567890123456789` in `Remote Guild` (`123456789012345678`).',
    });
  });

  it('lists authorized users for a guild', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(AiAccessService.prototype, 'listAuthorizedUsers').mockResolvedValue(
      createOkResult([
        {
          authorizationId: 'auth-1',
          discordUserId: '234567890123456789',
          grantedByDiscordUserId: 'owner-1',
          createdAt: '2026-04-23T12:00:00.000Z',
          updatedAt: '2026-04-23T12:00:00.000Z',
        },
      ]) as Awaited<ReturnType<AiAccessService['listAuthorizedUsers']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'list',
    });

    await activationCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: [
        'Authorized AI users for `Remote Guild` (`123456789012345678`):',
        '<@234567890123456789> (`234567890123456789`)',
      ].join('\n'),
    });
  });

  it('revokes remote AI access by guild ID and user ID', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(AiAccessService.prototype, 'revokeUserAccess').mockResolvedValue(
      createOkResult({
        revoked: true,
      }) as Awaited<ReturnType<AiAccessService['revokeUserAccess']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'revoke',
    });

    await activationCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: 'Revoked AI access for `234567890123456789` in `Remote Guild` (`123456789012345678`).',
    });
  });

  it('returns an ephemeral error when the worker is not in the target guild', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      guildFetchRejects: true,
    });

    await activationCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: 'This AI worker is not present in the target server, or the server ID is invalid.',
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

vi.mock('@voodoo/core', () => {
  class SportsAccessService {
    public async getCommandAccessState(): Promise<never> {
      throw new Error('Mock getCommandAccessState not implemented');
    }

    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class SportsService {
    public async getGuildStatus(): Promise<never> {
      throw new Error('Mock getGuildStatus not implemented');
    }
  }

  return {
    SportsAccessService,
    SportsService,
    getEnv: () => ({
      superAdminDiscordIds: (process.env.SUPER_ADMIN_DISCORD_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    }),
    resetEnvForTests: () => undefined,
  };
});

vi.mock('../sports-runtime.js', () => ({
  mapSportsError: (error: unknown) => (error instanceof Error ? error.message : 'sports error'),
  publishSportsForGuild: vi.fn(async () => ({
    publishedChannelCount: 2,
    listingCount: 4,
    createdChannelCount: 0,
  })),
  syncSportsGuildChannels: vi.fn(async () => ({
    config: {
      configId: 'cfg-1',
      guildId: 'guild-1',
      enabled: true,
      managedCategoryChannelId: 'category-1',
      localTimeHhMm: '01:00',
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      nextRunAtUtc: '2026-03-21T01:00:00.000Z',
      lastRunAtUtc: null,
      lastLocalRunDate: null,
    },
    channelCount: 2,
    createdChannelCount: 2,
    updatedChannelCount: 0,
  })),
}));

import { SportsAccessService, resetEnvForTests } from '@voodoo/core';

import { sportsCommand } from './sports.js';

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
  subcommand?: 'setup' | 'sync' | 'refresh' | 'status';
  categoryName?: string | null;
}): {
  interaction: ChatInputCommandInteraction;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
} {
  const deferReply = vi.fn(async () => {
    interaction.deferred = true;
  });
  const editReply = vi.fn(async () => undefined);

  const interaction = {
    deferred: false,
    editReply,
    deferReply,
    followUp: vi.fn(async () => undefined),
    guild: {
      id: 'guild-1',
      members: {
        me: {
          permissions: {
            has: vi.fn().mockReturnValue(true),
          },
        },
        fetchMe: vi.fn(async () => ({
          permissions: {
            has: vi.fn().mockReturnValue(true),
          },
        })),
      },
    },
    inGuild: vi.fn().mockReturnValue(true),
    memberPermissions: {
      has: vi.fn((permission: bigint) =>
        permission === PermissionFlagsBits.ManageGuild ||
        permission === PermissionFlagsBits.Administrator,
      ),
    },
    options: {
      getSubcommand: vi.fn().mockReturnValue(input?.subcommand ?? 'status'),
      getString: vi.fn((name: string) => {
        if (name === 'category_name') {
          return input?.categoryName ?? null;
        }

        return null;
      }),
    },
    replied: false,
    reply: vi.fn(async () => undefined),
    user: { id: input?.userId ?? 'user-1' },
  } as unknown as ChatInputCommandInteraction & { deferred: boolean };

  return {
    interaction,
    deferReply,
    editReply,
  };
}

describe('sports command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('blocks regular users when the sports worker is still locked', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(SportsAccessService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: false,
        activated: false,
        authorizedUserCount: 0,
      }) as Awaited<ReturnType<SportsAccessService['getCommandAccessState']>>,
    );

    const { interaction, deferReply, editReply } = createInteractionMock({
      userId: 'user-2',
      subcommand: 'status',
    });

    await sportsCommand.execute(interaction);

    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(editReply).toHaveBeenCalledWith({
      content:
        'This sports worker is locked for this server. A super admin must activate this server by granting your Discord ID access before `/sports` commands can be used here.',
    });
  });

  it('runs setup and includes the activation-pending note for super admins', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: false,
        authorizedUserCount: 0,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'setup',
      categoryName: 'Sports Listings',
    });

    await sportsCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining(
        'Activation is still pending. Run `/activation grant guild_id:guild-1 user_id:<customer-user-id>`',
      ),
    });
    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Channels published today: 2'),
    });
    expect(editReply).toHaveBeenCalledWith({
      content: expect.not.stringContaining('Empty sport channels today'),
    });
  });
});

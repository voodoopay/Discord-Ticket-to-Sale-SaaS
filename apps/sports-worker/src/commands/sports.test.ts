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

    public async getGuildConfig(): Promise<never> {
      throw new Error('Mock getGuildConfig not implemented');
    }

    public async listChannelBindings(): Promise<never> {
      throw new Error('Mock listChannelBindings not implemented');
    }
  }

  class SportsDataService {
    public async listDailyListingsForLocalDate(): Promise<never> {
      throw new Error('Mock listDailyListingsForLocalDate not implemented');
    }
  }

  class SportsLiveEventService {
    public async listTrackedEvents(): Promise<never> {
      throw new Error('Mock listTrackedEvents not implemented');
    }
  }

  return {
    SportsAccessService,
    SportsDataService,
    SportsLiveEventService,
    SportsService,
    getEnv: () => ({
      superAdminDiscordIds: (process.env.SUPER_ADMIN_DISCORD_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      SPORTS_DEFAULT_PUBLISH_TIME: '01:00',
      SPORTS_DEFAULT_TIMEZONE: 'Europe/London',
      SPORTS_BROADCAST_COUNTRY: 'United Kingdom',
      SPORTS_POLL_INTERVAL_MS: 60000,
    }),
    resetEnvForTests: () => undefined,
    resolveSportsLocalDate: () => '2026-03-20',
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

import {
  SportsAccessService,
  SportsDataService,
  SportsLiveEventService,
  SportsService,
  resetEnvForTests,
} from '@voodoo/core';

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
  subcommand?: 'setup' | 'sync' | 'refresh' | 'status' | 'live-status';
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

function createMessageCollectionWithFreshMessage() {
  return {
    size: 1,
    filter: vi.fn((predicate: (message: { id: string; createdTimestamp: number }) => boolean) => {
      const message = {
        id: 'message-1',
        createdTimestamp: Date.now(),
        delete: vi.fn(async () => undefined),
      };
      return predicate(message)
        ? new Map([[message.id, message]])
        : new Map<string, typeof message>();
    }),
  };
}

function createManagedTextChannel(id: string, name: string) {
  const messages = {
    fetch: vi.fn(async () => createMessageCollectionWithFreshMessage()),
  };

  return {
    id,
    name,
    type: 0,
    parentId: 'category-1',
    topic: 'managed topic',
    send: vi.fn(async () => undefined),
    edit: vi.fn(async () => undefined),
    bulkDelete: vi.fn(async () => undefined),
    messages,
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

  it('shows live-status with tracked events, pending cleanup counts, and sync health', async () => {
    vi.spyOn(SportsAccessService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: false,
        allowed: true,
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getCommandAccessState']>>,
    );
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents').mockResolvedValue(
      createOkResult([
        {
          id: 'tracked-1',
          guildId: 'guild-1',
          sportName: 'Soccer',
          eventId: 'evt-1',
          eventName: 'Rangers vs Celtic',
          sportChannelId: 'sport-1',
          eventChannelId: 'live-1',
          status: 'live',
          kickoffAtUtc: new Date('2026-03-20T15:00:00.000Z'),
          lastScoreSnapshot: { scoreLabel: '2-1' },
          lastStateSnapshot: { statusLabel: 'Live' },
          lastSyncedAtUtc: new Date(),
          finishedAtUtc: null,
          deleteAfterUtc: null,
          highlightsPosted: false,
          createdAt: new Date('2026-03-20T15:00:00.000Z'),
          updatedAt: new Date('2026-03-20T15:58:00.000Z'),
        },
        {
          id: 'tracked-2',
          guildId: 'guild-1',
          sportName: 'Soccer',
          eventId: 'evt-2',
          eventName: 'Hearts vs Hibs',
          sportChannelId: 'sport-1',
          eventChannelId: 'live-2',
          status: 'cleanup_due',
          kickoffAtUtc: new Date('2026-03-20T12:00:00.000Z'),
          lastScoreSnapshot: { scoreLabel: '1-0' },
          lastStateSnapshot: { statusLabel: 'FT' },
          lastSyncedAtUtc: new Date(),
          finishedAtUtc: new Date('2026-03-20T14:45:00.000Z'),
          deleteAfterUtc: new Date('2026-03-20T17:45:00.000Z'),
          highlightsPosted: false,
          createdAt: new Date('2026-03-20T12:00:00.000Z'),
          updatedAt: new Date('2026-03-20T14:45:00.000Z'),
        },
      ]) as unknown as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'user-2',
      subcommand: 'live-status',
    });

    await sportsCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Tracked live events: 2'),
    });
    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Pending cleanup: 1'),
    });
    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Sync health: Healthy'),
    });
  });

  it('clears stale managed sport channels that have no listings today', async () => {
    vi.resetModules();

    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult({
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
      }) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    vi.spyOn(SportsService.prototype, 'listChannelBindings').mockResolvedValue(
      createOkResult([
        {
          bindingId: 'binding-1',
          guildId: 'guild-1',
          sportId: 'soccer',
          sportName: 'Soccer',
          sportSlug: 'soccer',
          channelId: 'sport-1',
          createdAt: new Date('2026-03-20T12:00:00.000Z'),
          updatedAt: new Date('2026-03-20T12:00:00.000Z'),
        },
        {
          bindingId: 'binding-2',
          guildId: 'guild-1',
          sportId: 'rugby',
          sportName: 'Rugby Union',
          sportSlug: 'rugby-union',
          channelId: 'sport-2',
          createdAt: new Date('2026-03-20T12:00:00.000Z'),
          updatedAt: new Date('2026-03-20T12:00:00.000Z'),
        },
      ]) as unknown as Awaited<ReturnType<SportsService['listChannelBindings']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'listDailyListingsForLocalDate').mockResolvedValue(
      createOkResult([
        {
          sportName: 'Soccer',
          listings: [
            {
              eventId: 'evt-1',
              eventName: 'Rangers vs Celtic',
              sportName: 'Soccer',
              startTimeUkLabel: '15:00',
              imageUrl: null,
              eventCountry: null,
              season: null,
              broadcasters: [
                {
                  channelId: 'chan-1',
                  channelName: 'Sky Sports Main Event',
                  country: 'United Kingdom',
                  logoUrl: null,
                },
              ],
            },
          ],
        },
        {
          sportName: 'Rugby Union',
          listings: [],
        },
      ]) as Awaited<ReturnType<SportsDataService['listDailyListingsForLocalDate']>>,
    );

    const soccerChannel = createManagedTextChannel('sport-1', 'soccer');
    const rugbyChannel = createManagedTextChannel('sport-2', 'rugby-union');
    const guild = {
      id: 'guild-1',
      channels: {
        fetch: vi.fn(async (channelId?: string) => {
          if (channelId === 'category-1') {
            return { id: 'category-1', type: 4 };
          }
          if (channelId === 'sport-1') {
            return soccerChannel;
          }
          if (channelId === 'sport-2') {
            return rugbyChannel;
          }
          return new Map<string, unknown>([
            ['category-1', { id: 'category-1', name: 'Sports Listings', type: 4 }],
            ['sport-1', soccerChannel],
            ['sport-2', rugbyChannel],
          ]);
        }),
      },
    };

    const { publishSportsForGuild } = (await vi.importActual('../sports-runtime.js')) as {
      publishSportsForGuild: (input: {
        guild: unknown;
        actorDiscordUserId: string | null;
      }) => Promise<unknown>;
    };
    await publishSportsForGuild({
      guild: guild as never,
      actorDiscordUserId: 'user-1',
    });

    expect(rugbyChannel.bulkDelete).toHaveBeenCalled();
    expect(rugbyChannel.send).not.toHaveBeenCalled();
    expect(soccerChannel.send).toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

vi.mock('@voodoo/core', () => {
  class SportsAccessService {
    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class SportsDataService {
    public async searchEvents(): Promise<never> {
      throw new Error('Mock searchEvents not implemented');
    }

    public async getEventDetails(): Promise<never> {
      throw new Error('Mock getEventDetails not implemented');
    }
  }

  class SportsService {
    public async getGuildConfig(): Promise<never> {
      throw new Error('Mock getGuildConfig not implemented');
    }
  }

  return {
    SportsAccessService,
    SportsDataService,
    SportsService,
    getEnv: () => ({
      superAdminDiscordIds: (process.env.SUPER_ADMIN_DISCORD_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      SPORTS_DEFAULT_TIMEZONE: 'Europe/London',
      SPORTS_BROADCAST_COUNTRY: 'United Kingdom',
    }),
    resetEnvForTests: () => undefined,
  };
});

vi.mock('../sports-runtime.js', () => ({
  mapSportsError: (error: unknown) => (error instanceof Error ? error.message : 'sports error'),
}));

vi.mock('../ui/sports-embeds.js', () => ({
  buildSearchResultEmbed: vi.fn((details: unknown) => ({ details })),
  buildSearchFallbackEmbed: vi.fn((result: unknown) => ({ result })),
}));

import {
  SportsAccessService,
  SportsDataService,
  SportsService,
  resetEnvForTests,
} from '@voodoo/core';

import { searchCommand } from './search.js';

const ORIGINAL_SUPER_ADMIN_DISCORD_IDS = process.env.SUPER_ADMIN_DISCORD_IDS;

function createOkResult<T>(value: T): any {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createInteractionMock(input?: {
  userId?: string;
  query?: string;
}): {
  interaction: ChatInputCommandInteraction;
  editReply: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
} {
  const editReply = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);

  const interaction = {
    appPermissions: {
      has: vi.fn((permission: bigint) =>
        permission === PermissionFlagsBits.ViewChannel ||
        permission === PermissionFlagsBits.SendMessages ||
        permission === PermissionFlagsBits.EmbedLinks,
      ),
    },
    deferred: false,
    deferReply: vi.fn(async () => {
      interaction.deferred = true;
    }),
    editReply,
    followUp: vi.fn(async () => undefined),
    guildId: 'guild-1',
    inGuild: vi.fn().mockReturnValue(true),
    options: {
      getString: vi.fn().mockReturnValue(input?.query ?? 'Rangers v Celtic'),
    },
    replied: false,
    reply,
    user: { id: input?.userId ?? 'user-1' },
  } as unknown as ChatInputCommandInteraction & { deferred: boolean };

  return {
    interaction,
    editReply,
    reply,
  };
}

describe('search command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('blocks regular users when the sports worker is not activated', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: false,
        authorizedUserCount: 0,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'user-2',
    });

    await searchCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content:
        'This server is not activated for the sports worker yet. A super admin must grant access with `/activation grant guild_id:<server-id> user_id:<user-id>` before `/search` can be used here.',
    });
  });

  it('returns all upcoming sports event details found in the next 7 days', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'searchEvents').mockResolvedValue(
      createOkResult([
        {
          eventId: 'event-1',
          eventName: 'Rangers vs Celtic',
          sportName: 'Soccer',
          leagueName: 'Scottish Premiership',
          dateEvent: '2026-03-21',
          imageUrl: null,
        },
        {
          eventId: 'event-2',
          eventName: 'Rangers vs Hearts',
          sportName: 'Soccer',
          leagueName: 'Scottish Premiership',
          dateEvent: '2026-03-24',
          imageUrl: null,
        },
      ]) as Awaited<ReturnType<SportsDataService['searchEvents']>>,
    );
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    const getEventDetails = vi
      .spyOn(SportsDataService.prototype, 'getEventDetails')
      .mockResolvedValueOnce(
        createOkResult({
          eventId: 'event-1',
          eventName: 'Rangers vs Celtic',
          sportName: 'Soccer',
          leagueName: 'Scottish Premiership',
          venueName: 'Ibrox',
          country: 'United Kingdom',
          city: 'Glasgow',
          dateUkLabel: 'Saturday, 21 March 2026',
          startTimeUkLabel: '12:30',
          imageUrl: null,
          description: null,
          broadcasters: [],
        }) as Awaited<ReturnType<SportsDataService['getEventDetails']>>,
      )
      .mockResolvedValueOnce(
        createOkResult({
          eventId: 'event-2',
          eventName: 'Rangers vs Hearts',
          sportName: 'Soccer',
          leagueName: 'Scottish Premiership',
          venueName: 'Ibrox',
          country: 'United Kingdom',
          city: 'Glasgow',
          dateUkLabel: 'Tuesday, 24 March 2026',
          startTimeUkLabel: '19:45',
          imageUrl: null,
          description: null,
          broadcasters: [],
        }) as Awaited<ReturnType<SportsDataService['getEventDetails']>>,
      );

    const { interaction, editReply } = createInteractionMock({
      userId: 'user-2',
      query: 'Rangers v Celtic',
    });

    await searchCommand.execute(interaction);

    expect(getEventDetails).toHaveBeenCalledTimes(2);
    expect(editReply).toHaveBeenCalledWith({
      content: 'Found 2 upcoming televised events for `Rangers v Celtic` from today through the next 7 days.',
      embeds: [expect.any(Object), expect.any(Object)],
    });
  });
});

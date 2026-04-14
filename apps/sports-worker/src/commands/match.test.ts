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

    public async getResults(): Promise<never> {
      throw new Error('Mock getResults not implemented');
    }

    public async getEventDetails(): Promise<never> {
      throw new Error('Mock getEventDetails not implemented');
    }

    public async getEventHighlights(): Promise<never> {
      throw new Error('Mock getEventHighlights not implemented');
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
      SPORTS_POLL_INTERVAL_MS: 60000,
    }),
    pickBestSportsSearchResult: (_query: string, results: unknown[]) => results[0] ?? null,
    resetEnvForTests: () => undefined,
  };
});

vi.mock('../sports-runtime.js', () => ({
  mapSportsError: (error: unknown) => (error instanceof Error ? error.message : 'sports error'),
}));

import {
  SportsAccessService,
  SportsDataService,
  SportsService,
  resetEnvForTests,
} from '@voodoo/core';

import { matchCommand } from './match.js';

const ORIGINAL_SUPER_ADMIN_DISCORD_IDS = process.env.SUPER_ADMIN_DISCORD_IDS;

function createOkResult<T>(value: T): any {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createInteractionMock(query = 'Rangers vs Celtic'): {
  interaction: ChatInputCommandInteraction;
  editReply: ReturnType<typeof vi.fn>;
} {
  const editReply = vi.fn(async () => undefined);

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
      getString: vi.fn(() => query),
    },
    replied: false,
    reply: vi.fn(async () => undefined),
    user: { id: 'user-1' },
  } as unknown as ChatInputCommandInteraction & { deferred: boolean };

  return { interaction, editReply };
}

describe('match command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('returns a match-centre style response for the best matching event', async () => {
    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult({
        timezone: 'Europe/London',
        broadcastCountry: 'United Kingdom',
        broadcastCountries: ['United Kingdom', 'United States'],
      }) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'searchEvents').mockResolvedValue(
      createOkResult([
        {
          eventId: 'evt-1',
          eventName: 'Rangers vs Celtic',
          sportName: 'Soccer',
          leagueName: 'Scottish Premiership',
          dateEvent: '2026-03-21',
          imageUrl: null,
        },
      ]) as Awaited<ReturnType<SportsDataService['searchEvents']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getResults').mockResolvedValue(
      createOkResult([]) as Awaited<ReturnType<SportsDataService['getResults']>>,
    );
    const getEventDetails = vi.spyOn(SportsDataService.prototype, 'getEventDetails').mockResolvedValue(
      createOkResult({
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        sportName: 'Soccer',
        leagueName: 'Scottish Premiership',
        venueName: 'Ibrox',
        country: 'United Kingdom',
        city: 'Glasgow',
        dateUkLabel: 'Saturday, 21 March 2026',
        startTimeUkLabel: '12:30',
        imageUrl: null,
        description: 'A title-deciding derby.',
        broadcasters: [{ channelId: 'chan-1', channelName: 'Sky Sports', country: 'United Kingdom', logoUrl: null }],
      }) as Awaited<ReturnType<SportsDataService['getEventDetails']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getEventHighlights').mockResolvedValue(
      createOkResult({
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        sportName: 'Soccer',
        videoUrl: 'https://youtube.com/watch?v=123',
        imageUrl: null,
      }) as Awaited<ReturnType<SportsDataService['getEventHighlights']>>,
    );

    const { interaction, editReply } = createInteractionMock();

    await matchCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Match centre for'),
      embeds: [expect.any(Object)],
    });
    expect(getEventDetails).toHaveBeenCalledWith({
      eventId: 'evt-1',
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
    });
  });

  it('labels fallback responses as recent results when details are unavailable', async () => {
    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult({
        timezone: 'Europe/London',
        broadcastCountry: 'United Kingdom',
        broadcastCountries: ['United Kingdom', 'United States'],
      }) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'searchEvents').mockResolvedValue(
      createOkResult([
        {
          eventId: 'evt-upcoming',
          eventName: 'Rangers vs Hearts',
          sportName: 'Soccer',
          leagueName: 'Scottish Premiership',
          dateEvent: '2026-03-25',
          imageUrl: null,
        },
      ]) as Awaited<ReturnType<SportsDataService['searchEvents']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getResults').mockResolvedValue(
      createOkResult([
        {
          eventId: 'evt-result',
          eventName: 'Rangers vs Celtic',
          sportName: 'Soccer',
          leagueName: 'Scottish Premiership',
          dateEvent: '2026-03-18',
          imageUrl: null,
        },
      ]) as Awaited<ReturnType<SportsDataService['getResults']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getEventDetails').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsDataService['getEventDetails']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getEventHighlights').mockResolvedValue(
      createOkResult({
        eventId: 'evt-result',
        eventName: 'Rangers vs Celtic',
        sportName: 'Soccer',
        videoUrl: 'https://youtube.com/watch?v=result',
        imageUrl: null,
      }) as Awaited<ReturnType<SportsDataService['getEventHighlights']>>,
    );

    const { interaction, editReply } = createInteractionMock('Rangers');

    await matchCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Recent result match centre for `Rangers vs Celtic`.'),
      embeds: [expect.any(Object)],
    });
    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('https://youtube.com/watch?v=result'),
      embeds: [expect.any(Object)],
    });
  });

  it('labels fallback responses as upcoming fixtures when details are unavailable', async () => {
    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult({
        timezone: 'Europe/London',
        broadcastCountry: 'United Kingdom',
        broadcastCountries: ['United Kingdom', 'United States'],
      }) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'searchEvents').mockResolvedValue(
      createOkResult([
        {
          eventId: 'evt-upcoming',
          eventName: 'Rangers vs Hearts',
          sportName: 'Soccer',
          leagueName: 'Scottish Premiership',
          dateEvent: '2026-03-25',
          imageUrl: null,
        },
      ]) as Awaited<ReturnType<SportsDataService['searchEvents']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getResults').mockResolvedValue(
      createOkResult([]) as Awaited<ReturnType<SportsDataService['getResults']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getEventDetails').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsDataService['getEventDetails']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getEventHighlights').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsDataService['getEventHighlights']>>,
    );

    const { interaction, editReply } = createInteractionMock('Rangers');

    await matchCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: 'Upcoming fixture match centre for `Rangers vs Hearts`.',
      embeds: [expect.any(Object)],
    });
  });
});

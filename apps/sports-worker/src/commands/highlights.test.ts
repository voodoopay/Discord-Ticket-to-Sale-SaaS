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
    normalizeBroadcastCountries: (input: readonly string[] | null | undefined) => {
      const normalized = [
        ...new Set(
          (input ?? [])
            .map((value) => value?.trim?.() ?? '')
            .filter((value) => value.length > 0),
        ),
      ];

      return normalized.length > 0 ? normalized : ['United Kingdom', 'United States'];
    },
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

import { highlightsCommand } from './highlights.js';

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

describe('highlights command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('returns on-demand highlights for a finished matching event', async () => {
    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'searchEvents').mockResolvedValue(
      createOkResult([]) as Awaited<ReturnType<SportsDataService['searchEvents']>>,
    );
    const getResults = vi
      .spyOn(SportsDataService.prototype, 'getResults')
      .mockResolvedValue(
        createOkResult([
          {
            eventId: 'evt-1',
            eventName: 'Rangers vs Celtic',
            sportName: 'Soccer',
            leagueName: 'Scottish Premiership',
            dateEvent: '2026-03-21',
            imageUrl: null,
          },
        ]) as Awaited<ReturnType<SportsDataService['getResults']>>,
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

    await highlightsCommand.execute(interaction);

    expect(getResults).toHaveBeenCalledWith({ query: 'Rangers vs Celtic' });
    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Highlights for'),
      embeds: [expect.any(Object)],
    });
  });

  it('prefers a recent result with highlights over an upcoming fixture for the same team query', async () => {
    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
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
    vi.spyOn(SportsDataService.prototype, 'getEventHighlights').mockImplementation(
      async (input: { eventId: string }) =>
        createOkResult(
          input.eventId === 'evt-result'
            ? {
                eventId: 'evt-result',
                eventName: 'Rangers vs Celtic',
                sportName: 'Soccer',
                videoUrl: 'https://youtube.com/watch?v=result',
                imageUrl: null,
              }
            : null,
        ) as Awaited<ReturnType<SportsDataService['getEventHighlights']>>,
    );

    const { interaction, editReply } = createInteractionMock('Rangers');

    await highlightsCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: 'Highlights for `Rangers vs Celtic`.',
      embeds: [expect.any(Object)],
    });
  });
});

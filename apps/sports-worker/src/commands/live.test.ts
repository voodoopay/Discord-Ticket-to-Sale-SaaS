import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

vi.mock('@voodoo/core', () => {
  class SportsAccessService {
    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class SportsDataService {
    public async listLiveEvents(): Promise<never> {
      throw new Error('Mock listLiveEvents not implemented');
    }

    public async listLiveEventsAcrossCountries(): Promise<never> {
      throw new Error('Mock listLiveEventsAcrossCountries not implemented');
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

import { liveCommand } from './live.js';

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
  sport?: string | null;
  league?: string | null;
}): {
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
      getString: vi.fn((name: string) => {
        if (name === 'sport') {
          return input?.sport ?? null;
        }
        if (name === 'league') {
          return input?.league ?? null;
        }

        return null;
      }),
    },
    replied: false,
    reply: vi.fn(async () => undefined),
    user: { id: input?.userId ?? 'user-1' },
  } as unknown as ChatInputCommandInteraction & { deferred: boolean };

  return { interaction, editReply };
}

describe('live command', () => {
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

    await liveCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content:
        'This server is not activated for the sports worker yet. A super admin must grant access with `/activation grant guild_id:<server-id> user_id:<user-id>` before `/live` can be used here.',
    });
  });

  it('uses the guild shared-country config for live lookups', async () => {
    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult({
        timezone: 'America/New_York',
        broadcastCountry: 'United Kingdom',
        broadcastCountries: ['United Kingdom', 'United States'],
      }) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    const listLiveEventsAcrossCountries = vi
      .spyOn(SportsDataService.prototype, 'listLiveEventsAcrossCountries')
      .mockResolvedValue(
        createOkResult({
          data: [
          {
            eventId: 'evt-1',
            eventName: 'Rangers vs Celtic',
            sportName: 'Soccer',
            leagueName: 'Scottish Premiership',
            statusLabel: 'Live',
            scoreLabel: '2-1',
            startTimeUkLabel: '12:30',
            imageUrl: null,
            broadcasters: [{ channelId: 'chan-1', channelName: 'Sky Sports', country: 'United Kingdom', logoUrl: null }],
          },
          {
            eventId: 'evt-2',
            eventName: 'Lakers vs Celtics',
            sportName: 'Basketball',
            leagueName: 'NBA',
            statusLabel: 'Live',
            scoreLabel: '95-90',
            startTimeUkLabel: '01:00',
            imageUrl: null,
            broadcasters: [{ channelId: 'chan-2', channelName: 'TNT Sports', country: 'United States', logoUrl: null }],
          },
          ],
          degraded: false,
          failedCountries: [],
          successfulCountries: ['United Kingdom', 'United States'],
        }) as Awaited<ReturnType<SportsDataService['listLiveEventsAcrossCountries']>>,
      );

    const { interaction, editReply } = createInteractionMock({
      sport: 'Soccer',
      league: 'Scottish Premiership',
    });

    await liveCommand.execute(interaction);

    expect(listLiveEventsAcrossCountries).toHaveBeenCalledWith({
      timezone: 'America/New_York',
      broadcastCountries: ['United Kingdom', 'United States'],
    });
    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Found 1 live televised event'),
      embeds: [expect.any(Object)],
    });
  });
});

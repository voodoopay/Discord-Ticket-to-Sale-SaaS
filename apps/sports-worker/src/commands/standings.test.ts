import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

vi.mock('@voodoo/core', () => {
  class SportsAccessService {
    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class SportsDataService {
    public async getStandings(): Promise<never> {
      throw new Error('Mock getStandings not implemented');
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

import { standingsCommand } from './standings.js';

const ORIGINAL_SUPER_ADMIN_DISCORD_IDS = process.env.SUPER_ADMIN_DISCORD_IDS;

function createOkResult<T>(value: T): any {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createInteractionMock(league = 'Scottish Premiership'): {
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
      getString: vi.fn(() => league),
    },
    replied: false,
    reply: vi.fn(async () => undefined),
    user: { id: 'user-1' },
  } as unknown as ChatInputCommandInteraction & { deferred: boolean };

  return { interaction, editReply };
}

describe('standings command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('returns the current league table with an embed', async () => {
    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getStandings').mockResolvedValue(
      createOkResult({
        leagueId: 'league-1',
        leagueName: 'Scottish Premiership',
        sportName: 'Soccer',
        imageUrl: null,
        rows: [
          {
            rank: 1,
            teamId: 'team-1',
            teamName: 'Rangers',
            played: 30,
            wins: 24,
            draws: 3,
            losses: 3,
            goalsFor: 70,
            goalsAgainst: 22,
            goalDifference: 48,
            points: 75,
          },
        ],
      }) as Awaited<ReturnType<SportsDataService['getStandings']>>,
    );

    const { interaction, editReply } = createInteractionMock();

    await standingsCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Standings for'),
      embeds: [expect.any(Object)],
    });
  });
});

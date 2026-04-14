import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

vi.mock('@voodoo/core', () => {
  class SportsAccessService {
    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class SportsDataService {
    public async getTeamDetails(): Promise<never> {
      throw new Error('Mock getTeamDetails not implemented');
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

import { teamCommand } from './team.js';

const ORIGINAL_SUPER_ADMIN_DISCORD_IDS = process.env.SUPER_ADMIN_DISCORD_IDS;

function createOkResult<T>(value: T): any {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createInteractionMock(query = 'Rangers'): {
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

describe('team command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('returns a team page style summary including the roster overview', async () => {
    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getTeamDetails').mockResolvedValue(
      createOkResult({
        teamId: 'team-1',
        teamName: 'Rangers',
        sportName: 'Soccer',
        leagueName: 'Scottish Premiership',
        country: 'Scotland',
        stadiumName: 'Ibrox',
        description: 'A historic club from Glasgow.',
        imageUrl: null,
        bannerUrl: null,
        players: [
          { playerId: 'player-1', playerName: 'James Tavernier', position: 'Defender', imageUrl: null },
          { playerId: 'player-2', playerName: 'Jack Butland', position: 'Goalkeeper', imageUrl: null },
        ],
      }) as Awaited<ReturnType<SportsDataService['getTeamDetails']>>,
    );

    const { interaction, editReply } = createInteractionMock();

    await teamCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Team profile for'),
      embeds: [expect.any(Object)],
    });
  });
});

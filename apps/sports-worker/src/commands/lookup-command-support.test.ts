import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';

vi.mock('@voodoo/core', () => {
  class SportsAccessService {
    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class SportsDataService {}

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
      superAdminDiscordIds: ['user-1'],
      SPORTS_DEFAULT_TIMEZONE: 'Europe/London',
      SPORTS_BROADCAST_COUNTRY: 'United Kingdom',
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

import { SportsService } from '@voodoo/core';

import { resolveLookupContext } from './lookup-command-support.js';

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

describe('lookup command support', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults shared-country lookups to United Kingdom and United States when no saved config exists', async () => {
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );

    const interaction = {
      guildId: 'guild-1',
      user: { id: 'user-1' },
    } as ChatInputCommandInteraction;

    const result = await resolveLookupContext({
      interaction,
      commandName: 'live',
    });

    expect(result).toEqual({
      guildId: 'guild-1',
      timezone: 'Europe/London',
      broadcastCountries: ['United Kingdom', 'United States'],
      primaryBroadcastCountry: 'United Kingdom',
    });
  });
});

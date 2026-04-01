import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@voodoo/core', () => {
  class SportsService {
    public async getGuildConfig(): Promise<never> {
      throw new Error('Mock getGuildConfig not implemented');
    }

    public async upsertGuildConfig(): Promise<never> {
      throw new Error('Mock upsertGuildConfig not implemented');
    }

    public async listChannelBindings(): Promise<never> {
      throw new Error('Mock listChannelBindings not implemented');
    }

    public async upsertChannelBinding(): Promise<never> {
      throw new Error('Mock upsertChannelBinding not implemented');
    }
  }

  class SportsDataService {
    public async listDailyListingsForLocalDate(): Promise<never> {
      throw new Error('Mock listDailyListingsForLocalDate not implemented');
    }
  }

  class SportsAccessService {}

  return {
    AppError: class AppError extends Error {},
    SportsAccessService,
    SportsDataService,
    SportsService,
    getEnv: () => ({
      SPORTS_DEFAULT_PUBLISH_TIME: '00:01',
      SPORTS_DEFAULT_TIMEZONE: 'Europe/London',
      SPORTS_BROADCAST_COUNTRY: 'United Kingdom',
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    resolveSportsLocalDate: () => '2026-03-20',
  };
});

import { SportsDataService, SportsService } from '@voodoo/core';
import { syncSportsGuildChannels } from './sports-runtime.js';

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

describe('sports runtime country handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves the existing broadcaster country during sync when no override is provided', async () => {
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult({
        configId: 'cfg-1',
        guildId: 'guild-1',
        enabled: true,
        managedCategoryChannelId: 'category-1',
        localTimeHhMm: '00:01',
        timezone: 'America/New_York',
        broadcastCountry: 'United States',
        nextRunAtUtc: '2026-03-21T04:01:00.000Z',
        lastRunAtUtc: null,
        lastLocalRunDate: null,
      }) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    const upsertGuildConfig = vi.spyOn(SportsService.prototype, 'upsertGuildConfig').mockResolvedValue(
      createOkResult({
        configId: 'cfg-1',
        guildId: 'guild-1',
        enabled: true,
        managedCategoryChannelId: 'category-1',
        localTimeHhMm: '00:01',
        timezone: 'America/New_York',
        broadcastCountry: 'United States',
        nextRunAtUtc: '2026-03-21T04:01:00.000Z',
        lastRunAtUtc: null,
        lastLocalRunDate: null,
      }) as Awaited<ReturnType<SportsService['upsertGuildConfig']>>,
    );
    vi.spyOn(SportsService.prototype, 'listChannelBindings').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsService['listChannelBindings']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'listDailyListingsForLocalDate').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsDataService['listDailyListingsForLocalDate']>>,
    );

    const guild = {
      id: 'guild-1',
      channels: {
        fetch: vi.fn(async (channelId?: string) => {
          if (channelId === 'category-1') {
            return { id: 'category-1', name: 'Sports Listings', type: 4, setName: vi.fn(async () => undefined) };
          }

          return new Map<string, unknown>([['category-1', { id: 'category-1', name: 'Sports Listings', type: 4 }]]);
        }),
        create: vi.fn(async () => ({ id: 'category-1', name: 'Sports Listings', type: 4 })),
      },
    };

    await syncSportsGuildChannels({
      guild: guild as never,
      actorDiscordUserId: 'user-1',
      categoryName: null,
    });

    expect(upsertGuildConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: 'America/New_York',
        localTimeHhMm: '00:01',
        broadcastCountry: 'United States',
      }),
    );
  });

  it('stores a dedicated live event category when one is configured during sync', async () => {
    vi.spyOn(SportsService.prototype, 'getGuildConfig').mockResolvedValue(
      createOkResult(null) as Awaited<ReturnType<SportsService['getGuildConfig']>>,
    );
    const upsertGuildConfig = vi.spyOn(SportsService.prototype, 'upsertGuildConfig').mockResolvedValue(
      createOkResult({
        configId: 'cfg-1',
        guildId: 'guild-1',
        enabled: true,
        managedCategoryChannelId: 'category-1',
        liveCategoryChannelId: 'live-category-1',
        localTimeHhMm: '00:01',
        timezone: 'Europe/London',
        broadcastCountry: 'United Kingdom',
        nextRunAtUtc: '2026-03-21T00:01:00.000Z',
        lastRunAtUtc: null,
        lastLocalRunDate: null,
      }) as Awaited<ReturnType<SportsService['upsertGuildConfig']>>,
    );
    vi.spyOn(SportsService.prototype, 'listChannelBindings').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsService['listChannelBindings']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'listDailyListingsForLocalDate').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsDataService['listDailyListingsForLocalDate']>>,
    );

    const createdCategories: Array<{ name: string; type: number }> = [];
    const guild = {
      id: 'guild-1',
      channels: {
        fetch: vi.fn(async () => new Map<string, unknown>()),
        create: vi.fn(async (input: { name: string; type: number }) => {
          createdCategories.push(input);
          if (input.name === 'Sports Listings') {
            return { id: 'category-1', name: input.name, type: 4 };
          }

          return { id: 'live-category-1', name: input.name, type: 4 };
        }),
      },
    };

    await syncSportsGuildChannels({
      guild: guild as never,
      actorDiscordUserId: 'user-1',
      categoryName: 'Sports Listings',
      liveCategoryName: 'Live Sports',
    });

    expect(createdCategories).toHaveLength(2);
    expect(upsertGuildConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        managedCategoryChannelId: 'category-1',
        liveCategoryChannelId: 'live-category-1',
      }),
    );
  });
});

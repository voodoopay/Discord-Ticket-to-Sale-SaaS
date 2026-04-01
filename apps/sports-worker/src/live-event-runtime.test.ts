import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelType,
  Collection,
  type CategoryChannel,
  type Guild,
  type TextChannel,
} from 'discord.js';

vi.mock('@voodoo/core', () => {
  class SportsDataService {
    public async listLiveEvents(): Promise<never> {
      throw new Error('Mock listLiveEvents not implemented');
    }
  }

  class SportsAccessService {
    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class SportsLiveEventService {
    public async upsertTrackedEvent(): Promise<never> {
      throw new Error('Mock upsertTrackedEvent not implemented');
    }

    public async markFinished(): Promise<never> {
      throw new Error('Mock markFinished not implemented');
    }
  }

  class SportsService {
    public async getGuildConfig(): Promise<never> {
      throw new Error('Mock getGuildConfig not implemented');
    }

    public async listChannelBindings(): Promise<never> {
      throw new Error('Mock listChannelBindings not implemented');
    }

    public async upsertChannelBinding(): Promise<never> {
      throw new Error('Mock upsertChannelBinding not implemented');
    }
  }

  return {
    SportsDataService,
    SportsAccessService,
    SportsLiveEventService,
    SportsService,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

import {
  SportsDataService,
  SportsLiveEventService,
  SportsService,
  type SportsLiveEvent,
} from '@voodoo/core';

import {
  LIVE_EVENT_TOPIC_PREFIX,
  reconcileLiveEventsForGuild,
  runPendingLiveEventCleanup,
} from './live-event-runtime.js';

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createCategoryChannel(id: string, name: string): CategoryChannel {
  return {
    id,
    name,
    type: ChannelType.GuildCategory,
  } as CategoryChannel;
}

function createTextChannel(input: {
  id: string;
  name: string;
  parentId: string | null;
  topic?: string | null;
}): TextChannel {
  const channel = {
    id: input.id,
    name: input.name,
    parentId: input.parentId,
    topic: input.topic ?? null,
    type: ChannelType.GuildText,
    delete: vi.fn(async () => undefined),
    edit: vi.fn(async (options: Partial<TextChannel>) => {
      if (typeof options.name === 'string') {
        channel.name = options.name;
      }
      if ('topic' in options) {
        channel.topic = options.topic ?? null;
      }
      if ('parent' in options) {
        channel.parentId = typeof options.parent === 'string' ? options.parent : channel.parentId;
      }
      return channel;
    }),
    send: vi.fn(async () => undefined),
    bulkDelete: vi.fn(async () => undefined),
    messages: {
      fetch: vi.fn(async () => new Collection()),
    },
  };

  return channel as unknown as TextChannel;
}

function createGuildFixture() {
  const channels = new Map<string, CategoryChannel | TextChannel>();
  const category = createCategoryChannel('category-1', 'Sports Listings');
  const soccerChannel = createTextChannel({
    id: 'sport-1',
    name: 'soccer',
    parentId: category.id,
  });
  const rugbyChannel = createTextChannel({
    id: 'sport-2',
    name: 'rugby-union',
    parentId: category.id,
  });

  channels.set(category.id, category);
  channels.set(soccerChannel.id, soccerChannel);
  channels.set(rugbyChannel.id, rugbyChannel);

  let createdChannelCount = 0;
  const create = vi.fn(
    async (options: {
      name: string;
      type: ChannelType;
      parent?: string;
      topic?: string;
    }) => {
      createdChannelCount += 1;
      const channel = createTextChannel({
        id: `live-${createdChannelCount}`,
        name: options.name,
        parentId: options.parent ?? null,
        topic: options.topic ?? null,
      });
      channels.set(channel.id, channel);
      return channel;
    },
  );

  const fetch = vi.fn(async (channelId?: string) => {
    if (typeof channelId === 'string') {
      return channels.get(channelId) ?? null;
    }

    return new Collection([...channels.entries()]);
  });

  const guild = {
    id: 'guild-1',
    channels: {
      create,
      fetch,
    },
  } as unknown as Guild;

  return {
    guild,
    channels,
    category,
    soccerChannel,
    rugbyChannel,
    create,
  };
}

function makeLiveEvent(overrides: Partial<SportsLiveEvent> = {}): SportsLiveEvent {
  return {
    eventId: 'evt-1',
    eventName: 'Rangers vs Celtic',
    sportName: 'Soccer',
    leagueName: 'Scottish Premiership',
    statusLabel: 'Live',
    scoreLabel: '2-1',
    startTimeUkLabel: '15:00',
    imageUrl: 'https://img.test/live-event.jpg',
    broadcasters: [
      {
        channelId: 'chan-1',
        channelName: 'Sky Sports Main Event',
        country: 'United Kingdom',
        logoUrl: null,
      },
    ],
    ...overrides,
  };
}

describe('live event runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates one event channel for each televised live event', async () => {
    const { guild, create } = createGuildFixture();

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
    vi.spyOn(SportsDataService.prototype, 'listLiveEvents').mockResolvedValue(
      createOkResult([
        makeLiveEvent({
          eventId: 'evt-1',
          eventName: 'Rangers vs Celtic',
          sportName: 'Soccer',
        }),
        makeLiveEvent({
          eventId: 'evt-2',
          eventName: 'Scotland vs Ireland',
          sportName: 'Rugby Union',
          leagueName: 'Six Nations',
          scoreLabel: '14-9',
        }),
        makeLiveEvent({
          eventId: 'evt-3',
          eventName: 'Closed-Door Friendly',
          broadcasters: [],
        }),
      ]) as Awaited<ReturnType<SportsDataService['listLiveEvents']>>,
    );
    vi.spyOn(SportsLiveEventService.prototype, 'upsertTrackedEvent').mockResolvedValue(
      createOkResult({
        id: 'tracked-1',
        guildId: 'guild-1',
        sportName: 'Soccer',
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        sportChannelId: 'sport-1',
        eventChannelId: null,
        status: 'scheduled',
        kickoffAtUtc: new Date('2026-03-20T15:00:00.000Z'),
        lastScoreSnapshot: null,
        lastStateSnapshot: null,
        lastSyncedAtUtc: null,
        finishedAtUtc: null,
        deleteAfterUtc: null,
        highlightsPosted: false,
        createdAt: new Date('2026-03-20T12:00:00.000Z'),
        updatedAt: new Date('2026-03-20T12:00:00.000Z'),
      }) as Awaited<ReturnType<SportsLiveEventService['upsertTrackedEvent']>>,
    );

    const result = await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T15:05:00.000Z'),
    });

    expect(result.createdChannelCount).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.stringMatching(/^live-/) }),
    );
  });

  it('reuses the existing live event channel on later reconciles', async () => {
    const { guild, channels, create } = createGuildFixture();

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
      ]) as unknown as Awaited<ReturnType<SportsService['listChannelBindings']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'listLiveEvents').mockResolvedValue(
      createOkResult([makeLiveEvent()]) as Awaited<ReturnType<SportsDataService['listLiveEvents']>>,
    );
    vi.spyOn(SportsLiveEventService.prototype, 'upsertTrackedEvent').mockResolvedValue(
      createOkResult({
        id: 'tracked-1',
        guildId: 'guild-1',
        sportName: 'Soccer',
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        sportChannelId: 'sport-1',
        eventChannelId: null,
        status: 'scheduled',
        kickoffAtUtc: new Date('2026-03-20T15:00:00.000Z'),
        lastScoreSnapshot: null,
        lastStateSnapshot: null,
        lastSyncedAtUtc: null,
        finishedAtUtc: null,
        deleteAfterUtc: null,
        highlightsPosted: false,
        createdAt: new Date('2026-03-20T12:00:00.000Z'),
        updatedAt: new Date('2026-03-20T12:00:00.000Z'),
      }) as Awaited<ReturnType<SportsLiveEventService['upsertTrackedEvent']>>,
    );

    const firstResult = await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T15:05:00.000Z'),
    });
    const existingChannel = [...channels.values()].find(
      (channel): channel is TextChannel =>
        channel.type === ChannelType.GuildText &&
        channel.topic?.startsWith(LIVE_EVENT_TOPIC_PREFIX) === true,
    );

    const secondResult = await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T15:07:00.000Z'),
    });

    expect(firstResult.createdChannelCount).toBe(1);
    expect(existingChannel).toBeDefined();
    expect(secondResult.createdChannelCount).toBe(0);
    expect(secondResult.updatedChannelCount).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('deletes finished event channels after the three-hour cleanup window', async () => {
    const { guild, channels } = createGuildFixture();
    const eventChannel = createTextChannel({
      id: 'live-cleanup-1',
      name: 'live-rangers-vs-celtic',
      parentId: 'category-1',
      topic: `${LIVE_EVENT_TOPIC_PREFIX}${JSON.stringify({
        version: 1,
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        sportName: 'Soccer',
        sportChannelId: 'sport-1',
        cleanupAfterUtc: '2026-03-20T18:00:00.000Z',
      })}`,
    });
    channels.set(eventChannel.id, eventChannel);

    await runPendingLiveEventCleanup({
      guild,
      now: new Date('2026-03-20T18:05:00.000Z'),
    });

    expect(eventChannel.delete).toHaveBeenCalled();
  });
});

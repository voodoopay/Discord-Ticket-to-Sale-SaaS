import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  ChannelType,
  Collection,
  type CategoryChannel,
  type Guild,
  type TextChannel,
} from 'discord.js';

vi.mock('p-queue', () => ({
  default: class MockPQueue {
    public async add<T>(task: () => Promise<T>): Promise<T> {
      return task();
    }
  },
}));

vi.mock('@voodoo/core', () => {
  class SportsDataService {
    public async listLiveEvents(): Promise<never> {
      throw new Error('Mock listLiveEvents not implemented');
    }

    public async getEventHighlights(): Promise<never> {
      throw new Error('Mock getEventHighlights not implemented');
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

    public async listTrackedEvents(): Promise<never> {
      throw new Error('Mock listTrackedEvents not implemented');
    }

    public async listRecoverableEvents(): Promise<never> {
      throw new Error('Mock listRecoverableEvents not implemented');
    }

    public async markFinished(): Promise<never> {
      throw new Error('Mock markFinished not implemented');
    }

    public async markHighlightsPosted(): Promise<never> {
      throw new Error('Mock markHighlightsPosted not implemented');
    }

    public async markDeleted(): Promise<never> {
      throw new Error('Mock markDeleted not implemented');
    }

    public async markFailed(): Promise<never> {
      throw new Error('Mock markFailed not implemented');
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
  SportsAccessService,
  SportsDataService,
  SportsLiveEventService,
  SportsService,
  logger,
  type SportsLiveEvent,
} from '@voodoo/core';

import {
  reconcileLiveEventsForGuild,
  resumeTrackedLiveEventsForGuild,
  runPendingLiveEventCleanup,
  startLiveEventScheduler,
  stopLiveEventScheduler,
} from './live-event-runtime.js';

type MockTrackedEvent = {
  id: string;
  guildId: string;
  sportName: string;
  eventId: string;
  eventName: string;
  sportChannelId: string;
  eventChannelId: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'cleanup_due' | 'deleted' | 'failed';
  kickoffAtUtc: Date;
  lastScoreSnapshot: Record<string, unknown> | null;
  lastStateSnapshot: Record<string, unknown> | null;
  lastSyncedAtUtc: Date | null;
  finishedAtUtc: Date | null;
  deleteAfterUtc: Date | null;
  highlightsPosted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createErrResult<TError>(error: TError): { isErr: () => true; isOk: () => false; error: TError } {
  return {
    isErr: () => true,
    isOk: () => false,
    error,
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

function createClientFixture(guild: Guild) {
  return {
    guilds: {
      fetch: vi.fn(async (guildId?: string) => {
        if (typeof guildId === 'string') {
          return guild;
        }

        return new Collection([[guild.id, { id: guild.id }]]);
      }),
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
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

function makeTrackedEvent(overrides: Partial<MockTrackedEvent> = {}): MockTrackedEvent {
  return {
    id: 'tracked-1',
    guildId: 'guild-1',
    sportName: 'Soccer',
    eventId: 'evt-1',
    eventName: 'Rangers vs Celtic',
    sportChannelId: 'sport-1',
    eventChannelId: 'live-1',
    status: 'live' as const,
    kickoffAtUtc: new Date('2026-03-20T15:00:00.000Z'),
    lastScoreSnapshot: null,
    lastStateSnapshot: null,
    lastSyncedAtUtc: new Date('2026-03-20T15:05:00.000Z'),
    finishedAtUtc: null,
    deleteAfterUtc: null,
    highlightsPosted: false,
    createdAt: new Date('2026-03-20T12:00:00.000Z'),
    updatedAt: new Date('2026-03-20T15:05:00.000Z'),
    ...overrides,
  };
}

describe('live event runtime', () => {
  afterEach(() => {
    stopLiveEventScheduler();
    vi.useRealTimers();
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
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
    );
    const upsertTrackedEvent = vi
      .spyOn(SportsLiveEventService.prototype, 'upsertTrackedEvent')
      .mockResolvedValueOnce(
        createOkResult(
          makeTrackedEvent({
            id: 'tracked-1',
            eventId: 'evt-1',
            eventName: 'Rangers vs Celtic',
            sportName: 'Soccer',
            sportChannelId: 'sport-1',
            eventChannelId: 'live-1',
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['upsertTrackedEvent']>>,
      )
      .mockResolvedValueOnce(
        createOkResult(
          makeTrackedEvent({
            id: 'tracked-2',
            eventId: 'evt-2',
            eventName: 'Scotland vs Ireland',
            sportName: 'Rugby Union',
            sportChannelId: 'sport-2',
            eventChannelId: 'live-2',
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['upsertTrackedEvent']>>,
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
    expect(upsertTrackedEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventId: 'evt-1',
        eventChannelId: 'live-1',
        status: 'live',
      }),
    );
    expect(upsertTrackedEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventId: 'evt-2',
        eventChannelId: 'live-2',
        status: 'live',
      }),
    );
  });

  it('reuses the existing live event channel on later reconciles', async () => {
    const { guild, channels, create } = createGuildFixture();
    const existingLiveChannel = createTextChannel({
      id: 'live-1',
      name: 'live-rangers-vs-celtic',
      parentId: 'category-1',
    });
    channels.set(existingLiveChannel.id, existingLiveChannel);

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
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents').mockResolvedValue(
      createOkResult([
        makeTrackedEvent({
          eventChannelId: 'live-1',
          status: 'live',
        }),
      ]) as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
    );
    const upsertTrackedEvent = vi
      .spyOn(SportsLiveEventService.prototype, 'upsertTrackedEvent')
      .mockResolvedValue(
        createOkResult(
          makeTrackedEvent({
            eventChannelId: 'live-1',
            status: 'live',
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['upsertTrackedEvent']>>,
      );

    const result = await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T15:07:00.000Z'),
    });

    expect(result.createdChannelCount).toBe(0);
    expect(result.updatedChannelCount).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(upsertTrackedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-1',
        eventChannelId: 'live-1',
        status: 'live',
      }),
    );
    expect(existingLiveChannel.edit).toHaveBeenCalled();
  });

  it('skips Discord rewrites but persists the sync heartbeat when the live event state is unchanged', async () => {
    const { guild, channels, create } = createGuildFixture();
    const existingLiveChannel = createTextChannel({
      id: 'live-1',
      name: 'live-rangers-vs-celtic',
      parentId: 'category-1',
    });
    channels.set(existingLiveChannel.id, existingLiveChannel);

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
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents').mockResolvedValue(
      createOkResult([
        makeTrackedEvent({
          eventChannelId: 'live-1',
          status: 'live',
          lastScoreSnapshot: { scoreLabel: '2-1' },
          lastStateSnapshot: { statusLabel: 'Live', broadcasterCount: 1 },
        }),
      ]) as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
    );
    const upsertTrackedEvent = vi
      .spyOn(SportsLiveEventService.prototype, 'upsertTrackedEvent')
      .mockResolvedValue(
        createOkResult(
          makeTrackedEvent({
            eventChannelId: 'live-1',
            status: 'live',
            lastScoreSnapshot: { scoreLabel: '2-1' },
            lastStateSnapshot: { statusLabel: 'Live', broadcasterCount: 1 },
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['upsertTrackedEvent']>>,
      );

    const result = await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T15:07:00.000Z'),
    });

    expect(result.createdChannelCount).toBe(0);
    expect(result.updatedChannelCount).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(existingLiveChannel.edit).not.toHaveBeenCalled();
    expect(existingLiveChannel.send).not.toHaveBeenCalled();
    expect(existingLiveChannel.messages.fetch).not.toHaveBeenCalled();
    expect(upsertTrackedEvent).toHaveBeenCalledTimes(1);
    expect(upsertTrackedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-1',
        eventChannelId: 'live-1',
        lastSyncedAtUtc: new Date('2026-03-20T15:07:00.000Z'),
        status: 'live',
      }),
    );
  });

  it('posts highlights only once when a finished tracked event later gains a video', async () => {
    const { guild, channels } = createGuildFixture();
    const existingLiveChannel = createTextChannel({
      id: 'live-1',
      name: 'live-rangers-vs-celtic',
      parentId: 'category-1',
    });
    channels.set(existingLiveChannel.id, existingLiveChannel);

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
      createOkResult([]) as unknown as Awaited<ReturnType<SportsDataService['listLiveEvents']>>,
    );
    const getEventHighlights = vi
      .spyOn(SportsDataService.prototype, 'getEventHighlights')
      .mockResolvedValueOnce(
        createOkResult(null) as Awaited<ReturnType<SportsDataService['getEventHighlights']>>,
      )
      .mockResolvedValueOnce(
        createOkResult({
          eventId: 'evt-1',
          eventName: 'Rangers vs Celtic',
          sportName: 'Soccer',
          videoUrl: 'https://videos.test/highlights/rangers-celtic',
          imageUrl: 'https://videos.test/highlights/rangers-celtic.jpg',
        }) as Awaited<ReturnType<SportsDataService['getEventHighlights']>>,
      );
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents')
      .mockResolvedValueOnce(
        createOkResult([
          makeTrackedEvent({
            eventChannelId: 'live-1',
            status: 'live',
            highlightsPosted: false,
          }),
        ]) as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
      )
      .mockResolvedValueOnce(
        createOkResult([
          makeTrackedEvent({
            eventChannelId: 'live-1',
            status: 'cleanup_due',
            finishedAtUtc: new Date('2026-03-20T15:15:00.000Z'),
            deleteAfterUtc: new Date('2026-03-20T18:15:00.000Z'),
            highlightsPosted: false,
          }),
        ]) as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
      )
      .mockResolvedValueOnce(
        createOkResult([
          makeTrackedEvent({
            eventChannelId: 'live-1',
            status: 'cleanup_due',
            finishedAtUtc: new Date('2026-03-20T15:15:00.000Z'),
            deleteAfterUtc: new Date('2026-03-20T18:15:00.000Z'),
            highlightsPosted: true,
          }),
        ]) as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
      );
    const markFinished = vi
      .spyOn(SportsLiveEventService.prototype, 'markFinished')
      .mockResolvedValue(
        createOkResult(
          makeTrackedEvent({
            eventChannelId: 'live-1',
            status: 'cleanup_due',
            finishedAtUtc: new Date('2026-03-20T15:15:00.000Z'),
            deleteAfterUtc: new Date('2026-03-20T18:15:00.000Z'),
            highlightsPosted: false,
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['markFinished']>>,
      );
    const markHighlightsPosted = vi
      .spyOn(SportsLiveEventService.prototype, 'markHighlightsPosted')
      .mockResolvedValue(
        createOkResult(
          makeTrackedEvent({
            eventChannelId: 'live-1',
            status: 'cleanup_due',
            finishedAtUtc: new Date('2026-03-20T15:15:00.000Z'),
            deleteAfterUtc: new Date('2026-03-20T18:15:00.000Z'),
            highlightsPosted: true,
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['markHighlightsPosted']>>,
      );

    await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T15:15:00.000Z'),
    });
    await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T15:45:00.000Z'),
    });
    await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T16:00:00.000Z'),
    });

    expect(markFinished).toHaveBeenCalledTimes(1);
    expect(getEventHighlights).toHaveBeenCalledTimes(2);
    expect(markHighlightsPosted).toHaveBeenCalledTimes(1);
    expect(existingLiveChannel.send).toHaveBeenCalledTimes(3);
  });

  it('persists highlight delivery before sending the highlight message', async () => {
    const { guild, channels } = createGuildFixture();
    const existingLiveChannel = createTextChannel({
      id: 'live-1',
      name: 'live-rangers-vs-celtic',
      parentId: 'category-1',
    });
    channels.set(existingLiveChannel.id, existingLiveChannel);

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
      createOkResult([]) as unknown as Awaited<ReturnType<SportsService['listChannelBindings']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'listLiveEvents').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsDataService['listLiveEvents']>>,
    );
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents').mockResolvedValue(
      createOkResult([
        makeTrackedEvent({
          eventChannelId: 'live-1',
          status: 'cleanup_due',
          finishedAtUtc: new Date('2026-03-20T15:15:00.000Z'),
          deleteAfterUtc: new Date('2026-03-20T18:15:00.000Z'),
          highlightsPosted: false,
        }),
      ]) as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getEventHighlights').mockResolvedValue(
      createOkResult({
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        sportName: 'Soccer',
        videoUrl: 'https://videos.test/highlights/rangers-celtic',
        imageUrl: 'https://videos.test/highlights/rangers-celtic.jpg',
      }) as Awaited<ReturnType<SportsDataService['getEventHighlights']>>,
    );
    const markHighlightsPosted = vi
      .spyOn(SportsLiveEventService.prototype, 'markHighlightsPosted')
      .mockResolvedValue(
        createOkResult(
          makeTrackedEvent({
            eventChannelId: 'live-1',
            status: 'cleanup_due',
            finishedAtUtc: new Date('2026-03-20T15:15:00.000Z'),
            deleteAfterUtc: new Date('2026-03-20T18:15:00.000Z'),
            highlightsPosted: true,
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['markHighlightsPosted']>>,
      );

    await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T15:45:00.000Z'),
    });

    expect(markHighlightsPosted).toHaveBeenCalledTimes(1);
    expect(existingLiveChannel.send).toHaveBeenCalledTimes(1);
    const sendMock = existingLiveChannel.send as unknown as Mock;
    const persistedAtCallOrder = markHighlightsPosted.mock.invocationCallOrder[0];
    const sentAtCallOrder = sendMock.mock.invocationCallOrder[0];
    expect(persistedAtCallOrder).toBeDefined();
    expect(sentAtCallOrder).toBeDefined();
    expect(persistedAtCallOrder ?? Number.POSITIVE_INFINITY).toBeLessThan(
      sentAtCallOrder ?? Number.NEGATIVE_INFINITY,
    );
  });

  it('does not send highlights when the highlight reservation write fails', async () => {
    const { guild, channels } = createGuildFixture();
    const existingLiveChannel = createTextChannel({
      id: 'live-1',
      name: 'live-rangers-vs-celtic',
      parentId: 'category-1',
    });
    channels.set(existingLiveChannel.id, existingLiveChannel);
    const warnSpy = vi.spyOn(logger, 'warn');

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
      createOkResult([]) as unknown as Awaited<ReturnType<SportsService['listChannelBindings']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'listLiveEvents').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsDataService['listLiveEvents']>>,
    );
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents').mockResolvedValue(
      createOkResult([
        makeTrackedEvent({
          eventChannelId: 'live-1',
          status: 'cleanup_due',
          finishedAtUtc: new Date('2026-03-20T15:15:00.000Z'),
          deleteAfterUtc: new Date('2026-03-20T18:15:00.000Z'),
          highlightsPosted: false,
        }),
      ]) as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'getEventHighlights').mockResolvedValue(
      createOkResult({
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        sportName: 'Soccer',
        videoUrl: 'https://videos.test/highlights/rangers-celtic',
        imageUrl: 'https://videos.test/highlights/rangers-celtic.jpg',
      }) as Awaited<ReturnType<SportsDataService['getEventHighlights']>>,
    );
    const markHighlightsPosted = vi
      .spyOn(SportsLiveEventService.prototype, 'markHighlightsPosted')
      .mockResolvedValue(
        createErrResult(new Error('write failed')) as Awaited<
          ReturnType<SportsLiveEventService['markHighlightsPosted']>
        >,
      );

    await reconcileLiveEventsForGuild({
      guild,
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
      now: new Date('2026-03-20T15:45:00.000Z'),
    });

    expect(markHighlightsPosted).toHaveBeenCalledTimes(1);
    expect(existingLiveChannel.send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('marks a tracked event as failed during recovery when its channel is missing', async () => {
    const { guild, create } = createGuildFixture();
    const markFailed = vi
      .spyOn(SportsLiveEventService.prototype, 'markFailed')
      .mockResolvedValue(
        createOkResult(
          makeTrackedEvent({
            eventChannelId: 'missing-live-channel',
            status: 'failed',
            lastSyncedAtUtc: new Date('2026-03-20T16:05:00.000Z'),
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['markFailed']>>,
      );
    const warnSpy = vi.spyOn(logger, 'warn');

    vi.spyOn(SportsLiveEventService.prototype, 'listRecoverableEvents').mockResolvedValue(
      createOkResult([
        makeTrackedEvent({
          eventChannelId: 'missing-live-channel',
          status: 'live',
        }),
      ]) as Awaited<ReturnType<SportsLiveEventService['listRecoverableEvents']>>,
    );

    await resumeTrackedLiveEventsForGuild({
      guild,
      now: new Date('2026-03-20T16:05:00.000Z'),
    });

    expect(markFailed).toHaveBeenCalledWith({
      guildId: 'guild-1',
      eventId: 'evt-1',
      failedAtUtc: new Date('2026-03-20T16:05:00.000Z'),
    });
    expect(create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('recovers tracked live channels on scheduler start without creating duplicates', async () => {
    const { guild, channels, create } = createGuildFixture();
    const existingLiveChannel = createTextChannel({
      id: 'live-1',
      name: 'live-rangers-vs-celtic',
      parentId: 'category-1',
    });
    channels.set(existingLiveChannel.id, existingLiveChannel);
    const client = createClientFixture(guild);

    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
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
    const listRecoverableEvents = vi
      .spyOn(SportsLiveEventService.prototype, 'listRecoverableEvents')
      .mockResolvedValue(
        createOkResult([
          makeTrackedEvent({
            eventChannelId: 'live-1',
            status: 'live',
            lastScoreSnapshot: { scoreLabel: '2-1' },
            lastStateSnapshot: { statusLabel: 'Live', broadcasterCount: 1 },
          }),
        ]) as Awaited<ReturnType<SportsLiveEventService['listRecoverableEvents']>>,
      );
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents').mockResolvedValue(
      createOkResult([
        makeTrackedEvent({
          eventChannelId: 'live-1',
          status: 'live',
          lastScoreSnapshot: { scoreLabel: '2-1' },
          lastStateSnapshot: { statusLabel: 'Live', broadcasterCount: 1 },
        }),
      ]) as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
    );
    vi.spyOn(SportsLiveEventService.prototype, 'upsertTrackedEvent').mockResolvedValue(
      createOkResult(
        makeTrackedEvent({
          eventChannelId: 'live-1',
          status: 'live',
          lastScoreSnapshot: { scoreLabel: '2-1' },
          lastStateSnapshot: { statusLabel: 'Live', broadcasterCount: 1 },
        }),
      ) as Awaited<ReturnType<SportsLiveEventService['upsertTrackedEvent']>>,
    );
    const markFailed = vi.spyOn(SportsLiveEventService.prototype, 'markFailed');

    startLiveEventScheduler(client as never, 60_000);
    await flushAsyncWork();

    expect(listRecoverableEvents).toHaveBeenCalledWith({
      guildId: 'guild-1',
    });
    expect(create).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('runs overdue cleanup immediately during startup recovery', async () => {
    const { guild, channels } = createGuildFixture();
    const overdueChannel = createTextChannel({
      id: 'live-overdue-1',
      name: 'live-rangers-vs-celtic',
      parentId: 'category-1',
    });
    channels.set(overdueChannel.id, overdueChannel);
    const client = createClientFixture(guild);

    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
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
      createOkResult([]) as unknown as Awaited<ReturnType<SportsService['listChannelBindings']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'listLiveEvents').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsDataService['listLiveEvents']>>,
    );
    vi.spyOn(SportsLiveEventService.prototype, 'listRecoverableEvents').mockResolvedValue(
      createOkResult([
        makeTrackedEvent({
          eventId: 'evt-overdue',
          eventChannelId: 'live-overdue-1',
          status: 'cleanup_due',
          finishedAtUtc: new Date('2026-03-20T15:00:00.000Z'),
          deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
          highlightsPosted: true,
        }),
      ]) as Awaited<ReturnType<SportsLiveEventService['listRecoverableEvents']>>,
    );
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
    );
    const markDeleted = vi
      .spyOn(SportsLiveEventService.prototype, 'markDeleted')
      .mockResolvedValue(
        createOkResult(
          makeTrackedEvent({
            eventId: 'evt-overdue',
            eventChannelId: null,
            status: 'deleted',
            finishedAtUtc: new Date('2026-03-20T15:00:00.000Z'),
            deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
            highlightsPosted: true,
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['markDeleted']>>,
      );

    startLiveEventScheduler(client as never, 60_000);
    await flushAsyncWork();

    expect(overdueChannel.delete).toHaveBeenCalled();
    expect(markDeleted).toHaveBeenCalledWith({
      guildId: 'guild-1',
      eventId: 'evt-overdue',
      deletedAtUtc: expect.any(Date),
    });
  });

  it('runs tracked-event recovery only on scheduler startup and not on later poll ticks', async () => {
    vi.useFakeTimers();

    const { guild } = createGuildFixture();
    const client = createClientFixture(guild);

    vi.spyOn(SportsAccessService.prototype, 'getGuildActivationState').mockResolvedValue(
      createOkResult({
        activated: true,
      }) as Awaited<ReturnType<SportsAccessService['getGuildActivationState']>>,
    );
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
      createOkResult([]) as unknown as Awaited<ReturnType<SportsService['listChannelBindings']>>,
    );
    vi.spyOn(SportsDataService.prototype, 'listLiveEvents').mockResolvedValue(
      createOkResult([]) as unknown as Awaited<ReturnType<SportsDataService['listLiveEvents']>>,
    );
    const listRecoverableEvents = vi
      .spyOn(SportsLiveEventService.prototype, 'listRecoverableEvents')
      .mockResolvedValue(
        createOkResult([]) as unknown as Awaited<ReturnType<SportsLiveEventService['listRecoverableEvents']>>,
      );
    const listTrackedEvents = vi
      .spyOn(SportsLiveEventService.prototype, 'listTrackedEvents')
      .mockResolvedValue(
        createOkResult([]) as unknown as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
      );

    startLiveEventScheduler(client as never, 60_000);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(listRecoverableEvents).toHaveBeenCalledTimes(1);
    expect(listTrackedEvents).toHaveBeenCalledTimes(4);
  });

  it('deletes finished event channels after the three-hour cleanup window', async () => {
    const { guild, channels } = createGuildFixture();
    const eventChannel = createTextChannel({
      id: 'live-cleanup-1',
      name: 'live-rangers-vs-celtic',
      parentId: 'category-1',
    });
    channels.set(eventChannel.id, eventChannel);
    vi.spyOn(SportsLiveEventService.prototype, 'listTrackedEvents').mockResolvedValue(
      createOkResult([
        makeTrackedEvent({
          eventId: 'evt-1',
          eventChannelId: 'live-cleanup-1',
          status: 'cleanup_due',
          finishedAtUtc: new Date('2026-03-20T15:00:00.000Z'),
          deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
        }),
      ]) as Awaited<ReturnType<SportsLiveEventService['listTrackedEvents']>>,
    );
    const markDeleted = vi
      .spyOn(SportsLiveEventService.prototype, 'markDeleted')
      .mockResolvedValue(
        createOkResult(
          makeTrackedEvent({
            eventId: 'evt-1',
            eventChannelId: 'live-cleanup-1',
            status: 'deleted',
            finishedAtUtc: new Date('2026-03-20T15:00:00.000Z'),
            deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
          }),
        ) as Awaited<ReturnType<SportsLiveEventService['markDeleted']>>,
      );

    await runPendingLiveEventCleanup({
      guild,
      now: new Date('2026-03-20T18:05:00.000Z'),
    });

    expect(eventChannel.delete).toHaveBeenCalled();
    expect(markDeleted).toHaveBeenCalledWith({
      guildId: 'guild-1',
      eventId: 'evt-1',
      deletedAtUtc: new Date('2026-03-20T18:05:00.000Z'),
    });
  });
});

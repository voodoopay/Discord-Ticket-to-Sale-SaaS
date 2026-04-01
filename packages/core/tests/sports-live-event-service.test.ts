import { inspect } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SportsLiveEventRepository } from '../src/repositories/sports-live-event-repository.js';
import { SportsLiveEventService } from '../src/services/sports-live-event-service.js';

type SportsLiveEventRow = {
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

type MockDb = {
  query: {
    sportsLiveEventChannels: {
      findFirst: (input: { where?: unknown }) => Promise<SportsLiveEventRow | null>;
      findMany: (input?: unknown) => Promise<SportsLiveEventRow[]>;
    };
  };
  insertCalls: number;
  findFirstCalls: number;
  onDuplicateKeyUpdateCalls: number;
  insert: () => {
    values: (value: Partial<SportsLiveEventRow>) => {
      onDuplicateKeyUpdate: (_input: unknown) => Promise<void>;
    };
  };
};

function getQueryKey(where: unknown): { guildId: string; eventId: string } | null {
  const text = inspect(where, { depth: 8, compact: true, breakLength: Infinity });
  const values = [...text.matchAll(/Param \{[^}]*?value: '([^']+)'/g)].map((match) => match[1]);
  const [guildId, eventId] = values;

  if (guildId == null || eventId == null) {
    return null;
  }

  return { guildId, eventId };
}

function makeRow(overrides: Partial<SportsLiveEventRow> = {}): SportsLiveEventRow {
  return {
    id: '01J0SPORTSLIVE000000000000',
    guildId: 'guild-1',
    sportName: 'Soccer',
    eventId: 'evt-1',
    eventName: 'Rangers vs Celtic',
    sportChannelId: 'sport-1',
    eventChannelId: null,
    status: 'scheduled',
    kickoffAtUtc: new Date('2026-03-20T12:30:00.000Z'),
    lastScoreSnapshot: null,
    lastStateSnapshot: null,
    lastSyncedAtUtc: null,
    finishedAtUtc: null,
    deleteAfterUtc: null,
    highlightsPosted: false,
    createdAt: new Date('2026-03-20T12:00:00.000Z'),
    updatedAt: new Date('2026-03-20T12:00:00.000Z'),
    ...overrides,
  };
}

function createStatefulMockDb(rows: SportsLiveEventRow[]): MockDb {
  let insertCalls = 0;
  let findFirstCalls = 0;
  let onDuplicateKeyUpdateCalls = 0;

  return {
    get insertCalls() {
      return insertCalls;
    },
    get findFirstCalls() {
      return findFirstCalls;
    },
    get onDuplicateKeyUpdateCalls() {
      return onDuplicateKeyUpdateCalls;
    },
    query: {
      sportsLiveEventChannels: {
        findFirst: async (input: { where?: unknown }) => {
          findFirstCalls += 1;
          const key = getQueryKey(input.where);
          if (!key) {
            return null;
          }

          return rows.find((row) => row.guildId === key.guildId && row.eventId === key.eventId) ?? null;
        },
        findMany: async () => rows,
      },
    },
    insert: () => ({
      values: (value: Partial<SportsLiveEventRow>) => {
        insertCalls += 1;
        const key = {
          guildId: String(value.guildId),
          eventId: String(value.eventId),
        };
        return {
          onDuplicateKeyUpdate: async (): Promise<void> => {
            onDuplicateKeyUpdateCalls += 1;
            const existing = rows.find((row) => row.guildId === key.guildId && row.eventId === key.eventId);

            if (existing) {
              Object.assign(existing, {
                ...value,
                id: existing.id,
                guildId: key.guildId,
                eventId: key.eventId,
                createdAt: existing.createdAt,
                updatedAt: value.updatedAt ?? existing.updatedAt,
              });
              return;
            }

            rows.push({
              id: String(value.id),
              guildId: key.guildId,
              sportName: String(value.sportName),
              eventId: key.eventId,
              eventName: String(value.eventName),
              sportChannelId: String(value.sportChannelId),
              eventChannelId: value.eventChannelId ?? null,
              status: (value.status ?? 'scheduled') as SportsLiveEventRow['status'],
              kickoffAtUtc: value.kickoffAtUtc ?? new Date('1970-01-01T00:00:00.000Z'),
              lastScoreSnapshot: (value.lastScoreSnapshot ?? null) as Record<string, unknown> | null,
              lastStateSnapshot: (value.lastStateSnapshot ?? null) as Record<string, unknown> | null,
              lastSyncedAtUtc: value.lastSyncedAtUtc ?? null,
              finishedAtUtc: value.finishedAtUtc ?? null,
              deleteAfterUtc: value.deleteAfterUtc ?? null,
              highlightsPosted: value.highlightsPosted ?? false,
              createdAt: value.createdAt ?? new Date('1970-01-01T00:00:00.000Z'),
              updatedAt: value.updatedAt ?? new Date('1970-01-01T00:00:00.000Z'),
            });
          },
        };
      },
    }),
  };
}

function createRepositoryWithMockDb(mockDb: MockDb): SportsLiveEventRepository {
  const repository = new SportsLiveEventRepository();
  Object.defineProperty(repository, 'db', {
    value: mockDb,
    configurable: true,
    writable: true,
  });
  return repository;
}

describe('SportsLiveEventService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates one tracked row per guild and event', async () => {
    const rows: SportsLiveEventRow[] = [
      makeRow({
        id: '01J0SPORTSLIVE000000000099',
        guildId: 'guild-other',
        eventId: 'evt-other',
        eventName: 'Other Fixture',
      }),
    ];
    const mockDb = createStatefulMockDb(rows);
    const repository = createRepositoryWithMockDb(mockDb);

    const first = await repository.upsertTrackedEvent({
      guildId: 'guild-1',
      sportName: 'Soccer',
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      sportChannelId: 'sport-1',
      kickoffAtUtc: new Date('2026-03-20T12:30:00.000Z'),
    });
    const second = await repository.upsertTrackedEvent({
      guildId: 'guild-1',
      sportName: 'Soccer',
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      sportChannelId: 'sport-1',
      kickoffAtUtc: new Date('2026-03-20T12:30:00.000Z'),
    });

    expect(rows).toHaveLength(2);
    expect(mockDb.insertCalls).toBe(2);
    expect(mockDb.onDuplicateKeyUpdateCalls).toBe(2);
    expect(mockDb.findFirstCalls).toBeGreaterThanOrEqual(2);
    expect(rows.filter((row) => row.guildId === 'guild-1' && row.eventId === 'evt-1')).toHaveLength(1);
    expect(first.id).toBe(second.id);
  });

  it('reads the tracked event for the requested guild and event', async () => {
    const target = makeRow({
      id: '01J0SPORTSLIVE000000000001',
      guildId: 'guild-1',
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
    });
    const distractor = makeRow({
      id: '01J0SPORTSLIVE000000000002',
      guildId: 'guild-2',
      eventId: 'evt-2',
      eventName: 'Aberdeen vs Hibs',
    });
    const rows: SportsLiveEventRow[] = [distractor, target];
    const mockDb = createStatefulMockDb(rows);
    const service = new SportsLiveEventService(createRepositoryWithMockDb(mockDb));

    const result = await service.getTrackedEvent({
      guildId: 'guild-1',
      eventId: 'evt-1',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value?.id).toBe(target.id);
    expect(result.value?.guildId).toBe('guild-1');
    expect(result.value?.eventId).toBe('evt-1');
    expect(result.value?.id).not.toBe(distractor.id);
  });

  it('marks finished events for cleanup three hours later', async () => {
    const repository = new SportsLiveEventRepository();
    const markFinishedSpy = vi.spyOn(repository, 'markFinished').mockResolvedValue(
      makeRow({
        id: '01J0SPORTSLIVE000000000001',
        guildId: 'guild-1',
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        status: 'cleanup_due',
        finishedAtUtc: new Date('2026-03-20T15:00:00.000Z'),
        deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
        updatedAt: new Date('2026-03-20T15:00:00.000Z'),
      }),
    );

    const service = new SportsLiveEventService(repository);

    const result = await service.markFinished({
      guildId: 'guild-1',
      eventId: 'evt-1',
      finishedAtUtc: new Date('2026-03-20T15:00:00.000Z'),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(markFinishedSpy).toHaveBeenCalledTimes(1);
    expect(markFinishedSpy).toHaveBeenCalledWith({
      guildId: 'guild-1',
      eventId: 'evt-1',
      finishedAtUtc: new Date('2026-03-20T15:00:00.000Z'),
      deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
    });
    expect(result.value.deleteAfterUtc?.toISOString()).toBe('2026-03-20T18:00:00.000Z');
    expect(result.value.status).toBe('cleanup_due');
  });

  it('lists recoverable tracked events from live and cleanup states', async () => {
    const repository = new SportsLiveEventRepository();
    const listTrackedEventsSpy = vi.spyOn(repository, 'listTrackedEvents').mockResolvedValue([
      makeRow({
        id: '01J0SPORTSLIVE000000000010',
        eventId: 'evt-live',
        status: 'live',
      }),
      makeRow({
        id: '01J0SPORTSLIVE000000000011',
        eventId: 'evt-cleanup',
        status: 'cleanup_due',
        deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
      }),
    ]);

    const service = new SportsLiveEventService(repository);

    const result = await service.listRecoverableEvents({
      guildId: 'guild-1',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(listTrackedEventsSpy).toHaveBeenCalledWith({
      guildId: 'guild-1',
      statuses: ['live', 'finished', 'cleanup_due'],
    });
    expect(result.value.map((row) => row.eventId)).toEqual(['evt-live', 'evt-cleanup']);
  });

  it('marks highlights as posted once for a tracked event', async () => {
    const repository = new SportsLiveEventRepository();
    const markHighlightsPostedSpy = vi.spyOn(repository, 'markHighlightsPosted').mockResolvedValue(
      makeRow({
        id: '01J0SPORTSLIVE000000000012',
        eventId: 'evt-1',
        status: 'cleanup_due',
        highlightsPosted: true,
        lastSyncedAtUtc: new Date('2026-03-20T16:00:00.000Z'),
        deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
        updatedAt: new Date('2026-03-20T16:00:00.000Z'),
      }),
    );

    const service = new SportsLiveEventService(repository);

    const result = await service.markHighlightsPosted({
      guildId: 'guild-1',
      eventId: 'evt-1',
      postedAtUtc: new Date('2026-03-20T16:00:00.000Z'),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(markHighlightsPostedSpy).toHaveBeenCalledWith({
      guildId: 'guild-1',
      eventId: 'evt-1',
      postedAtUtc: new Date('2026-03-20T16:00:00.000Z'),
    });
    expect(result.value.highlightsPosted).toBe(true);
  });

  it('marks a recoverable tracked event as failed when recovery cannot continue', async () => {
    const repository = new SportsLiveEventRepository();
    const markFailedSpy = vi.spyOn(repository, 'markFailed').mockResolvedValue(
      makeRow({
        id: '01J0SPORTSLIVE000000000013',
        eventId: 'evt-1',
        status: 'failed',
        lastSyncedAtUtc: new Date('2026-03-20T16:05:00.000Z'),
        updatedAt: new Date('2026-03-20T16:05:00.000Z'),
      }),
    );

    const service = new SportsLiveEventService(repository);

    const result = await service.markFailed({
      guildId: 'guild-1',
      eventId: 'evt-1',
      failedAtUtc: new Date('2026-03-20T16:05:00.000Z'),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(markFailedSpy).toHaveBeenCalledWith({
      guildId: 'guild-1',
      eventId: 'evt-1',
      failedAtUtc: new Date('2026-03-20T16:05:00.000Z'),
    });
    expect(result.value.status).toBe('failed');
  });
});

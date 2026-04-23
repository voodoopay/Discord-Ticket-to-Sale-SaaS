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
  scoreMessageId: string | null;
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
  updateCalls: number;
  insert: () => {
    values: (value: Partial<SportsLiveEventRow>) => {
      onDuplicateKeyUpdate: (input: { set: Partial<SportsLiveEventRow> }) => Promise<void>;
    };
  };
  update: () => {
    set: (value: Partial<SportsLiveEventRow>) => {
      where: (where: unknown) => Promise<{ affectedRows: number }>;
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

function whereIncludesBoolean(where: unknown, value: boolean): boolean {
  const text = inspect(where, { depth: 8, compact: true, breakLength: Infinity });
  return text.includes(`value: ${String(value)}`);
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
    scoreMessageId: null,
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
  let updateCalls = 0;

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
    get updateCalls() {
      return updateCalls;
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
          onDuplicateKeyUpdate: async (input: { set: Partial<SportsLiveEventRow> }): Promise<void> => {
            onDuplicateKeyUpdateCalls += 1;
            const existing = rows.find((row) => row.guildId === key.guildId && row.eventId === key.eventId);

            if (existing) {
              Object.assign(existing, {
                ...input.set,
                id: existing.id,
                guildId: key.guildId,
                eventId: key.eventId,
                createdAt: existing.createdAt,
                updatedAt: input.set.updatedAt ?? existing.updatedAt,
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
              scoreMessageId: value.scoreMessageId ?? null,
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
    update: () => ({
      set: (value: Partial<SportsLiveEventRow>) => ({
        where: async (where: unknown): Promise<{ affectedRows: number }> => {
          updateCalls += 1;
          const key = getQueryKey(where);
          if (!key) {
            return { affectedRows: 0 };
          }

          const existing = rows.find((row) => row.guildId === key.guildId && row.eventId === key.eventId);
          if (!existing) {
            return { affectedRows: 0 };
          }

          const requiresHighlightsFalse = whereIncludesBoolean(where, false);
          if (requiresHighlightsFalse && value.highlightsPosted === true && existing.highlightsPosted) {
            return { affectedRows: 0 };
          }

          Object.assign(existing, {
            ...value,
            updatedAt: value.updatedAt ?? existing.updatedAt,
          });

          return { affectedRows: 1 };
        },
      }),
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

  it('creates one tracked row per guild and event while persisting the score message id across duplicate upserts', async () => {
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
      eventChannelId: 'event-channel-1',
      scoreMessageId: 'msg-score-1',
      status: 'live',
      kickoffAtUtc: new Date('2026-03-20T12:30:00.000Z'),
      lastScoreSnapshot: { home: 1, away: 0 },
      lastStateSnapshot: { phase: '1H' },
      lastSyncedAtUtc: new Date('2026-03-20T12:35:00.000Z'),
      finishedAtUtc: null,
      deleteAfterUtc: null,
    });
    const second = await repository.upsertTrackedEvent({
      guildId: 'guild-1',
      sportName: 'Soccer',
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      sportChannelId: 'sport-1',
      eventChannelId: 'event-channel-1',
      scoreMessageId: 'msg-score-1',
      status: 'live',
      kickoffAtUtc: new Date('2026-03-20T12:30:00.000Z'),
      lastScoreSnapshot: { home: 2, away: 0 },
      lastStateSnapshot: { phase: '2H' },
      lastSyncedAtUtc: new Date('2026-03-20T12:50:00.000Z'),
      finishedAtUtc: null,
      deleteAfterUtc: null,
    });

    expect(rows).toHaveLength(2);
    expect(mockDb.insertCalls).toBe(2);
    expect(mockDb.onDuplicateKeyUpdateCalls).toBe(2);
    expect(mockDb.findFirstCalls).toBeGreaterThanOrEqual(2);
    expect(rows.filter((row) => row.guildId === 'guild-1' && row.eventId === 'evt-1')).toHaveLength(1);
    expect(first.id).toBe(second.id);
    expect(first.scoreMessageId).toBe('msg-score-1');
    expect(second.scoreMessageId).toBe('msg-score-1');
    expect(rows.find((row) => row.guildId === 'guild-1' && row.eventId === 'evt-1')?.scoreMessageId).toBe(
      'msg-score-1',
    );
  });

  it('reads the tracked event for the requested guild and event', async () => {
    const target = makeRow({
      id: '01J0SPORTSLIVE000000000001',
      guildId: 'guild-1',
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      scoreMessageId: 'msg-score-1',
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
    expect(result.value?.scoreMessageId).toBe('msg-score-1');
    expect(result.value?.id).not.toBe(distractor.id);
  });

  it('keeps the current score message id when the caller threads it through unchanged', async () => {
    const rows: SportsLiveEventRow[] = [
      makeRow({
        id: '01J0SPORTSLIVE000000000003',
        guildId: 'guild-1',
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        eventChannelId: 'event-channel-1',
        scoreMessageId: 'msg-score-1',
        status: 'live',
      }),
    ];
    const mockDb = createStatefulMockDb(rows);
    const service = new SportsLiveEventService(createRepositoryWithMockDb(mockDb));

    const result = await service.upsertTrackedEvent({
      guildId: 'guild-1',
      sportName: 'Soccer',
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      sportChannelId: 'sport-1',
      kickoffAtUtc: new Date('2026-03-20T12:30:00.000Z'),
      eventChannelId: 'event-channel-1',
      scoreMessageId: 'msg-score-1',
      status: 'live',
      lastScoreSnapshot: { home: 2, away: 1 },
      lastStateSnapshot: { phase: '2H' },
      lastSyncedAtUtc: new Date('2026-03-20T13:00:00.000Z'),
      finishedAtUtc: null,
      deleteAfterUtc: null,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.scoreMessageId).toBe('msg-score-1');
    expect(rows[0]?.scoreMessageId).toBe('msg-score-1');
  });

  it('updates the stored score message id when the caller provides a replacement', async () => {
    const rows: SportsLiveEventRow[] = [
      makeRow({
        id: '01J0SPORTSLIVE000000000004',
        guildId: 'guild-1',
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        eventChannelId: 'event-channel-1',
        scoreMessageId: 'msg-score-1',
        status: 'live',
      }),
    ];
    const mockDb = createStatefulMockDb(rows);
    const service = new SportsLiveEventService(createRepositoryWithMockDb(mockDb));

    const result = await service.upsertTrackedEvent({
      guildId: 'guild-1',
      sportName: 'Soccer',
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      sportChannelId: 'sport-1',
      kickoffAtUtc: new Date('2026-03-20T12:30:00.000Z'),
      eventChannelId: 'event-channel-1',
      scoreMessageId: 'msg-score-2',
      status: 'live',
      lastScoreSnapshot: { home: 3, away: 1 },
      lastStateSnapshot: { phase: 'FT' },
      lastSyncedAtUtc: new Date('2026-03-20T13:05:00.000Z'),
      finishedAtUtc: null,
      deleteAfterUtc: null,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.scoreMessageId).toBe('msg-score-2');
    expect(rows[0]?.scoreMessageId).toBe('msg-score-2');
  });

  it('backfills the stored score message id when a legacy tracked row starts with null', async () => {
    const rows: SportsLiveEventRow[] = [
      makeRow({
        id: '01J0SPORTSLIVE000000000005',
        guildId: 'guild-1',
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        eventChannelId: 'event-channel-1',
        scoreMessageId: null,
        status: 'live',
      }),
    ];
    const mockDb = createStatefulMockDb(rows);
    const service = new SportsLiveEventService(createRepositoryWithMockDb(mockDb));

    const result = await service.upsertTrackedEvent({
      guildId: 'guild-1',
      sportName: 'Soccer',
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      sportChannelId: 'sport-1',
      kickoffAtUtc: new Date('2026-03-20T12:30:00.000Z'),
      eventChannelId: 'event-channel-1',
      scoreMessageId: 'msg-score-legacy',
      status: 'live',
      lastScoreSnapshot: { home: 3, away: 1 },
      lastStateSnapshot: { phase: 'FT' },
      lastSyncedAtUtc: new Date('2026-03-20T13:05:00.000Z'),
      finishedAtUtc: null,
      deleteAfterUtc: null,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.scoreMessageId).toBe('msg-score-legacy');
    expect(rows[0]?.scoreMessageId).toBe('msg-score-legacy');
  });

  it('marks finished events for cleanup 30 minutes later', async () => {
    const repository = new SportsLiveEventRepository();
    const markFinishedSpy = vi.spyOn(repository, 'markFinished').mockResolvedValue(
      makeRow({
        id: '01J0SPORTSLIVE000000000001',
        guildId: 'guild-1',
        eventId: 'evt-1',
        eventName: 'Rangers vs Celtic',
        status: 'cleanup_due',
        finishedAtUtc: new Date('2026-03-20T15:00:00.000Z'),
        deleteAfterUtc: new Date('2026-03-20T15:30:00.000Z'),
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
      deleteAfterUtc: new Date('2026-03-20T15:30:00.000Z'),
    });
    expect(result.value.deleteAfterUtc?.toISOString()).toBe('2026-03-20T15:30:00.000Z');
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
      {
        claimed: true,
        record: makeRow({
          id: '01J0SPORTSLIVE000000000012',
          eventId: 'evt-1',
          status: 'cleanup_due',
          highlightsPosted: true,
          lastSyncedAtUtc: new Date('2026-03-20T16:00:00.000Z'),
          deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
          updatedAt: new Date('2026-03-20T16:00:00.000Z'),
        }),
      },
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
    expect(result.value.claimed).toBe(true);
    expect(result.value.trackedEvent?.highlightsPosted).toBe(true);
  });

  it('lets only the first highlight claimant win the false-to-true transition', async () => {
    const rows: SportsLiveEventRow[] = [
      makeRow({
        id: '01J0SPORTSLIVE000000000014',
        eventId: 'evt-1',
        status: 'cleanup_due',
        highlightsPosted: false,
      }),
    ];
    const mockDb = createStatefulMockDb(rows);
    const service = new SportsLiveEventService(createRepositoryWithMockDb(mockDb));

    const first = await service.markHighlightsPosted({
      guildId: 'guild-1',
      eventId: 'evt-1',
      postedAtUtc: new Date('2026-03-20T16:00:00.000Z'),
    });
    const second = await service.markHighlightsPosted({
      guildId: 'guild-1',
      eventId: 'evt-1',
      postedAtUtc: new Date('2026-03-20T16:01:00.000Z'),
    });

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (first.isErr() || second.isErr()) {
      return;
    }

    expect(mockDb.updateCalls).toBe(2);
    expect(first.value.claimed).toBe(true);
    expect(second.value.claimed).toBe(false);
    expect(rows[0]?.highlightsPosted).toBe(true);
  });

  it('releases a highlight claim after a failed send so delivery can retry later', async () => {
    const repository = new SportsLiveEventRepository();
    const releaseHighlightClaimSpy = vi
      .spyOn(repository, 'releaseHighlightClaim')
      .mockResolvedValue(
        makeRow({
          id: '01J0SPORTSLIVE000000000015',
          eventId: 'evt-1',
          status: 'cleanup_due',
          highlightsPosted: false,
          lastSyncedAtUtc: new Date('2026-03-20T16:05:00.000Z'),
          deleteAfterUtc: new Date('2026-03-20T18:00:00.000Z'),
          updatedAt: new Date('2026-03-20T16:05:00.000Z'),
        }),
      );

    const service = new SportsLiveEventService(repository);

    const result = await service.releaseHighlightClaim({
      guildId: 'guild-1',
      eventId: 'evt-1',
      releasedAtUtc: new Date('2026-03-20T16:05:00.000Z'),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(releaseHighlightClaimSpy).toHaveBeenCalledWith({
      guildId: 'guild-1',
      eventId: 'evt-1',
      releasedAtUtc: new Date('2026-03-20T16:05:00.000Z'),
    });
    expect(result.value.highlightsPosted).toBe(false);
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

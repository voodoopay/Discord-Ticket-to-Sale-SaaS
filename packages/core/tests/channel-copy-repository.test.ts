import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCopyRepository } from '../src/repositories/channel-copy-repository.js';

type MockDb = {
  query: {
    channelCopyAuthorizedUsers: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    channelCopyJobs: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function createInsertChain() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));

  return { insert, values };
}

function createUpdateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));

  return { update, set, where };
}

function getOrderByColumnNames(orderBy: unknown[]): string[] {
  return orderBy.map((clause) => {
    const queryChunks = (clause as { queryChunks: unknown[] }).queryChunks;
    return (queryChunks[1] as { name: string }).name;
  });
}

function getStatusFilterValues(where: unknown): string[] {
  const groupedClauses = (where as { queryChunks: unknown[] }).queryChunks[1] as {
    queryChunks: unknown[];
  };
  const sqlClauses = groupedClauses.queryChunks.filter(
    (chunk): chunk is { queryChunks: unknown[] } => typeof chunk === 'object' && chunk !== null && 'queryChunks' in chunk,
  );
  const statusClause = sqlClauses.at(-1);
  if (!statusClause) {
    throw new Error('Missing status clause');
  }

  return collectParamValues(statusClause).filter((value) =>
    ['awaiting_confirmation', 'queued', 'running', 'completed', 'failed'].includes(value),
  );
}

function collectParamValues(node: unknown): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((entry) => collectParamValues(entry));
  }

  if (typeof node !== 'object' || node === null) {
    return [];
  }

  if ('value' in node && typeof (node as { value?: unknown }).value === 'string') {
    return [(node as { value: string }).value];
  }

  if ('queryChunks' in node) {
    return collectParamValues((node as { queryChunks: unknown[] }).queryChunks);
  }

  return [];
}

function createRepositoryWithMockDb(mockDb: MockDb): ChannelCopyRepository {
  const repository = new ChannelCopyRepository();
  Object.defineProperty(repository, 'db', {
    value: mockDb,
    configurable: true,
    writable: true,
  });
  return repository;
}

describe('ChannelCopyRepository', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a guild-scoped authorized user without touching channel copy jobs', async () => {
    const { insert, values } = createInsertChain();
    const authorizedUserFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'auth-1',
        guildId: 'guild-1',
        discordUserId: 'user-1',
        grantedByDiscordUserId: 'admin-1',
        createdAt: new Date('2026-04-12T09:00:00.000Z'),
        updatedAt: new Date('2026-04-12T09:00:00.000Z'),
      });
    const jobsFindFirst = vi.fn();

    const repository = createRepositoryWithMockDb({
      query: {
        channelCopyAuthorizedUsers: {
          findFirst: authorizedUserFindFirst,
        },
        channelCopyJobs: {
          findFirst: jobsFindFirst,
        },
      },
      insert,
      update: vi.fn(),
    });

    const result = await repository.upsertAuthorizedUser({
      guildId: 'guild-1',
      discordUserId: 'user-1',
      grantedByDiscordUserId: 'admin-1',
    });

    expect(result.created).toBe(true);
    expect(result.record).toEqual(
      expect.objectContaining({
        guildId: 'guild-1',
        discordUserId: 'user-1',
        grantedByDiscordUserId: 'admin-1',
      }),
    );
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        discordUserId: 'user-1',
        grantedByDiscordUserId: 'admin-1',
      }),
    );
    expect(jobsFindFirst).not.toHaveBeenCalled();
  });

  it('updates an existing authorized user entry instead of inserting a duplicate row', async () => {
    const { update, set } = createUpdateChain();
    const authorizedUserFindFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'auth-1',
        guildId: 'guild-1',
        discordUserId: 'user-1',
        grantedByDiscordUserId: 'admin-1',
        createdAt: new Date('2026-04-12T09:00:00.000Z'),
        updatedAt: new Date('2026-04-12T09:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'auth-1',
        guildId: 'guild-1',
        discordUserId: 'user-1',
        grantedByDiscordUserId: null,
        createdAt: new Date('2026-04-12T09:00:00.000Z'),
        updatedAt: new Date('2026-04-12T09:05:00.000Z'),
      });

    const repository = createRepositoryWithMockDb({
      query: {
        channelCopyAuthorizedUsers: {
          findFirst: authorizedUserFindFirst,
        },
        channelCopyJobs: {
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn(),
      update,
    });

    const result = await repository.upsertAuthorizedUser({
      guildId: 'guild-1',
      discordUserId: 'user-1',
      grantedByDiscordUserId: null,
    });

    expect(result.created).toBe(false);
    expect(result.record.grantedByDiscordUserId).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        grantedByDiscordUserId: null,
      }),
    );
  });

  it('applies the caller grant intent when an insert loses a duplicate-key race', async () => {
    const duplicateKeyError = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
    });
    const { insert } = createInsertChain();
    const { update, set, where } = createUpdateChain();
    insert.mockImplementationOnce(() => ({
      values: vi.fn().mockRejectedValueOnce(duplicateKeyError),
    }));
    const authorizedUserFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'auth-1',
        guildId: 'guild-1',
        discordUserId: 'user-1',
        grantedByDiscordUserId: 'admin-2',
        createdAt: new Date('2026-04-12T09:00:00.000Z'),
        updatedAt: new Date('2026-04-12T09:00:02.000Z'),
      });

    const repository = createRepositoryWithMockDb({
      query: {
        channelCopyAuthorizedUsers: {
          findFirst: authorizedUserFindFirst,
        },
        channelCopyJobs: {
          findFirst: vi.fn(),
        },
      },
      insert,
      update,
    });

    await expect(
      repository.upsertAuthorizedUser({
        guildId: 'guild-1',
        discordUserId: 'user-1',
        grantedByDiscordUserId: 'admin-2',
      }),
    ).resolves.toEqual({
      created: false,
      record: expect.objectContaining({
        id: 'auth-1',
        guildId: 'guild-1',
        discordUserId: 'user-1',
        grantedByDiscordUserId: 'admin-2',
      }),
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        grantedByDiscordUserId: 'admin-2',
        updatedAt: expect.any(Date),
      }),
    );
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('finds the latest incomplete job for the same requester and channel pair', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'job-2',
      destinationGuildId: 'guild-9',
      sourceGuildId: 'guild-1',
      sourceChannelId: 'source-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-1',
      confirmToken: null,
      status: 'running',
      forceConfirmed: true,
      startedAt: new Date('2026-04-12T09:05:30.000Z'),
      finishedAt: null,
      lastProcessedSourceMessageId: null,
      scannedMessageCount: 15,
      copiedMessageCount: 10,
      skippedMessageCount: 5,
      failureMessage: null,
      createdAt: new Date('2026-04-12T09:05:00.000Z'),
      updatedAt: new Date('2026-04-12T09:06:00.000Z'),
    });

    const repository = createRepositoryWithMockDb({
      query: {
        channelCopyAuthorizedUsers: {
          findFirst: vi.fn(),
        },
        channelCopyJobs: {
          findFirst,
        },
      },
      insert: vi.fn(),
      update: vi.fn(),
    });

    await expect(
      repository.findLatestIncompleteJob({
        sourceChannelId: 'source-1',
        destinationChannelId: 'dest-1',
        requestedByDiscordUserId: 'user-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'job-2',
        sourceChannelId: 'source-1',
        destinationChannelId: 'dest-1',
        requestedByDiscordUserId: 'user-1',
        status: 'running',
        confirmToken: null,
      }),
    );

    expect(findFirst).toHaveBeenCalledTimes(1);
    const query = findFirst.mock.calls[0]?.[0] as { where: unknown; orderBy: unknown[] };
    expect(getOrderByColumnNames(query.orderBy)).toEqual(['updated_at', 'created_at']);
    expect(getStatusFilterValues(query.where)).toEqual(['awaiting_confirmation', 'queued', 'running']);
  });

  it('prefers resuming a running job before taking a queued job', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'job-running-1',
        destinationGuildId: 'guild-9',
        sourceGuildId: 'guild-1',
        sourceChannelId: 'source-1',
        destinationChannelId: 'dest-1',
        requestedByDiscordUserId: 'user-1',
        confirmToken: null,
        status: 'running',
        forceConfirmed: true,
        startedAt: new Date('2026-04-12T09:05:30.000Z'),
        finishedAt: null,
        lastProcessedSourceMessageId: '1002',
        scannedMessageCount: 2,
        copiedMessageCount: 2,
        skippedMessageCount: 0,
        failureMessage: null,
        createdAt: new Date('2026-04-12T09:05:00.000Z'),
        updatedAt: new Date('2026-04-12T09:06:00.000Z'),
      });

    const repository = createRepositoryWithMockDb({
      query: {
        channelCopyAuthorizedUsers: {
          findFirst: vi.fn(),
        },
        channelCopyJobs: {
          findFirst,
        },
      },
      insert: vi.fn(),
      update: vi.fn(),
    });

    await expect(repository.findNextRunnableJob()).resolves.toEqual(
      expect.objectContaining({
        id: 'job-running-1',
        status: 'running',
        lastProcessedSourceMessageId: '1002',
      }),
    );
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NukeRepository } from '../src/repositories/nuke-repository.js';

type MockDb = {
  query: {
    channelNukeLocks: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  update: ReturnType<typeof vi.fn>;
};

function createUpdateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));

  return { update, set, where };
}

function createRepositoryWithMockDb(mockDb: MockDb): NukeRepository {
  const repository = new NukeRepository();
  Object.defineProperty(repository, 'db', {
    value: mockDb,
    configurable: true,
    writable: true,
  });
  return repository;
}

describe('NukeRepository lock lease handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('treats a renewed lock as valid when MySQL truncates milliseconds from lease_until', async () => {
    const { update } = createUpdateChain();
    const now = new Date('2026-03-15T17:00:00.250Z');
    const requestedLeaseUntil = new Date('2026-03-15T17:01:00.250Z');
    const storedLeaseUntil = new Date('2026-03-15T17:01:00.000Z');

    const mockDb: MockDb = {
      query: {
        channelNukeLocks: {
          findFirst: vi.fn().mockResolvedValue({
            lockKey: 'guild:channel',
            ownerId: 'worker-1',
            leaseUntil: storedLeaseUntil,
          }),
        },
      },
      update,
    };

    const repository = createRepositoryWithMockDb(mockDb);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now.getTime());

    await expect(
      repository.renewLockLease({
        lockKey: 'guild:channel',
        ownerId: 'worker-1',
        leaseUntil: requestedLeaseUntil,
      }),
    ).resolves.toBe(true);

    expect(update).toHaveBeenCalledTimes(1);
    expect(mockDb.query.channelNukeLocks.findFirst).toHaveBeenCalledTimes(1);
    dateNowSpy.mockRestore();
  });

  it('rejects a renewed lock when the stored lease is already expired', async () => {
    const { update } = createUpdateChain();
    const now = new Date('2026-03-15T17:00:00.250Z');
    const requestedLeaseUntil = new Date('2026-03-15T17:01:00.250Z');
    const expiredLeaseUntil = new Date('2026-03-15T16:59:59.000Z');

    const mockDb: MockDb = {
      query: {
        channelNukeLocks: {
          findFirst: vi.fn().mockResolvedValue({
            lockKey: 'guild:channel',
            ownerId: 'worker-1',
            leaseUntil: expiredLeaseUntil,
          }),
        },
      },
      update,
    };

    const repository = createRepositoryWithMockDb(mockDb);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now.getTime());

    await expect(
      repository.renewLockLease({
        lockKey: 'guild:channel',
        ownerId: 'worker-1',
        leaseUntil: requestedLeaseUntil,
      }),
    ).resolves.toBe(false);

    dateNowSpy.mockRestore();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/domain/errors.js';
import { ChannelCopyService } from '../src/services/channel-copy-service.js';

function createMockRepository() {
  return {
    listAuthorizedUsers: vi.fn().mockResolvedValue([]),
    upsertAuthorizedUser: vi.fn(),
    revokeAuthorizedUser: vi.fn(),
    findLatestIncompleteJob: vi.fn().mockResolvedValue(null),
    findNextRunnableJob: vi.fn().mockResolvedValue(null),
    getJobByIdOrNull: vi.fn().mockResolvedValue(null),
    createJob: vi.fn(),
    updateJob: vi.fn(),
  };
}

describe('ChannelCopyService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps channel-copy activation isolated to its own allowlist', async () => {
    const repository = createMockRepository();
    const service = new ChannelCopyService(repository);

    repository.listAuthorizedUsers.mockResolvedValue([
      {
        id: 'auth-copy-1',
        guildId: 'guild-dest',
        discordUserId: 'user-2',
        grantedByDiscordUserId: 'owner-1',
        createdAt: new Date('2026-04-12T12:00:00.000Z'),
        updatedAt: new Date('2026-04-12T12:00:00.000Z'),
      },
    ]);

    const result = await service.getCommandAccessState({
      guildId: 'guild-dest',
      discordUserId: 'user-2',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      locked: true,
      allowed: true,
      activated: true,
      authorizedUserCount: 1,
    });
  });

  it('returns awaiting_confirmation when the destination channel is not empty and no confirm token was supplied', async () => {
    const repository = createMockRepository();
    const service = new ChannelCopyService(repository);
    const adapter = {
      getChannel: vi
        .fn()
        .mockResolvedValueOnce({ id: 'src-1', guildId: 'guild-src', kind: 'guildText' })
        .mockResolvedValueOnce({ id: 'dest-1', guildId: 'guild-dest', kind: 'guildText' }),
      assertReadableSource: vi.fn().mockResolvedValue(undefined),
      assertWritableDestination: vi.fn().mockResolvedValue(undefined),
      countDestinationMessages: vi.fn().mockResolvedValue(5),
      listSourceMessages: vi.fn(),
      repostMessage: vi.fn(),
    };
    repository.createJob.mockResolvedValue({
      id: 'job-awaiting-1',
      destinationGuildId: 'guild-dest',
      sourceGuildId: 'guild-src',
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      confirmToken: 'COPY-ABCD',
      status: 'awaiting_confirmation',
      forceConfirmed: false,
      startedAt: null,
      finishedAt: null,
      lastProcessedSourceMessageId: null,
      scannedMessageCount: 0,
      copiedMessageCount: 0,
      skippedMessageCount: 0,
      failureMessage: null,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      updatedAt: new Date('2026-04-12T12:00:00.000Z'),
    });

    const result = await service.startCopyRun({
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      destinationGuildId: 'guild-dest',
      confirmToken: null,
      adapter,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.status).toBe('awaiting_confirmation');
    expect(result.value.requiresConfirmToken).toMatch(/^COPY-/u);
    expect(adapter.listSourceMessages).not.toHaveBeenCalled();
    expect(adapter.repostMessage).not.toHaveBeenCalled();
  });

  it('queues a copy job without running the backfill inline', async () => {
    const repository = createMockRepository();
    const service = new ChannelCopyService(repository);

    repository.createJob.mockResolvedValue({
      id: 'job-queued-1',
      destinationGuildId: 'guild-dest',
      sourceGuildId: 'guild-src',
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      confirmToken: null,
      status: 'queued',
      forceConfirmed: false,
      startedAt: null,
      finishedAt: null,
      lastProcessedSourceMessageId: null,
      scannedMessageCount: 0,
      copiedMessageCount: 0,
      skippedMessageCount: 0,
      failureMessage: null,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      updatedAt: new Date('2026-04-12T12:00:00.000Z'),
    });

    const adapter = {
      getChannel: vi
        .fn()
        .mockResolvedValueOnce({ id: 'src-1', guildId: 'guild-src', kind: 'guildText' })
        .mockResolvedValueOnce({ id: 'dest-1', guildId: 'guild-dest', kind: 'guildText' }),
      assertReadableSource: vi.fn().mockResolvedValue(undefined),
      assertWritableDestination: vi.fn().mockResolvedValue(undefined),
      countDestinationMessages: vi.fn().mockResolvedValue(0),
      listSourceMessages: vi.fn(),
      repostMessage: vi.fn(),
    };

    const result = await service.startCopyRun({
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      destinationGuildId: 'guild-dest',
      confirmToken: null,
      adapter,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      jobId: 'job-queued-1',
      status: 'queued',
      requiresConfirmToken: null,
      copiedMessageCount: 0,
      skippedMessageCount: 0,
    });
    expect(adapter.listSourceMessages).not.toHaveBeenCalled();
    expect(adapter.repostMessage).not.toHaveBeenCalled();
  });

  it('resumes a running backfill after the last processed source message id when the worker loop picks it up', async () => {
    const repository = createMockRepository();
    const service = new ChannelCopyService(repository);

    repository.findNextRunnableJob.mockResolvedValue({
      id: 'job-1',
      destinationGuildId: 'guild-dest',
      sourceGuildId: 'guild-src',
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      confirmToken: null,
      status: 'running',
      forceConfirmed: true,
      startedAt: new Date('2026-04-12T12:00:00.000Z'),
      finishedAt: null,
      lastProcessedSourceMessageId: '1002',
      scannedMessageCount: 2,
      copiedMessageCount: 2,
      skippedMessageCount: 0,
      failureMessage: null,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      updatedAt: new Date('2026-04-12T12:00:30.000Z'),
    });

    const adapter = {
      getChannel: vi
        .fn()
        .mockResolvedValueOnce({ id: 'src-1', guildId: 'guild-src', kind: 'guildText' })
        .mockResolvedValueOnce({ id: 'dest-1', guildId: 'guild-dest', kind: 'guildText' }),
      assertReadableSource: vi.fn().mockResolvedValue(undefined),
      assertWritableDestination: vi.fn().mockResolvedValue(undefined),
      countDestinationMessages: vi.fn().mockResolvedValue(0),
      listSourceMessages: vi
        .fn()
        .mockResolvedValueOnce([{ id: '1003', content: 'third', attachments: [], isSystem: false }])
        .mockResolvedValueOnce([]),
      repostMessage: vi.fn().mockResolvedValue({ destinationMessageId: '2003' }),
    };
    repository.updateJob
      .mockResolvedValueOnce({
        id: 'job-1',
        destinationGuildId: 'guild-dest',
        sourceGuildId: 'guild-src',
        sourceChannelId: 'src-1',
        destinationChannelId: 'dest-1',
        requestedByDiscordUserId: 'user-2',
        confirmToken: null,
        status: 'running',
        forceConfirmed: true,
        startedAt: new Date('2026-04-12T12:00:00.000Z'),
        finishedAt: null,
        lastProcessedSourceMessageId: '1003',
        scannedMessageCount: 3,
        copiedMessageCount: 3,
        skippedMessageCount: 0,
        failureMessage: null,
        createdAt: new Date('2026-04-12T12:00:00.000Z'),
        updatedAt: new Date('2026-04-12T12:00:31.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'job-1',
        destinationGuildId: 'guild-dest',
        sourceGuildId: 'guild-src',
        sourceChannelId: 'src-1',
        destinationChannelId: 'dest-1',
        requestedByDiscordUserId: 'user-2',
        confirmToken: null,
        status: 'completed',
        forceConfirmed: true,
        startedAt: new Date('2026-04-12T12:00:00.000Z'),
        finishedAt: new Date('2026-04-12T12:00:32.000Z'),
        lastProcessedSourceMessageId: '1003',
        scannedMessageCount: 3,
        copiedMessageCount: 3,
        skippedMessageCount: 0,
        failureMessage: null,
        createdAt: new Date('2026-04-12T12:00:00.000Z'),
        updatedAt: new Date('2026-04-12T12:00:32.000Z'),
      });

    const result = await service.processNextCopyJob({
      adapter,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      jobId: 'job-1',
      status: 'completed',
      copiedMessageCount: 3,
      skippedMessageCount: 0,
      scannedMessageCount: 3,
      failureMessage: null,
    });
    expect(adapter.listSourceMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        afterMessageId: '1002',
      }),
    );
  });

  it('returns the current job status summary for operators', async () => {
    const repository = createMockRepository();
    const service = new ChannelCopyService(repository);

    repository.getJobByIdOrNull.mockResolvedValue({
      id: 'job-status-1',
      destinationGuildId: 'guild-dest',
      sourceGuildId: 'guild-src',
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      confirmToken: null,
      status: 'completed',
      forceConfirmed: true,
      startedAt: new Date('2026-04-12T12:00:00.000Z'),
      finishedAt: new Date('2026-04-12T12:05:00.000Z'),
      lastProcessedSourceMessageId: '1003',
      scannedMessageCount: 3,
      copiedMessageCount: 2,
      skippedMessageCount: 1,
      failureMessage: null,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      updatedAt: new Date('2026-04-12T12:05:00.000Z'),
    });

    const result = await service.getJobStatus({ jobId: 'job-status-1' });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      jobId: 'job-status-1',
      status: 'completed',
      copiedMessageCount: 2,
      skippedMessageCount: 1,
      scannedMessageCount: 3,
      failureMessage: null,
    });
  });

  it('preserves specific channel copy errors instead of collapsing them into a generic run failure', async () => {
    const repository = createMockRepository();
    const service = new ChannelCopyService(repository);

    const adapter = {
      getChannel: vi
        .fn()
        .mockRejectedValue(
          new AppError(
            'CHANNEL_COPY_INVALID_CHANNEL',
            'Only guild text and announcement channels are supported for channel copy.',
            422,
          ),
        ),
      assertReadableSource: vi.fn(),
      assertWritableDestination: vi.fn(),
      countDestinationMessages: vi.fn(),
      listSourceMessages: vi.fn(),
      repostMessage: vi.fn(),
    };

    const result = await service.startCopyRun({
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      destinationGuildId: 'guild-dest',
      confirmToken: null,
      adapter,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.code).toBe('CHANNEL_COPY_INVALID_CHANNEL');
    expect(result.error.message).toBe(
      'Only guild text and announcement channels are supported for channel copy.',
    );
  });

  it('queues an awaiting confirmation job when the requesting user confirms it', async () => {
    const repository = createMockRepository();
    const service = new ChannelCopyService(repository);

    repository.getJobByIdOrNull.mockResolvedValue({
      id: 'job-awaiting-1',
      destinationGuildId: 'guild-dest',
      sourceGuildId: 'guild-src',
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      confirmToken: 'COPY-ABCD',
      status: 'awaiting_confirmation',
      forceConfirmed: false,
      startedAt: null,
      finishedAt: null,
      lastProcessedSourceMessageId: null,
      scannedMessageCount: 0,
      copiedMessageCount: 0,
      skippedMessageCount: 0,
      failureMessage: null,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      updatedAt: new Date('2026-04-12T12:00:00.000Z'),
    });
    repository.updateJob.mockResolvedValue({
      id: 'job-awaiting-1',
      destinationGuildId: 'guild-dest',
      sourceGuildId: 'guild-src',
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      confirmToken: 'COPY-ABCD',
      status: 'queued',
      forceConfirmed: true,
      startedAt: null,
      finishedAt: null,
      lastProcessedSourceMessageId: null,
      scannedMessageCount: 0,
      copiedMessageCount: 0,
      skippedMessageCount: 0,
      failureMessage: null,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      updatedAt: new Date('2026-04-12T12:01:00.000Z'),
    });

    const result = await service.confirmPendingJob({
      jobId: 'job-awaiting-1',
      requestedByDiscordUserId: 'user-2',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(repository.updateJob).toHaveBeenCalledWith({
      jobId: 'job-awaiting-1',
      status: 'queued',
      forceConfirmed: true,
      confirmToken: 'COPY-ABCD',
      failureMessage: null,
      finishedAt: null,
    });
    expect(result.value).toEqual({
      jobId: 'job-awaiting-1',
      status: 'queued',
      requiresConfirmToken: null,
      copiedMessageCount: 0,
      skippedMessageCount: 0,
    });
  });

  it('rejects confirmation clicks from a different user', async () => {
    const repository = createMockRepository();
    const service = new ChannelCopyService(repository);

    repository.getJobByIdOrNull.mockResolvedValue({
      id: 'job-awaiting-1',
      destinationGuildId: 'guild-dest',
      sourceGuildId: 'guild-src',
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      confirmToken: 'COPY-ABCD',
      status: 'awaiting_confirmation',
      forceConfirmed: false,
      startedAt: null,
      finishedAt: null,
      lastProcessedSourceMessageId: null,
      scannedMessageCount: 0,
      copiedMessageCount: 0,
      skippedMessageCount: 0,
      failureMessage: null,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      updatedAt: new Date('2026-04-12T12:00:00.000Z'),
    });

    const result = await service.confirmPendingJob({
      jobId: 'job-awaiting-1',
      requestedByDiscordUserId: 'user-9',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.code).toBe('CHANNEL_COPY_CONFIRMATION_FORBIDDEN');
    expect(repository.updateJob).not.toHaveBeenCalled();
  });

  it('cancels an awaiting confirmation job for the requesting user', async () => {
    const repository = createMockRepository();
    const service = new ChannelCopyService(repository);

    repository.getJobByIdOrNull.mockResolvedValue({
      id: 'job-awaiting-1',
      destinationGuildId: 'guild-dest',
      sourceGuildId: 'guild-src',
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      confirmToken: 'COPY-ABCD',
      status: 'awaiting_confirmation',
      forceConfirmed: false,
      startedAt: null,
      finishedAt: null,
      lastProcessedSourceMessageId: null,
      scannedMessageCount: 0,
      copiedMessageCount: 0,
      skippedMessageCount: 0,
      failureMessage: null,
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      updatedAt: new Date('2026-04-12T12:00:00.000Z'),
    });
    repository.updateJob.mockResolvedValue({
      id: 'job-awaiting-1',
      destinationGuildId: 'guild-dest',
      sourceGuildId: 'guild-src',
      sourceChannelId: 'src-1',
      destinationChannelId: 'dest-1',
      requestedByDiscordUserId: 'user-2',
      confirmToken: 'COPY-ABCD',
      status: 'failed',
      forceConfirmed: false,
      startedAt: null,
      finishedAt: new Date('2026-04-12T12:01:00.000Z'),
      lastProcessedSourceMessageId: null,
      scannedMessageCount: 0,
      copiedMessageCount: 0,
      skippedMessageCount: 0,
      failureMessage: 'Channel copy was cancelled before it started.',
      createdAt: new Date('2026-04-12T12:00:00.000Z'),
      updatedAt: new Date('2026-04-12T12:01:00.000Z'),
    });

    const result = await service.cancelPendingJob({
      jobId: 'job-awaiting-1',
      requestedByDiscordUserId: 'user-2',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(repository.updateJob).toHaveBeenCalledWith({
      jobId: 'job-awaiting-1',
      status: 'failed',
      finishedAt: expect.any(Date),
      failureMessage: 'Channel copy was cancelled before it started.',
    });
    expect(result.value).toEqual({
      jobId: 'job-awaiting-1',
      status: 'failed',
    });
  });
});

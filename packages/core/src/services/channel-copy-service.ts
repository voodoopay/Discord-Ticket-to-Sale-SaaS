import { err, ok, type Result } from 'neverthrow';
import { ulid } from 'ulid';

import { AppError, fromUnknownError } from '../domain/errors.js';
import {
  ChannelCopyRepository,
  type ChannelCopyAuthorizedUserRecord,
  type ChannelCopyJobRecord,
} from '../repositories/channel-copy-repository.js';

export type ChannelCopyAuthorizedUserSummary = {
  authorizationId: string;
  discordUserId: string;
  grantedByDiscordUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChannelCopyCommandAccessState = {
  locked: boolean;
  allowed: boolean;
  activated: boolean;
  authorizedUserCount: number;
};

export type ChannelCopyRuntimeAdapter = {
  getChannel(input: { channelId: string }): Promise<{
    id: string;
    guildId: string;
    kind: 'guildText' | 'guildAnnouncement';
  }>;
  assertReadableSource(input: { channelId: string }): Promise<void>;
  assertWritableDestination(input: { channelId: string }): Promise<void>;
  countDestinationMessages(input: { channelId: string }): Promise<number>;
  listSourceMessages(input: {
    channelId: string;
    afterMessageId: string | null;
    limit: number;
  }): Promise<
    Array<{
      id: string;
      content: string;
      attachments: Array<{ name: string; contentType: string | null; data: Buffer }>;
      isSystem: boolean;
    }>
  >;
  repostMessage(input: {
    channelId: string;
    content: string;
    attachments: Array<{ name: string; contentType: string | null; data: Buffer }>;
  }): Promise<{ destinationMessageId: string }>;
};

export type ChannelCopyRunSummary = {
  jobId: string;
  status: 'awaiting_confirmation' | 'queued';
  requiresConfirmToken: string | null;
  copiedMessageCount: number;
  skippedMessageCount: number;
};

export type ChannelCopyJobStatusSummary = {
  jobId: string;
  status: ChannelCopyJobRecord['status'];
  copiedMessageCount: number;
  skippedMessageCount: number;
  scannedMessageCount: number;
  failureMessage: string | null;
};

export type ChannelCopyCancelSummary = {
  jobId: string;
  status: 'failed';
};

type ChannelCopyRepositoryPort = Pick<
  ChannelCopyRepository,
  | 'listAuthorizedUsers'
  | 'upsertAuthorizedUser'
  | 'revokeAuthorizedUser'
  | 'findLatestIncompleteJob'
  | 'findNextRunnableJob'
  | 'getJobByIdOrNull'
  | 'createJob'
  | 'updateJob'
>;

function mapAuthorizedUserSummary(
  authorizedUser: ChannelCopyAuthorizedUserRecord,
): ChannelCopyAuthorizedUserSummary {
  return {
    authorizationId: authorizedUser.id,
    discordUserId: authorizedUser.discordUserId,
    grantedByDiscordUserId: authorizedUser.grantedByDiscordUserId,
    createdAt: authorizedUser.createdAt.toISOString(),
    updatedAt: authorizedUser.updatedAt.toISOString(),
  };
}

function buildConfirmToken(): string {
  return `COPY-${ulid().slice(-8)}`.toUpperCase();
}

function shouldSkipMessage(message: {
  content: string;
  attachments: Array<unknown>;
  isSystem: boolean;
}): boolean {
  return message.isSystem || (message.content.trim().length === 0 && message.attachments.length === 0);
}

export class ChannelCopyService {
  constructor(
    private readonly repository: ChannelCopyRepositoryPort = new ChannelCopyRepository(),
  ) {}

  public async getCommandAccessState(input: {
    guildId: string;
    discordUserId: string;
  }): Promise<Result<ChannelCopyCommandAccessState, AppError>> {
    try {
      const authorizedUsers = await this.repository.listAuthorizedUsers({
        guildId: input.guildId,
      });
      const authorizedUserCount = authorizedUsers.length;

      return ok({
        locked: true,
        allowed: authorizedUsers.some((user) => user.discordUserId === input.discordUserId),
        activated: authorizedUserCount > 0,
        authorizedUserCount,
      });
    } catch (error) {
      return err(new AppError('CHANNEL_COPY_ACCESS_READ_FAILED', fromUnknownError(error).message, 500));
    }
  }

  public async listAuthorizedUsers(input: {
    guildId: string;
  }): Promise<Result<ChannelCopyAuthorizedUserSummary[], AppError>> {
    try {
      const authorizedUsers = await this.repository.listAuthorizedUsers({
        guildId: input.guildId,
      });

      return ok(authorizedUsers.map(mapAuthorizedUserSummary));
    } catch (error) {
      return err(new AppError('CHANNEL_COPY_ACCESS_READ_FAILED', fromUnknownError(error).message, 500));
    }
  }

  public async grantUserAccess(input: {
    guildId: string;
    discordUserId: string;
    grantedByDiscordUserId: string;
  }): Promise<
    Result<
      {
        authorizationId: string;
        discordUserId: string;
        created: boolean;
      },
      AppError
    >
  > {
    try {
      const granted = await this.repository.upsertAuthorizedUser({
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        grantedByDiscordUserId: input.grantedByDiscordUserId,
      });

      return ok({
        authorizationId: granted.record.id,
        discordUserId: granted.record.discordUserId,
        created: granted.created,
      });
    } catch (error) {
      return err(new AppError('CHANNEL_COPY_ACCESS_WRITE_FAILED', fromUnknownError(error).message, 500));
    }
  }

  public async revokeUserAccess(input: {
    guildId: string;
    discordUserId: string;
  }): Promise<Result<{ revoked: boolean }, AppError>> {
    try {
      const revoked = await this.repository.revokeAuthorizedUser({
        guildId: input.guildId,
        discordUserId: input.discordUserId,
      });

      return ok({ revoked });
    } catch (error) {
      return err(new AppError('CHANNEL_COPY_ACCESS_WRITE_FAILED', fromUnknownError(error).message, 500));
    }
  }

  public async startCopyRun(input: {
    sourceChannelId: string;
    destinationChannelId: string;
    requestedByDiscordUserId: string;
    destinationGuildId: string;
    confirmToken: string | null;
    adapter: ChannelCopyRuntimeAdapter;
  }): Promise<Result<ChannelCopyRunSummary, AppError>> {
    try {
      const sourceChannel = await input.adapter.getChannel({ channelId: input.sourceChannelId });
      const destinationChannel = await input.adapter.getChannel({
        channelId: input.destinationChannelId,
      });

      if (destinationChannel.guildId !== input.destinationGuildId) {
        return err(
          new AppError(
            'CHANNEL_COPY_DESTINATION_GUILD_MISMATCH',
            'Run this command from the destination server only.',
            403,
          ),
        );
      }

      await input.adapter.assertReadableSource({ channelId: input.sourceChannelId });
      await input.adapter.assertWritableDestination({ channelId: input.destinationChannelId });

      const existingJob = await this.repository.findLatestIncompleteJob({
        sourceChannelId: input.sourceChannelId,
        destinationChannelId: input.destinationChannelId,
        requestedByDiscordUserId: input.requestedByDiscordUserId,
      });

      const jobToRun = await this.resolveJobToRun({
        existingJob,
        sourceGuildId: sourceChannel.guildId,
        destinationGuildId: destinationChannel.guildId,
        sourceChannelId: input.sourceChannelId,
        destinationChannelId: input.destinationChannelId,
        requestedByDiscordUserId: input.requestedByDiscordUserId,
        confirmToken: input.confirmToken,
        adapter: input.adapter,
      });

      if (jobToRun.status === 'awaiting_confirmation') {
        return ok({
          jobId: jobToRun.id,
          status: 'awaiting_confirmation',
          requiresConfirmToken: jobToRun.confirmToken,
          copiedMessageCount: jobToRun.copiedMessageCount,
          skippedMessageCount: jobToRun.skippedMessageCount,
        });
      }

      return ok({
        jobId: jobToRun.id,
        status: 'queued',
        requiresConfirmToken: null,
        copiedMessageCount: jobToRun.copiedMessageCount,
        skippedMessageCount: jobToRun.skippedMessageCount,
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('CHANNEL_COPY_RUN_FAILED', fromUnknownError(error).message, 500),
      );
    }
  }

  public async getJobStatus(input: {
    jobId: string;
  }): Promise<Result<ChannelCopyJobStatusSummary, AppError>> {
    try {
      const job = await this.repository.getJobByIdOrNull(input.jobId);
      if (!job) {
        return err(
          new AppError('CHANNEL_COPY_JOB_NOT_FOUND', 'No channel-copy job exists for that ID.', 404),
        );
      }

      return ok({
        jobId: job.id,
        status: job.status,
        copiedMessageCount: job.copiedMessageCount,
        skippedMessageCount: job.skippedMessageCount,
        scannedMessageCount: job.scannedMessageCount,
        failureMessage: job.failureMessage,
      });
    } catch (error) {
      return err(new AppError('CHANNEL_COPY_RUN_READ_FAILED', fromUnknownError(error).message, 500));
    }
  }

  public async confirmPendingJob(input: {
    jobId: string;
    requestedByDiscordUserId: string;
  }): Promise<Result<ChannelCopyRunSummary, AppError>> {
    try {
      const job = await this.repository.getJobByIdOrNull(input.jobId);
      if (!job) {
        return err(
          new AppError('CHANNEL_COPY_JOB_NOT_FOUND', 'No channel-copy job exists for that ID.', 404),
        );
      }

      if (job.requestedByDiscordUserId !== input.requestedByDiscordUserId) {
        return err(
          new AppError(
            'CHANNEL_COPY_CONFIRMATION_FORBIDDEN',
            'Only the user who started this channel copy can confirm it.',
            403,
          ),
        );
      }

      if (job.status !== 'awaiting_confirmation') {
        return err(
          new AppError(
            'CHANNEL_COPY_CONFIRMATION_NOT_PENDING',
            'This channel copy is no longer waiting for confirmation.',
            409,
          ),
        );
      }

      const confirmedJob = await this.repository.updateJob({
        jobId: job.id,
        status: 'queued',
        forceConfirmed: true,
        confirmToken: job.confirmToken,
        failureMessage: null,
        finishedAt: null,
      });

      return ok({
        jobId: confirmedJob.id,
        status: 'queued',
        requiresConfirmToken: null,
        copiedMessageCount: confirmedJob.copiedMessageCount,
        skippedMessageCount: confirmedJob.skippedMessageCount,
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('CHANNEL_COPY_RUN_FAILED', fromUnknownError(error).message, 500),
      );
    }
  }

  public async cancelPendingJob(input: {
    jobId: string;
    requestedByDiscordUserId: string;
  }): Promise<Result<ChannelCopyCancelSummary, AppError>> {
    try {
      const job = await this.repository.getJobByIdOrNull(input.jobId);
      if (!job) {
        return err(
          new AppError('CHANNEL_COPY_JOB_NOT_FOUND', 'No channel-copy job exists for that ID.', 404),
        );
      }

      if (job.requestedByDiscordUserId !== input.requestedByDiscordUserId) {
        return err(
          new AppError(
            'CHANNEL_COPY_CONFIRMATION_FORBIDDEN',
            'Only the user who started this channel copy can cancel it.',
            403,
          ),
        );
      }

      if (job.status !== 'awaiting_confirmation') {
        return err(
          new AppError(
            'CHANNEL_COPY_CONFIRMATION_NOT_PENDING',
            'This channel copy is no longer waiting for confirmation.',
            409,
          ),
        );
      }

      const cancelledJob = await this.repository.updateJob({
        jobId: job.id,
        status: 'failed',
        finishedAt: new Date(),
        failureMessage: 'Channel copy was cancelled before it started.',
      });

      return ok({
        jobId: cancelledJob.id,
        status: 'failed',
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('CHANNEL_COPY_RUN_FAILED', fromUnknownError(error).message, 500),
      );
    }
  }

  public async processNextCopyJob(input: {
    adapter: ChannelCopyRuntimeAdapter;
  }): Promise<Result<ChannelCopyJobStatusSummary | null, AppError>> {
    try {
      const job = await this.repository.findNextRunnableJob();
      if (!job) {
        return ok(null);
      }

      return ok(await this.processJob(job, input.adapter));
    } catch (error) {
      return err(new AppError('CHANNEL_COPY_RUN_FAILED', fromUnknownError(error).message, 500));
    }
  }

  private async resolveJobToRun(input: {
    existingJob: ChannelCopyJobRecord | null;
    sourceGuildId: string;
    destinationGuildId: string;
    sourceChannelId: string;
    destinationChannelId: string;
    requestedByDiscordUserId: string;
    confirmToken: string | null;
    adapter: Pick<ChannelCopyRuntimeAdapter, 'countDestinationMessages'>;
  }): Promise<ChannelCopyJobRecord> {
    if (input.existingJob && input.existingJob.status !== 'awaiting_confirmation') {
      return input.existingJob;
    }

    const destinationMessageCount = await input.adapter.countDestinationMessages({
      channelId: input.destinationChannelId,
    });

    if (destinationMessageCount > 0) {
      if (
        input.existingJob?.status === 'awaiting_confirmation' &&
        input.existingJob.confirmToken === input.confirmToken
      ) {
        return this.repository.updateJob({
          jobId: input.existingJob.id,
          status: 'queued',
          forceConfirmed: true,
        });
      }

      if (input.existingJob?.status === 'awaiting_confirmation') {
        return input.existingJob;
      }

      return this.repository.createJob({
        destinationGuildId: input.destinationGuildId,
        sourceGuildId: input.sourceGuildId,
        sourceChannelId: input.sourceChannelId,
        destinationChannelId: input.destinationChannelId,
        requestedByDiscordUserId: input.requestedByDiscordUserId,
        confirmToken: buildConfirmToken(),
        status: 'awaiting_confirmation',
        forceConfirmed: false,
      });
    }

    if (input.existingJob?.status === 'awaiting_confirmation') {
      return this.repository.updateJob({
        jobId: input.existingJob.id,
        status: 'queued',
        forceConfirmed: true,
      });
    }

    return this.repository.createJob({
      destinationGuildId: input.destinationGuildId,
      sourceGuildId: input.sourceGuildId,
      sourceChannelId: input.sourceChannelId,
      destinationChannelId: input.destinationChannelId,
      requestedByDiscordUserId: input.requestedByDiscordUserId,
      confirmToken: null,
      status: 'queued',
      forceConfirmed: false,
    });
  }

  private async processJob(
    job: ChannelCopyJobRecord,
    adapter: ChannelCopyRuntimeAdapter,
  ): Promise<ChannelCopyJobStatusSummary> {
    await adapter.assertReadableSource({ channelId: job.sourceChannelId });
    await adapter.assertWritableDestination({ channelId: job.destinationChannelId });

    let activeJob = job;

    if (activeJob.status !== 'running') {
      activeJob = await this.repository.updateJob({
        jobId: activeJob.id,
        status: 'running',
        forceConfirmed: activeJob.forceConfirmed,
        confirmToken: activeJob.confirmToken,
        startedAt: activeJob.startedAt ?? new Date(),
        finishedAt: null,
        failureMessage: null,
      });
    }

    let afterMessageId = activeJob.lastProcessedSourceMessageId;
    let scannedMessageCount = activeJob.scannedMessageCount;
    let copiedMessageCount = activeJob.copiedMessageCount;
    let skippedMessageCount = activeJob.skippedMessageCount;

    try {
      for (;;) {
        const messages = await adapter.listSourceMessages({
          channelId: activeJob.sourceChannelId,
          afterMessageId,
          limit: 100,
        });

        if (messages.length === 0) {
          break;
        }

        for (const message of messages) {
          scannedMessageCount += 1;
          afterMessageId = message.id;

          if (shouldSkipMessage(message)) {
            skippedMessageCount += 1;
          } else {
            await adapter.repostMessage({
              channelId: activeJob.destinationChannelId,
              content: message.content,
              attachments: message.attachments,
            });
            copiedMessageCount += 1;
          }

          await this.repository.updateJob({
            jobId: activeJob.id,
            lastProcessedSourceMessageId: afterMessageId,
            scannedMessageCount,
            copiedMessageCount,
            skippedMessageCount,
          });
        }
      }

      const completedJob = await this.repository.updateJob({
        jobId: activeJob.id,
        status: 'completed',
        finishedAt: new Date(),
        lastProcessedSourceMessageId: afterMessageId,
        scannedMessageCount,
        copiedMessageCount,
        skippedMessageCount,
      });

      return {
        jobId: completedJob.id,
        status: completedJob.status,
        copiedMessageCount: completedJob.copiedMessageCount,
        skippedMessageCount: completedJob.skippedMessageCount,
        scannedMessageCount: completedJob.scannedMessageCount,
        failureMessage: completedJob.failureMessage,
      };
    } catch (error) {
      const failure = fromUnknownError(error);
      const failedJob = await this.repository.updateJob({
        jobId: activeJob.id,
        status: 'failed',
        finishedAt: new Date(),
        lastProcessedSourceMessageId: afterMessageId,
        scannedMessageCount,
        copiedMessageCount,
        skippedMessageCount,
        failureMessage: failure.message,
      });

      return {
        jobId: failedJob.id,
        status: failedJob.status,
        copiedMessageCount: failedJob.copiedMessageCount,
        skippedMessageCount: failedJob.skippedMessageCount,
        scannedMessageCount: failedJob.scannedMessageCount,
        failureMessage: failedJob.failureMessage,
      };
    }
  }
}

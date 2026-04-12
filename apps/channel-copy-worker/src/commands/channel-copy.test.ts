import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

vi.mock('@voodoo/core', () => {
  class ChannelCopyService {
    public async getCommandAccessState(): Promise<never> {
      throw new Error('Mock getCommandAccessState not implemented');
    }

    public async startCopyRun(): Promise<never> {
      throw new Error('Mock startCopyRun not implemented');
    }

    public async getJobStatus(): Promise<never> {
      throw new Error('Mock getJobStatus not implemented');
    }
  }

  class AppError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  }

  return {
    AppError,
    ChannelCopyService,
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
});

import { ChannelCopyService } from '@voodoo/core';

import { channelCopyCommand } from './channel-copy.js';

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createInteractionMock(input?: {
  userId?: string;
  subcommand?: 'run' | 'status';
  sourceChannelId?: string;
  destinationChannelId?: string;
  confirmToken?: string | null;
  jobId?: string;
}): {
  interaction: ChatInputCommandInteraction;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
} {
  const deferReply = vi.fn(async () => {
    interaction.deferred = true;
  });
  const editReply = vi.fn(async () => undefined);

  const interaction = {
    client: {
      channels: {
        fetch: vi.fn(),
      },
    },
    deferred: false,
    editReply,
    deferReply,
    followUp: vi.fn(async () => undefined),
    guildId: 'guild-dest',
    inGuild: vi.fn().mockReturnValue(true),
    options: {
      getSubcommand: vi.fn().mockReturnValue(input?.subcommand ?? 'run'),
      getString: vi.fn((name: string) => {
        if (name === 'source_channel_id') {
          return input?.sourceChannelId ?? '123456789012345678';
        }

        if (name === 'destination_channel_id') {
          return input?.destinationChannelId ?? '234567890123456789';
        }

        if (name === 'confirm') {
          return input?.confirmToken ?? null;
        }

        if (name === 'job_id') {
          return input?.jobId ?? 'job-2';
        }

        return null;
      }),
    },
    replied: false,
    reply: vi.fn(async () => undefined),
    user: { id: input?.userId ?? 'user-1' },
  } as unknown as ChatInputCommandInteraction & { deferred: boolean };

  return {
    interaction,
    deferReply,
    editReply,
  };
}

describe('channel-copy command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to copy into the same channel', async () => {
    const { interaction, deferReply, editReply } = createInteractionMock({
      sourceChannelId: '123456789012345678',
      destinationChannelId: '123456789012345678',
    });

    await channelCopyCommand.execute(interaction);

    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(editReply).toHaveBeenCalledWith({
      content: 'Source and destination channels must be different.',
    });
  });

  it('refuses to copy into a non-empty destination without the returned confirm token', async () => {
    vi.spyOn(ChannelCopyService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: true,
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<ChannelCopyService['getCommandAccessState']>>,
    );
    vi.spyOn(ChannelCopyService.prototype, 'startCopyRun').mockResolvedValue(
      createOkResult({
        jobId: 'job-1',
        status: 'awaiting_confirmation',
        requiresConfirmToken: 'COPY-ABCD',
        copiedMessageCount: 0,
        skippedMessageCount: 0,
      }) as Awaited<ReturnType<ChannelCopyService['startCopyRun']>>,
    );

    const { interaction, editReply } = createInteractionMock();

    await channelCopyCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content:
        'Destination channel is not empty. Rerun this command with confirm:`COPY-ABCD`. Job ID: `job-1`.',
    });
  });

  it('queues the backfill and tells the operator to check the job later', async () => {
    vi.spyOn(ChannelCopyService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: true,
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<ChannelCopyService['getCommandAccessState']>>,
    );
    const startCopyRunSpy = vi
      .spyOn(ChannelCopyService.prototype, 'startCopyRun')
      .mockResolvedValue(
        createOkResult({
          jobId: 'job-2',
          status: 'queued',
          requiresConfirmToken: null,
          copiedMessageCount: 0,
          skippedMessageCount: 0,
        }) as Awaited<ReturnType<ChannelCopyService['startCopyRun']>>,
      );

    const { interaction, editReply } = createInteractionMock({
      confirmToken: 'COPY-OK',
    });

    await channelCopyCommand.execute(interaction);

    expect(startCopyRunSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceChannelId: '123456789012345678',
        destinationChannelId: '234567890123456789',
        requestedByDiscordUserId: 'user-1',
        destinationGuildId: 'guild-dest',
        confirmToken: 'COPY-OK',
        adapter: expect.objectContaining({
          getChannel: expect.any(Function),
          assertReadableSource: expect.any(Function),
          assertWritableDestination: expect.any(Function),
          countDestinationMessages: expect.any(Function),
          listSourceMessages: expect.any(Function),
          repostMessage: expect.any(Function),
        }),
      }),
    );
    expect(editReply).toHaveBeenCalledWith({
      content: 'Channel copy queued. Job ID: `job-2`. Use `/channel-copy status job_id:job-2` to check progress.',
    });
  });

  it('shows copied, skipped, and scanned totals for a queued job status lookup', async () => {
    vi.spyOn(ChannelCopyService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: true,
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<ChannelCopyService['getCommandAccessState']>>,
    );
    vi.spyOn(ChannelCopyService.prototype, 'getJobStatus').mockResolvedValue(
      createOkResult({
        jobId: 'job-2',
        status: 'running',
        copiedMessageCount: 12,
        skippedMessageCount: 2,
        scannedMessageCount: 14,
        failureMessage: null,
      }) as Awaited<ReturnType<ChannelCopyService['getJobStatus']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      subcommand: 'status',
      jobId: 'job-2',
    });

    await channelCopyCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content:
        'Job `job-2` is `running`. Scanned 14 source message(s), copied 12, skipped 2.',
    });
  });
});

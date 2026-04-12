import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';

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

    public async confirmPendingJob(): Promise<never> {
      throw new Error('Mock confirmPendingJob not implemented');
    }

    public async cancelPendingJob(): Promise<never> {
      throw new Error('Mock cancelPendingJob not implemented');
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

import {
  channelCopyCommand,
  handleChannelCopyConfirmationButton,
  isChannelCopyConfirmationButtonCustomId,
} from './channel-copy.js';

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createErrResult<E>(error: E): { isErr: () => true; isOk: () => false; error: E } {
  return {
    isErr: () => true,
    isOk: () => false,
    error,
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

function createButtonInteractionMock(input: {
  customId: string;
  userId?: string;
}): {
  interaction: ButtonInteraction;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const deferReply = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);
  const update = vi.fn(async () => undefined);

  const interaction = {
    customId: input.customId,
    deferReply,
    editReply,
    guildId: 'guild-dest',
    inGuild: vi.fn().mockReturnValue(true),
    isButton: vi.fn().mockReturnValue(true),
    replied: false,
    deferred: false,
    update,
    user: { id: input.userId ?? 'user-1' },
  } as unknown as ButtonInteraction;

  return {
    interaction,
    deferReply,
    editReply,
    update,
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

    const payload = editReply.mock.calls.at(-1)?.[0];
    expect(payload).toEqual(
      expect.objectContaining({
        content:
          'Destination channel is not empty. Confirm to append into it or cancel this pending copy. Job ID: `job-1`.',
        components: expect.any(Array),
      }),
    );
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0].toJSON()).toEqual({
      type: 1,
      components: [
        expect.objectContaining({
          type: 2,
          custom_id: 'channel-copy:confirm:job-1',
          label: 'Confirm Copy',
        }),
        expect.objectContaining({
          type: 2,
          custom_id: 'channel-copy:cancel:job-1',
          label: 'Cancel',
        }),
      ],
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

  it('shows the specific run failure message returned by the service', async () => {
    vi.spyOn(ChannelCopyService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: true,
        activated: true,
        authorizedUserCount: 1,
      }) as Awaited<ReturnType<ChannelCopyService['getCommandAccessState']>>,
    );
    vi.spyOn(ChannelCopyService.prototype, 'startCopyRun').mockResolvedValue(
      createErrResult(
        new Error('Only guild text and announcement channels are supported for channel copy.'),
      ) as Awaited<ReturnType<ChannelCopyService['startCopyRun']>>,
    );

    const { interaction, editReply } = createInteractionMock();

    await channelCopyCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: 'Only guild text and announcement channels are supported for channel copy.',
    });
  });

  it('detects channel copy confirmation button ids', () => {
    expect(isChannelCopyConfirmationButtonCustomId('channel-copy:confirm:job-1')).toBe(true);
    expect(isChannelCopyConfirmationButtonCustomId('channel-copy:cancel:job-1')).toBe(true);
    expect(isChannelCopyConfirmationButtonCustomId('channel-copy:other:job-1')).toBe(false);
  });

  it('queues the pending job when the same user clicks confirm', async () => {
    vi.spyOn(ChannelCopyService.prototype, 'confirmPendingJob').mockResolvedValue(
      createOkResult({
        jobId: 'job-1',
        status: 'queued',
        requiresConfirmToken: null,
        copiedMessageCount: 0,
        skippedMessageCount: 0,
      }) as Awaited<ReturnType<ChannelCopyService['confirmPendingJob']>>,
    );

    const { interaction, update } = createButtonInteractionMock({
      customId: 'channel-copy:confirm:job-1',
      userId: 'user-1',
    });

    await handleChannelCopyConfirmationButton(interaction);

    expect(update).toHaveBeenCalledWith({
      content: 'Channel copy queued. Job ID: `job-1`. Use `/channel-copy status job_id:job-1` to check progress.',
      components: [],
    });
  });

  it('cancels the pending job when the same user clicks cancel', async () => {
    vi.spyOn(ChannelCopyService.prototype, 'cancelPendingJob').mockResolvedValue(
      createOkResult({
        jobId: 'job-1',
        status: 'failed',
      }) as Awaited<ReturnType<ChannelCopyService['cancelPendingJob']>>,
    );

    const { interaction, update } = createButtonInteractionMock({
      customId: 'channel-copy:cancel:job-1',
      userId: 'user-1',
    });

    await handleChannelCopyConfirmationButton(interaction);

    expect(update).toHaveBeenCalledWith({
      content: 'Channel copy cancelled. Job ID: `job-1`.',
      components: [],
    });
  });

  it('shows an ephemeral error when a different user clicks confirm', async () => {
    vi.spyOn(ChannelCopyService.prototype, 'confirmPendingJob').mockResolvedValue(
      createErrResult(
        new Error('Only the user who started this channel copy can confirm it.'),
      ) as Awaited<ReturnType<ChannelCopyService['confirmPendingJob']>>,
    );

    const { interaction, deferReply, editReply, update } = createButtonInteractionMock({
      customId: 'channel-copy:confirm:job-1',
      userId: 'user-9',
    });

    await handleChannelCopyConfirmationButton(interaction);

    expect(update).not.toHaveBeenCalled();
    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(editReply).toHaveBeenCalledWith({
      content: 'Only the user who started this channel copy can confirm it.',
    });
  });
});

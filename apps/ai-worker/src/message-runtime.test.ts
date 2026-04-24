import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, type Message } from 'discord.js';

const { loggerWarn } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
}));

vi.mock('@voodoo/core', () => {
  class AiAccessService {
    public async getGuildActivationState(): Promise<never> {
      throw new Error('Mock getGuildActivationState not implemented');
    }
  }

  class AiConfigService {
    public async getGuildSettingsSnapshot(): Promise<never> {
      throw new Error('Mock getGuildSettingsSnapshot not implemented');
    }
  }

  class AiAnswerService {
    public async answerMessage(): Promise<never> {
      throw new Error('Mock answerMessage not implemented');
    }
  }

  class AiKnowledgeManagementService {
    public async createCustomQa(): Promise<never> {
      throw new Error('Mock createCustomQa not implemented');
    }
  }

  return {
    AiAccessService,
    AiConfigService,
    AiAnswerService,
    AiKnowledgeManagementService,
    logger: {
      warn: loggerWarn,
    },
  };
});

import { handleAiMessage, type AiMessageRuntimeDependencies } from './message-runtime.js';
import {
  AI_UNANSWERED_ADD_QA_CUSTOM_ID,
  AI_UNANSWERED_MODAL_CUSTOM_ID,
  handleAiUnansweredLearningInteraction,
  processIncomingMessage,
} from './runtime.js';

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createGuildState(overrides?: Partial<Awaited<ReturnType<AiMessageRuntimeDependencies['loadGuildState']>>>) {
  return {
    activated: true,
    enabled: true,
    tonePreset: 'professional' as const,
    toneInstructions: '',
    roleMode: 'allowlist' as const,
    defaultReplyMode: 'inline' as const,
    replyFrequency: 'mid' as const,
    unansweredLoggingEnabled: false,
    unansweredLogChannelId: null,
    replyChannels: [{ channelId: 'allowed-channel', replyMode: 'inline' as const }],
    replyChannelCategories: [],
    roleIds: ['role-1'],
    ...overrides,
  };
}

function createDependencies(input?: {
  state?: Awaited<ReturnType<AiMessageRuntimeDependencies['loadGuildState']>>;
  answerResult?:
    | ReturnType<typeof createOkResult>
    | {
        isErr: () => true;
        isOk: () => false;
        error: Error;
      };
}): AiMessageRuntimeDependencies & {
  loadGuildState: ReturnType<typeof vi.fn>;
  answerMessage: ReturnType<typeof vi.fn>;
} {
  return {
    loadGuildState: vi.fn().mockResolvedValue(input?.state ?? createGuildState()),
    answerMessage: vi
      .fn()
      .mockResolvedValue(
        input?.answerResult ??
          createOkResult({
            kind: 'answer',
            content: 'Grounded answer',
            evidenceCount: 1,
            evidence: [],
          }),
      ),
  };
}

function createMessage(input?: {
  content?: string;
  guildId?: string | null;
  channelId?: string;
  authorBot?: boolean;
  memberRoleIds?: string[];
  threadChannel?: boolean;
  missingPermissions?: bigint[];
}) {
  const send = vi.fn(async () => undefined);
  const startThread = vi.fn(async () => ({ send }));
  const reply = vi.fn(async () => undefined);
  const missingPermissions = new Set(input?.missingPermissions ?? []);

  const message = {
    id: 'msg-1',
    guildId: input?.guildId ?? 'guild-1',
    channelId: input?.channelId ?? 'allowed-channel',
    author: {
      bot: input?.authorBot ?? false,
      id: 'user-1',
    },
    content: input?.content ?? 'What is the refund policy?',
    member: {
      roles: {
        cache: (input?.memberRoleIds ?? ['role-1']).map((roleId) => ({ id: roleId })),
      },
    },
    client: {
      user: { id: 'bot-user' },
    },
    channel: {
      isThread: () => input?.threadChannel ?? false,
      permissionsFor: vi.fn(() => ({
        has: (permission: bigint) => !missingPermissions.has(permission),
      })),
      send,
    },
    reply,
    startThread,
  } as unknown as Message;

  return { message, reply, startThread, send };
}

describe('AI message runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    loggerWarn.mockReset();
  });

  it('ignores bot and empty messages before loading guild state', async () => {
    const dependencies = createDependencies();

    const botResult = await handleAiMessage(
      {
        id: 'msg-1',
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        author: { bot: true, id: 'user-1' },
        content: 'refund policy?',
        memberRoleIds: ['role-1'],
      },
      dependencies,
    );
    const emptyResult = await handleAiMessage(
      {
        id: 'msg-2',
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        author: { bot: false, id: 'user-1' },
        content: '   ',
        memberRoleIds: ['role-1'],
      },
      dependencies,
    );

    expect(botResult).toEqual({ kind: 'ignored' });
    expect(emptyResult).toEqual({ kind: 'ignored' });
    expect(dependencies.loadGuildState).not.toHaveBeenCalled();
  });

  it('ignores messages when the guild is inactive or not enabled', async () => {
    const inactiveDependencies = createDependencies({
      state: createGuildState({ activated: false }),
    });
    const disabledDependencies = createDependencies({
      state: createGuildState({ enabled: false }),
    });

    const inactiveResult = await handleAiMessage(
      {
        id: 'msg-1',
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        author: { bot: false, id: 'user-1' },
        content: 'refund policy?',
        memberRoleIds: ['role-1'],
      },
      inactiveDependencies,
    );
    const disabledResult = await handleAiMessage(
      {
        id: 'msg-2',
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        author: { bot: false, id: 'user-1' },
        content: 'refund policy?',
        memberRoleIds: ['role-1'],
      },
      disabledDependencies,
    );

    expect(inactiveResult).toEqual({ kind: 'ignored' });
    expect(disabledResult).toEqual({ kind: 'ignored' });
  });

  it('ignores messages outside configured reply channels', async () => {
    const dependencies = createDependencies();

    const result = await handleAiMessage(
      {
        id: 'msg-1',
        guildId: 'guild-1',
        channelId: 'other-channel',
        author: { bot: false, id: 'user-1' },
        content: 'refund policy?',
        memberRoleIds: ['role-1'],
      },
      dependencies,
    );

    expect(result).toEqual({ kind: 'ignored' });
    expect(dependencies.answerMessage).not.toHaveBeenCalled();
  });

  it('applies allowlist and blocklist role rules', async () => {
    const allowlistDependencies = createDependencies({
      state: createGuildState({ roleIds: ['role-allowed'] }),
    });
    const blocklistDependencies = createDependencies({
      state: createGuildState({
        roleMode: 'blocklist',
        roleIds: ['role-blocked'],
      }),
    });

    const allowlistResult = await handleAiMessage(
      {
        id: 'msg-1',
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        author: { bot: false, id: 'user-1' },
        content: 'refund policy?',
        memberRoleIds: ['role-other'],
      },
      allowlistDependencies,
    );
    const blocklistResult = await handleAiMessage(
      {
        id: 'msg-2',
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        author: { bot: false, id: 'user-1' },
        content: 'refund policy?',
        memberRoleIds: ['role-blocked'],
      },
      blocklistDependencies,
    );

    expect(allowlistResult).toEqual({ kind: 'ignored' });
    expect(blocklistResult).toEqual({ kind: 'ignored' });
    expect(allowlistDependencies.answerMessage).not.toHaveBeenCalled();
    expect(blocklistDependencies.answerMessage).not.toHaveBeenCalled();
  });

  it('returns the configured reply mode and uses trimmed message content for answers', async () => {
    const dependencies = createDependencies({
      state: createGuildState({
        replyChannels: [{ channelId: 'allowed-channel', replyMode: 'thread' }],
      }),
    });

    const result = await handleAiMessage(
      {
        id: 'msg-1',
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        author: { bot: false, id: 'user-1' },
        content: '  refund policy?  ',
        memberRoleIds: ['role-1'],
      },
      dependencies,
    );

    expect(result).toEqual({
      kind: 'reply',
      replyMode: 'thread',
      content: 'Grounded answer',
    });
    expect(dependencies.answerMessage).toHaveBeenCalledWith({
      guildId: 'guild-1',
      question: 'refund policy?',
      tonePreset: 'professional',
      toneInstructions: '',
      replyFrequency: 'mid',
    });
  });

  it('allows replies through an auto-selected channel category', async () => {
    const dependencies = createDependencies({
      state: createGuildState({
        replyChannels: [],
        replyChannelCategories: [{ categoryId: 'category-1', replyMode: 'thread' }],
      }),
    });

    const result = await handleAiMessage(
      {
        id: 'msg-1',
        guildId: 'guild-1',
        channelId: 'new-channel',
        parentCategoryId: 'category-1',
        author: { bot: false, id: 'user-1' },
        content: 'refund policy?',
        memberRoleIds: ['role-1'],
      },
      dependencies,
    );

    expect(result).toEqual({
      kind: 'reply',
      replyMode: 'thread',
      content: 'Grounded answer',
    });
  });

  it('returns ignored when grounded answering returns a refusal and unanswered logging is disabled', async () => {
    const dependencies = createDependencies({
      answerResult: createOkResult({
        kind: 'refusal',
        content: 'I do not have enough approved information to answer that yet.',
        evidenceCount: 0,
      }),
    });

    const result = await handleAiMessage(
      {
        id: 'msg-1',
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        author: { bot: false, id: 'user-1' },
        content: 'unknown question?',
        memberRoleIds: ['role-1'],
      },
      dependencies,
    );

    expect(result).toEqual({ kind: 'ignored' });
  });

  it('returns unanswered log intent when grounded answering returns a refusal and logging is configured', async () => {
    const dependencies = createDependencies({
      state: createGuildState({
        unansweredLoggingEnabled: true,
        unansweredLogChannelId: 'log-channel',
      }),
      answerResult: createOkResult({
        kind: 'refusal',
        content: 'I do not have enough approved information to answer that yet.',
        evidenceCount: 0,
      }),
    });

    const result = await handleAiMessage(
      {
        id: 'msg-1',
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        author: { bot: false, id: 'user-1' },
        content: 'unknown question?',
        memberRoleIds: ['role-1'],
      },
      dependencies,
    );

    expect(result).toEqual({
      kind: 'unanswered',
      logChannelId: 'log-channel',
      guildId: 'guild-1',
      sourceChannelId: 'allowed-channel',
      authorId: 'user-1',
      messageId: 'msg-1',
      question: 'unknown question?',
    });
  });

  it('replies inline in the source channel when inline mode is configured', async () => {
    const dependencies = createDependencies();
    const { message, reply, startThread } = createMessage();

    await processIncomingMessage({} as never, message, dependencies);

    expect(reply).toHaveBeenCalledWith('Grounded answer');
    expect(startThread).not.toHaveBeenCalled();
  });

  it('replies in a thread when thread mode is configured', async () => {
    const dependencies = createDependencies({
      state: createGuildState({
        replyChannels: [{ channelId: 'allowed-channel', replyMode: 'thread' }],
      }),
    });
    const { message, startThread, send } = createMessage();

    await processIncomingMessage({} as never, message, dependencies);

    expect(startThread).toHaveBeenCalledWith({ name: 'ai-msg-1' });
    expect(send).toHaveBeenCalledWith('Grounded answer');
  });

  it('skips sending and logs when required Discord permissions are missing', async () => {
    const dependencies = createDependencies();
    const { message, reply } = createMessage({
      missingPermissions: [PermissionFlagsBits.SendMessages],
    });

    await processIncomingMessage({} as never, message, dependencies);

    expect(reply).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'allowed-channel',
        messageId: 'msg-1',
        missingPermissions: ['SendMessages'],
      }),
      'ai-worker missing Discord permissions for passive reply',
    );
  });

  it('logs unanswered questions to the configured channel', async () => {
    const dependencies = createDependencies({
      state: createGuildState({
        unansweredLoggingEnabled: true,
        unansweredLogChannelId: 'log-channel',
      }),
      answerResult: createOkResult({
        kind: 'refusal',
        content: 'I do not have enough approved information to answer that yet.',
        evidenceCount: 0,
      }),
    });
    const { message, reply } = createMessage({ content: 'unknown question?' });
    const logSend = vi.fn(async () => undefined);
    const fetchChannel = vi.fn(async () => ({ send: logSend }));
    const client = {
      channels: {
        fetch: fetchChannel,
      },
    } as never;

    await processIncomingMessage(client, message, dependencies);

    expect(reply).not.toHaveBeenCalled();
    expect(fetchChannel).toHaveBeenCalledWith('log-channel');
    expect(logSend).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      }),
    );
    const logSendCalls = logSend.mock.calls as unknown as Array<[
      {
        components: Array<{ components: Array<{ data: { custom_id: string } }> }>;
      },
    ]>;
    const payload = logSendCalls[0]?.[0] as {
      components: Array<{ components: Array<{ data: { custom_id: string } }> }>;
    };
    expect(payload.components[0]?.components[0]?.data.custom_id).toBe(
      AI_UNANSWERED_ADD_QA_CUSTOM_ID,
    );
  });

  it('rejects Add Q&A button clicks from non-admin members', async () => {
    const reply = vi.fn(async () => undefined);
    const interaction = {
      isButton: () => true,
      isModalSubmit: () => false,
      customId: AI_UNANSWERED_ADD_QA_CUSTOM_ID,
      guildId: 'guild-1',
      memberPermissions: {
        has: vi.fn(() => false),
      },
      reply,
    } as never;

    const handled = await handleAiUnansweredLearningInteraction(interaction);

    expect(handled).toBe(true);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Administrator'),
      }),
    );
  });

  it('opens an Add Q&A modal for admin button clicks', async () => {
    const showModal = vi.fn(async () => undefined);
    const interaction = {
      isButton: () => true,
      isModalSubmit: () => false,
      customId: AI_UNANSWERED_ADD_QA_CUSTOM_ID,
      guildId: 'guild-1',
      memberPermissions: {
        has: vi.fn(() => true),
      },
      message: {
        embeds: [
          {
            fields: [{ name: 'Question', value: 'unknown question?' }],
          },
        ],
      },
      showModal,
    } as never;

    const handled = await handleAiUnansweredLearningInteraction(interaction);

    expect(handled).toBe(true);
    expect(showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          custom_id: AI_UNANSWERED_MODAL_CUSTOM_ID,
        }),
      }),
    );
  });

  it('saves a Custom Q&A entry from the unanswered modal submission', async () => {
    const reply = vi.fn(async () => undefined);
    const createCustomQa = vi.fn(async () =>
      createOkResult({
        customQaId: 'qa-1',
        question: 'unknown question?',
        answer: 'Use the setup guide.',
        updatedAt: new Date().toISOString(),
      }),
    );
    const interaction = {
      isButton: () => false,
      isModalSubmit: () => true,
      customId: AI_UNANSWERED_MODAL_CUSTOM_ID,
      guildId: 'guild-1',
      user: { id: 'admin-1' },
      fields: {
        getTextInputValue: vi.fn((fieldId: string) =>
          fieldId === 'question' ? 'unknown question?' : 'Use the setup guide.',
        ),
      },
      reply,
    } as never;

    const handled = await handleAiUnansweredLearningInteraction(interaction, {
      createCustomQa,
    } as never);

    expect(handled).toBe(true);
    expect(createCustomQa).toHaveBeenCalledWith({
      guildId: 'guild-1',
      question: 'unknown question?',
      answer: 'Use the setup guide.',
      actorDiscordUserId: 'admin-1',
    });
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('saved'),
      }),
    );
  });
});

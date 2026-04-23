import {
  AiAccessService,
  AiAnswerService,
  AiConfigService,
  type AiAnswerResult,
  type AiReplyMode,
  type AiRoleMode,
  type AiTonePreset,
} from '@voodoo/core';

export type AiRuntimeMessage = {
  id: string;
  guildId: string | null;
  channelId: string;
  author: {
    bot: boolean;
    id: string;
  };
  content: string;
  memberRoleIds: string[];
};

export type AiRuntimeGuildState = {
  activated: boolean;
  enabled: boolean;
  tonePreset: AiTonePreset;
  toneInstructions: string;
  roleMode: AiRoleMode;
  defaultReplyMode: AiReplyMode;
  replyChannels: Array<{
    channelId: string;
    replyMode: AiReplyMode;
  }>;
  roleIds: string[];
};

export type AiRuntimeReply = {
  kind: 'reply';
  replyMode: AiReplyMode;
  content: string;
};

export type AiRuntimeResult = { kind: 'ignored' } | { kind: 'failed'; message: string } | AiRuntimeReply;

export type AiMessageRuntimeDependencies = {
  loadGuildState(input: { guildId: string }): Promise<AiRuntimeGuildState>;
  answerMessage(input: {
    guildId: string;
    question: string;
    tonePreset: AiTonePreset;
    toneInstructions: string;
  }): ReturnType<AiAnswerService['answerMessage']>;
};

function normalizeMessageContent(content: string): string {
  return content.trim();
}

function mapRuntimeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'AI worker failed due to an internal error.';
}

function isRoleAllowed(input: {
  roleMode: AiRoleMode;
  allowedRoleIds: string[];
  memberRoleIds: string[];
}): boolean {
  if (input.allowedRoleIds.length === 0) {
    return true;
  }

  const matchedConfiguredRole = input.memberRoleIds.some((roleId) =>
    input.allowedRoleIds.includes(roleId),
  );

  return input.roleMode === 'allowlist' ? matchedConfiguredRole : !matchedConfiguredRole;
}

export function createAiMessageRuntimeDependencies(input?: {
  accessService?: AiAccessService;
  configService?: AiConfigService;
  answerService?: AiAnswerService;
}): AiMessageRuntimeDependencies {
  const accessService = input?.accessService ?? new AiAccessService();
  const configService = input?.configService ?? new AiConfigService();
  const answerService = input?.answerService ?? new AiAnswerService();

  return {
    async loadGuildState({ guildId }) {
      const [activationResult, settingsResult] = await Promise.all([
        accessService.getGuildActivationState({ guildId }),
        configService.getGuildSettingsSnapshot({ guildId }),
      ]);

      if (activationResult.isErr()) {
        throw activationResult.error;
      }

      if (settingsResult.isErr()) {
        throw settingsResult.error;
      }

      return {
        activated: activationResult.value.activated,
        enabled: settingsResult.value.enabled,
        tonePreset: settingsResult.value.tonePreset,
        toneInstructions: settingsResult.value.toneInstructions,
        roleMode: settingsResult.value.roleMode,
        defaultReplyMode: settingsResult.value.defaultReplyMode,
        replyChannels: settingsResult.value.replyChannels,
        roleIds: settingsResult.value.roleIds,
      };
    },
    answerMessage({ guildId, question, tonePreset, toneInstructions }) {
      return answerService.answerMessage({
        guildId,
        question,
        tonePreset,
        toneInstructions,
      });
    },
  };
}

function resolveReplyMode(input: {
  state: AiRuntimeGuildState;
  channelId: string;
}): AiReplyMode | null {
  const replyChannel = input.state.replyChannels.find(
    (channel) => channel.channelId === input.channelId,
  );

  return replyChannel?.replyMode ?? null;
}

function mapAnswerToReply(input: {
  replyMode: AiReplyMode;
  answer: AiAnswerResult;
}): AiRuntimeReply {
  return {
    kind: 'reply',
    replyMode: input.replyMode,
    content: input.answer.content,
  };
}

export async function handleAiMessage(
  message: AiRuntimeMessage,
  dependencies: AiMessageRuntimeDependencies = createAiMessageRuntimeDependencies(),
): Promise<AiRuntimeResult> {
  const normalizedContent = normalizeMessageContent(message.content);
  if (message.author.bot || !message.guildId || normalizedContent.length === 0) {
    return { kind: 'ignored' };
  }

  let state: AiRuntimeGuildState;
  try {
    state = await dependencies.loadGuildState({ guildId: message.guildId });
  } catch (error) {
    return {
      kind: 'failed',
      message: mapRuntimeError(error),
    };
  }

  if (!state.activated || !state.enabled) {
    return { kind: 'ignored' };
  }

  const replyMode = resolveReplyMode({
    state,
    channelId: message.channelId,
  });
  if (!replyMode) {
    return { kind: 'ignored' };
  }

  if (
    !isRoleAllowed({
      roleMode: state.roleMode,
      allowedRoleIds: state.roleIds,
      memberRoleIds: message.memberRoleIds,
    })
  ) {
    return { kind: 'ignored' };
  }

  const answerResult = await dependencies.answerMessage({
    guildId: message.guildId,
    question: normalizedContent,
    tonePreset: state.tonePreset,
    toneInstructions: state.toneInstructions,
  });

  if (answerResult.isErr()) {
    return {
      kind: 'failed',
      message: answerResult.error.message,
    };
  }

  return mapAnswerToReply({
    replyMode,
    answer: answerResult.value,
  });
}

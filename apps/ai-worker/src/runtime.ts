import {
  GatewayIntentBits,
  PermissionFlagsBits,
  type AnyThreadChannel,
  type Client,
  type ClientOptions,
  type Message,
} from 'discord.js';
import { logger, type AiReplyMode } from '@voodoo/core';

import {
  handleAiMessage,
  type AiMessageRuntimeDependencies,
} from './message-runtime.js';

export function createAiClientOptions(): ClientOptions {
  return {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  };
}

export function mapAiWorkerError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'AI worker failed due to an internal error.';
}

type PermissionRequirement = {
  bit: bigint;
  name: string;
};

function isThreadChannel(channel: Message['channel']): channel is AnyThreadChannel {
  return 'isThread' in channel && typeof channel.isThread === 'function' && channel.isThread();
}

function getParentCategoryId(message: Message): string | null {
  if (isThreadChannel(message.channel)) {
    return message.channel.parent && 'parentId' in message.channel.parent
      ? message.channel.parent.parentId
      : null;
  }

  return 'parentId' in message.channel ? message.channel.parentId : null;
}

function getRequiredPermissions(message: Message, replyMode: AiReplyMode): PermissionRequirement[] {
  const required: PermissionRequirement[] = [
    { bit: PermissionFlagsBits.ViewChannel, name: 'ViewChannel' },
  ];

  if (isThreadChannel(message.channel)) {
    required.push({
      bit: PermissionFlagsBits.SendMessagesInThreads,
      name: 'SendMessagesInThreads',
    });
    return required;
  }

  required.push({
    bit: PermissionFlagsBits.SendMessages,
    name: 'SendMessages',
  });

  if (replyMode === 'thread') {
    required.push(
      {
        bit: PermissionFlagsBits.CreatePublicThreads,
        name: 'CreatePublicThreads',
      },
      {
        bit: PermissionFlagsBits.SendMessagesInThreads,
        name: 'SendMessagesInThreads',
      },
    );
  }

  return required;
}

function getMissingPermissions(message: Message, replyMode: AiReplyMode): string[] {
  const clientUser = message.client.user;
  if (!clientUser) {
    return getRequiredPermissions(message, replyMode).map(({ name }) => name);
  }

  const permissions =
    'permissionsFor' in message.channel ? message.channel.permissionsFor(clientUser) : null;
  if (!permissions) {
    return getRequiredPermissions(message, replyMode).map(({ name }) => name);
  }

  return getRequiredPermissions(message, replyMode)
    .filter(({ bit }) => !permissions.has(bit))
    .map(({ name }) => name);
}

export async function processIncomingMessage(
  _client: Client,
  message: Message,
  dependencies?: AiMessageRuntimeDependencies,
): Promise<void> {
  const result = await handleAiMessage(
    {
      id: message.id,
      guildId: message.guildId ?? null,
      channelId: message.channelId,
      parentCategoryId: getParentCategoryId(message),
      author: { bot: message.author.bot, id: message.author.id },
      content: message.content,
      memberRoleIds: message.member?.roles.cache.map((role) => role.id) ?? [],
    },
    dependencies,
  );

  if (result.kind === 'ignored') {
    return;
  }

  if (result.kind === 'failed') {
    logger.warn(
      {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        errorMessage: result.message,
      },
      'ai-worker passive message handling failed',
    );
    return;
  }

  const missingPermissions = getMissingPermissions(message, result.replyMode);
  if (missingPermissions.length > 0) {
    logger.warn(
      {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        replyMode: result.replyMode,
        missingPermissions,
      },
      'ai-worker missing Discord permissions for passive reply',
    );
    return;
  }

  if (result.replyMode === 'thread') {
    const thread = isThreadChannel(message.channel)
      ? message.channel
      : await message.startThread({ name: `ai-${message.id}` });
    await thread.send(result.content);
    return;
  }

  await message.reply(result.content);
}

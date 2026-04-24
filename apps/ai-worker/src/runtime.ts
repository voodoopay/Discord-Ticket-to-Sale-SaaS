import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type AnyThreadChannel,
  type Client,
  type ClientOptions,
  type Interaction,
  type Message,
} from 'discord.js';
import { AiKnowledgeManagementService, logger, type AiReplyMode } from '@voodoo/core';

import {
  handleAiMessage,
  type AiMessageRuntimeDependencies,
  type AiRuntimeUnanswered,
} from './message-runtime.js';

export const AI_UNANSWERED_ADD_QA_CUSTOM_ID = 'ai:unanswered:add-qa';
export const AI_UNANSWERED_MODAL_CUSTOM_ID = 'ai:unanswered:qa-submit';
const AI_UNANSWERED_QUESTION_FIELD_ID = 'question';
const AI_UNANSWERED_ANSWER_FIELD_ID = 'answer';

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

function getParentChannelId(message: Message): string | null {
  if (isThreadChannel(message.channel)) {
    return 'parentId' in message.channel ? message.channel.parentId : null;
  }

  return null;
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

function truncateModalValue(value: string): string {
  return value.length > 4000 ? value.slice(0, 4000) : value;
}

function extractQuestionFromUnansweredLog(interaction: Interaction): string | null {
  if (!interaction.isButton()) {
    return null;
  }

  const field = interaction.message.embeds[0]?.fields.find((embedField) => embedField.name === 'Question');
  const value = field?.value.trim();
  return value && value.length > 0 ? value : null;
}

function buildUnansweredLogPayload(result: AiRuntimeUnanswered) {
  const embed = new EmbedBuilder()
    .setTitle('Unanswered AI question')
    .setDescription('No approved answer was available for this message.')
    .addFields(
      { name: 'Question', value: result.question.slice(0, 1024) },
      { name: 'Source', value: `<#${result.sourceChannelId}>`, inline: true },
      { name: 'Asked by', value: `<@${result.authorId}>`, inline: true },
      { name: 'Message ID', value: result.messageId, inline: true },
    )
    .setTimestamp(new Date());

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(AI_UNANSWERED_ADD_QA_CUSTOM_ID)
      .setLabel('Add Q&A')
      .setStyle(ButtonStyle.Primary),
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

async function postUnansweredLog(client: Client, result: AiRuntimeUnanswered): Promise<void> {
  try {
    const channel = await client.channels.fetch(result.logChannelId);
    if (!channel || !('send' in channel)) {
      logger.warn(
        {
          guildId: result.guildId,
          logChannelId: result.logChannelId,
          messageId: result.messageId,
        },
        'ai-worker unanswered log channel is unavailable',
      );
      return;
    }

    await (channel as { send(input: ReturnType<typeof buildUnansweredLogPayload>): Promise<unknown> }).send(
      buildUnansweredLogPayload(result),
    );
  } catch (error) {
    logger.warn(
      {
        err: error,
        guildId: result.guildId,
        logChannelId: result.logChannelId,
        messageId: result.messageId,
      },
      'ai-worker failed to post unanswered log',
    );
  }
}

function buildAddQaModal(question: string): ModalBuilder {
  const questionInput = new TextInputBuilder()
    .setCustomId(AI_UNANSWERED_QUESTION_FIELD_ID)
    .setLabel('Question')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setValue(truncateModalValue(question));

  const answerInput = new TextInputBuilder()
    .setCustomId(AI_UNANSWERED_ANSWER_FIELD_ID)
    .setLabel('Answer')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(AI_UNANSWERED_MODAL_CUSTOM_ID)
    .setTitle('Add AI Q&A')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(questionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(answerInput),
    );
}

type AiCustomQaCreator = Pick<AiKnowledgeManagementService, 'createCustomQa'>;

export async function handleAiUnansweredLearningInteraction(
  interaction: Interaction,
  knowledgeService: AiCustomQaCreator = new AiKnowledgeManagementService(),
): Promise<boolean> {
  if (interaction.isButton() && interaction.customId === AI_UNANSWERED_ADD_QA_CUSTOM_ID) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This Q&A action can only be used inside a server.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need the Discord Administrator permission to add AI Q&A entries.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const question = extractQuestionFromUnansweredLog(interaction);
    if (!question) {
      await interaction.reply({
        content: 'This unanswered item is missing its original question. Add the Q&A from the dashboard instead.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.showModal(buildAddQaModal(question));
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === AI_UNANSWERED_MODAL_CUSTOM_ID) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This Q&A action can only be used inside a server.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const result = await knowledgeService.createCustomQa({
      guildId: interaction.guildId,
      question: interaction.fields.getTextInputValue(AI_UNANSWERED_QUESTION_FIELD_ID),
      answer: interaction.fields.getTextInputValue(AI_UNANSWERED_ANSWER_FIELD_ID),
      actorDiscordUserId: interaction.user.id,
    });

    if (result.isErr()) {
      await interaction.reply({
        content: result.error.message,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.reply({
      content: 'AI Q&A saved. Future matching questions can use this answer.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

export async function processIncomingMessage(
  client: Client,
  message: Message,
  dependencies?: AiMessageRuntimeDependencies,
): Promise<void> {
  const result = await handleAiMessage(
    {
      id: message.id,
      guildId: message.guildId ?? null,
      channelId: message.channelId,
      parentChannelId: getParentChannelId(message),
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

  if (result.kind === 'unanswered') {
    await postUnansweredLog(client, result);
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

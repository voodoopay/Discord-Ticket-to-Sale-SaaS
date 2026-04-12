import {
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  type NonThreadGuildBasedChannel,
} from 'discord.js';
import {
  AppError,
  ChannelCopyService,
  type ChannelCopyRuntimeAdapter,
} from '@voodoo/core';

const channelCopyService = new ChannelCopyService();

function mapChannelCopyError(error: unknown): string {
  if (error instanceof AppError) {
    if (error.code === 'CHANNEL_COPY_RUN_FAILED') {
      return 'Channel copy failed due to an internal worker error. Please try again and check logs.';
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Channel copy failed due to an internal worker error. Please try again and check logs.';
}

async function deferEphemeralReply(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

function hasGuildTextChannelShape(
  channel: GuildBasedChannel,
): channel is GuildTextBasedChannel & NonThreadGuildBasedChannel {
  return (
    channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement
  );
}

async function fetchSupportedGuildTextChannel(
  client: Client,
  channelId: string,
): Promise<GuildTextBasedChannel & NonThreadGuildBasedChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !channel.inGuild() || !hasGuildTextChannelShape(channel)) {
    throw new AppError(
      'CHANNEL_COPY_INVALID_CHANNEL',
      'Only guild text and announcement channels are supported for channel copy.',
      422,
    );
  }

  return channel;
}

function assertBotPermissions(input: {
  client: Client;
  channel: GuildTextBasedChannel & NonThreadGuildBasedChannel;
  permissions: bigint[];
  onMissing: string;
}): void {
  const botUserId = input.client.user?.id;
  if (!botUserId) {
    throw new AppError('CHANNEL_COPY_CLIENT_NOT_READY', 'The channel-copy worker is not ready yet.', 503);
  }

  const permissions = input.channel.permissionsFor(botUserId);
  if (!permissions || !input.permissions.every((permission) => permissions.has(permission))) {
    throw new AppError('CHANNEL_COPY_MISSING_PERMISSIONS', input.onMissing, 403);
  }
}

export function createDiscordRuntimeAdapter(client: Client): ChannelCopyRuntimeAdapter {
  return {
    async getChannel({ channelId }) {
      const channel = await fetchSupportedGuildTextChannel(client, channelId);

      return {
        id: channel.id,
        guildId: channel.guildId,
        kind: channel.type === ChannelType.GuildAnnouncement ? 'guildAnnouncement' : 'guildText',
      };
    },
    async assertReadableSource({ channelId }) {
      const channel = await fetchSupportedGuildTextChannel(client, channelId);
      assertBotPermissions({
        client,
        channel,
        permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        onMissing:
          'The channel-copy worker is missing permission to read the source channel history.',
      });
    },
    async assertWritableDestination({ channelId }) {
      const channel = await fetchSupportedGuildTextChannel(client, channelId);
      assertBotPermissions({
        client,
        channel,
        permissions: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
        ],
        onMissing:
          'The channel-copy worker is missing permission to post messages or upload files in the destination channel.',
      });
    },
    async countDestinationMessages({ channelId }) {
      const channel = await fetchSupportedGuildTextChannel(client, channelId);
      const batch = await channel.messages.fetch({ limit: 1 });
      return batch.size;
    },
    async listSourceMessages({ channelId, afterMessageId, limit }) {
      const channel = await fetchSupportedGuildTextChannel(client, channelId);
      const messages = await channel.messages.fetch({
        limit,
        after: afterMessageId ?? undefined,
      });
      const orderedMessages = [...messages.values()].sort((left, right) =>
        left.id.localeCompare(right.id, 'en', { numeric: true }),
      );

      return Promise.all(
        orderedMessages.map(async (message) => ({
          id: message.id,
          content: message.content,
          attachments: await Promise.all(
            [...message.attachments.values()].map(async (attachment) => {
              const response = await fetch(attachment.url);
              if (!response.ok) {
                throw new AppError(
                  'CHANNEL_COPY_ATTACHMENT_FETCH_FAILED',
                  `Failed to download attachment \`${attachment.name ?? attachment.id}\` from the source channel.`,
                  502,
                );
              }

              return {
                name: attachment.name ?? `${attachment.id}.bin`,
                contentType: attachment.contentType ?? null,
                data: Buffer.from(await response.arrayBuffer()),
              };
            }),
          ),
          isSystem: message.system,
        })),
      );
    },
    async repostMessage({ channelId, content, attachments }) {
      const channel = await fetchSupportedGuildTextChannel(client, channelId);
      const sent = await channel.send({
        content: content.length > 0 ? content : undefined,
        files: attachments.map(
          (attachment) =>
            new AttachmentBuilder(attachment.data, {
              name: attachment.name,
            }),
        ),
      });

      return { destinationMessageId: sent.id };
    },
  };
}

export const channelCopyCommand = {
  data: new SlashCommandBuilder()
    .setName('channel-copy')
    .setDescription('Copy one source channel into one destination channel once')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('run')
        .setDescription('Copy all messages and attachments from a source channel into a destination channel')
        .addStringOption((option) =>
          option
            .setName('source_channel_id')
            .setDescription('Source Discord channel ID')
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(32),
        )
        .addStringOption((option) =>
          option
            .setName('destination_channel_id')
            .setDescription('Destination Discord channel ID')
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(32),
        )
        .addStringOption((option) =>
          option
            .setName('confirm')
            .setDescription('Force-confirm token returned when the destination is not empty'),
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await deferEphemeralReply(interaction);

    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.editReply({
        content: 'This command can only be used inside the destination server.',
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand !== 'run') {
      await interaction.editReply({
        content: `Unknown channel-copy subcommand: ${subcommand}`,
      });
      return;
    }

    const sourceChannelId = interaction.options.getString('source_channel_id', true).trim();
    const destinationChannelId = interaction.options.getString('destination_channel_id', true).trim();
    const confirmToken = interaction.options.getString('confirm');

    if (sourceChannelId === destinationChannelId) {
      await interaction.editReply({
        content: 'Source and destination channels must be different.',
      });
      return;
    }

    const accessState = await channelCopyService.getCommandAccessState({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
    });
    if (accessState.isErr()) {
      await interaction.editReply({ content: mapChannelCopyError(accessState.error) });
      return;
    }

    if (!accessState.value.allowed) {
      await interaction.editReply({
        content:
          accessState.value.authorizedUserCount > 0
            ? 'This channel-copy worker is active for this server, but your Discord ID is not on the `/channel-copy` allowlist.'
            : 'This channel-copy worker is locked for this server. A super admin must activate this server by granting your Discord ID access before `/channel-copy` can be used here.',
      });
      return;
    }

    const result = await channelCopyService.startCopyRun({
      sourceChannelId,
      destinationChannelId,
      requestedByDiscordUserId: interaction.user.id,
      destinationGuildId: interaction.guildId,
      confirmToken,
      adapter: createDiscordRuntimeAdapter(interaction.client),
    });
    if (result.isErr()) {
      await interaction.editReply({ content: mapChannelCopyError(result.error) });
      return;
    }

    if (result.value.status === 'awaiting_confirmation') {
      await interaction.editReply({
        content: `Destination channel is not empty. Rerun this command with confirm:\`${result.value.requiresConfirmToken}\`. Job ID: \`${result.value.jobId}\`.`,
      });
      return;
    }

    await interaction.editReply({
      content: `Copy complete. Job ID: \`${result.value.jobId}\`. Copied ${result.value.copiedMessageCount} message(s) and skipped ${result.value.skippedMessageCount}.`,
    });
  },
};

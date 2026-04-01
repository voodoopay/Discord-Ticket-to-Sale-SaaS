import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import {
  NukeService,
  type ChannelNukeAuthorizedUserSummary,
  getEnv,
} from '@voodoo/core';

import { mapNukeError } from './nuke.js';

const nukeService = new NukeService();

function isSuperAdminUser(discordUserId: string): boolean {
  return getEnv().superAdminDiscordIds.includes(discordUserId);
}

function normalizeDiscordId(value: string): string | null {
  const trimmed = value.trim();
  return /^\d{17,32}$/u.test(trimmed) ? trimmed : null;
}

function resolveNukeScopeId(guildId: string): string {
  return guildId;
}

async function deferEphemeralReply(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function sendEphemeralReply(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply({ content });
    return;
  }

  if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function resolveTargetGuild(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<Guild | null> {
  try {
    return await interaction.client.guilds.fetch(guildId);
  } catch {
    return null;
  }
}

function buildAuthorizedUsersMessage(input: {
  guild: Guild;
  authorizedUsers: ChannelNukeAuthorizedUserSummary[];
}): string {
  if (input.authorizedUsers.length === 0) {
    return [
      `No \`/nuke\` users are activated for \`${input.guild.name}\` (\`${input.guild.id}\`) yet.`,
      'Use `/activation grant guild_id:<server-id> user_id:<user-id>` to unlock this guild.',
    ].join('\n');
  }

  return [
    `Authorized \`/nuke\` users for \`${input.guild.name}\` (\`${input.guild.id}\`):`,
    ...input.authorizedUsers.map((user) => `<@${user.discordUserId}> (\`${user.discordUserId}\`)`),
  ].join('\n');
}

export const activationCommand = {
  data: new SlashCommandBuilder()
    .setName('activation')
    .setDescription('Manage remote activation for the nuke worker')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('grant')
        .setDescription('Grant nuke access for a target server and Discord user')
        .addStringOption((option) =>
          option
            .setName('guild_id')
            .setDescription('Discord server ID to activate')
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(32),
        )
        .addStringOption((option) =>
          option
            .setName('user_id')
            .setDescription('Discord user ID to authorize')
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(32),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('revoke')
        .setDescription('Revoke nuke access for a target server and Discord user')
        .addStringOption((option) =>
          option
            .setName('guild_id')
            .setDescription('Discord server ID to change')
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(32),
        )
        .addStringOption((option) =>
          option
            .setName('user_id')
            .setDescription('Discord user ID to remove')
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(32),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List nuke users activated for a target server')
        .addStringOption((option) =>
          option
            .setName('guild_id')
            .setDescription('Discord server ID to inspect')
            .setRequired(true)
            .setMinLength(17)
            .setMaxLength(32),
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!isSuperAdminUser(interaction.user.id)) {
      await sendEphemeralReply(
        interaction,
        'Only the configured super admin Discord ID can manage nuke activation.',
      );
      return;
    }

    await deferEphemeralReply(interaction);

    try {
      const subcommand = interaction.options.getSubcommand(true);
      const guildId = normalizeDiscordId(interaction.options.getString('guild_id', true));
      if (!guildId) {
        await sendEphemeralReply(
          interaction,
          'The `guild_id` value must be a valid Discord server ID.',
        );
        return;
      }

      const guild = await resolveTargetGuild(interaction, guildId);
      if (!guild) {
        await sendEphemeralReply(
          interaction,
          'This nuke worker is not present in the target server, or the server ID is invalid.',
        );
        return;
      }

      const nukeScopeId = resolveNukeScopeId(guildId);

      if (subcommand === 'list') {
        const result = await nukeService.listAuthorizedUsers({
          tenantId: nukeScopeId,
          guildId,
        });
        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        await sendEphemeralReply(
          interaction,
          buildAuthorizedUsersMessage({ guild, authorizedUsers: result.value }),
        );
        return;
      }

      const userId = normalizeDiscordId(interaction.options.getString('user_id', true));
      if (!userId) {
        await sendEphemeralReply(
          interaction,
          'The `user_id` value must be a valid Discord user ID.',
        );
        return;
      }

      if (subcommand === 'grant') {
        const result = await nukeService.grantUserAccess({
          tenantId: nukeScopeId,
          guildId,
          discordUserId: userId,
          grantedByDiscordUserId: interaction.user.id,
        });
        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        await sendEphemeralReply(
          interaction,
          result.value.created
            ? `Granted \`/nuke\` access for \`${userId}\` in \`${guild.name}\` (\`${guild.id}\`).`
            : `\`${userId}\` already had \`/nuke\` access in \`${guild.name}\` (\`${guild.id}\`).`,
        );
        return;
      }

      if (subcommand === 'revoke') {
        const result = await nukeService.revokeUserAccess({
          tenantId: nukeScopeId,
          guildId,
          discordUserId: userId,
        });
        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        await sendEphemeralReply(
          interaction,
          result.value.revoked
            ? `Revoked \`/nuke\` access for \`${userId}\` in \`${guild.name}\` (\`${guild.id}\`).`
            : `No \`/nuke\` access entry exists for \`${userId}\` in \`${guild.name}\` (\`${guild.id}\`).`,
        );
        return;
      }

      await sendEphemeralReply(interaction, `Unknown activation subcommand: ${subcommand}`);
    } catch (error) {
      await sendEphemeralReply(interaction, mapNukeError(error));
    }
  },
};

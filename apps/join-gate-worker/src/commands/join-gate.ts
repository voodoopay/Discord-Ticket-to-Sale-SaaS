import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  type JoinGateAuthorizedUserSummary,
  JoinGateAccessService,
  TenantRepository,
  getEnv,
} from '@voodoo/core';

import { mapJoinGateError, runJoinGateInstall, runJoinGateStatus, runJoinGateSync } from '../join-gate-runtime.js';

const tenantRepository = new TenantRepository();
const joinGateAccessService = new JoinGateAccessService();

function isSuperAdminUser(discordUserId: string): boolean {
  return getEnv().superAdminDiscordIds.includes(discordUserId);
}

function getJoinGateLockedMessage(authorizedUserCount: number): string {
  if (authorizedUserCount === 0) {
    return 'This join-gate worker is locked for this server. A super admin must activate this server by granting your Discord ID access before you can use `/join-gate` commands.';
  }

  return 'This join-gate worker is active for this server, but your Discord ID is not on the `/join-gate` allowlist. A super admin must grant your Discord ID access before you can use `/join-gate` commands.';
}

function getSuperAdminOnlyAccessMessage(): string {
  return 'Only the configured super admin Discord ID can manage `/join-gate` access.';
}

export function buildJoinGateAuthorizedUsersMessage(
  authorizedUsers: JoinGateAuthorizedUserSummary[],
): string {
  if (authorizedUsers.length === 0) {
    return [
      'This server is not activated for `/join-gate` yet.',
      'When the list is empty, only users in `SUPER_ADMIN_DISCORD_IDS` can manage activation.',
      'Use `/join-gate grant user:@someone` to activate this server for the first allowed user.',
    ].join('\n');
  }

  return [
    'Authorized `/join-gate` users for this server:',
    ...authorizedUsers.map((user) => `<@${user.discordUserId}> (\`${user.discordUserId}\`)`),
    'Only listed users plus super admins can use `/join-gate` in this server.',
  ].join('\n');
}

export const joinGateCommand = {
  data: new SlashCommandBuilder()
    .setName('join-gate')
    .setDescription('Manage the member join verification gate for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('Show join-gate setup, index, and permission status'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('sync').setDescription('Rebuild the email lookup index from the configured channels'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('install').setDescription('Post or refresh the fallback verify panel'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('authorized').setDescription('List Discord users allowed to use /join-gate here'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('grant')
        .setDescription('Grant /join-gate access to a Discord user for this server')
        .addUserOption((option) =>
          option.setName('user').setDescription('Discord user to authorize').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('revoke')
        .setDescription('Revoke /join-gate access from a Discord user for this server')
        .addUserOption((option) =>
          option.setName('user').setDescription('Discord user to remove').setRequired(true),
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used inside a Discord server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const hasManageGuild =
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      false;

    if (!hasManageGuild) {
      await interaction.reply({
        content: 'You need Manage Server or Administrator to manage the join gate.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const tenant = await tenantRepository.getTenantByGuildId(interaction.guild.id);
      if (!tenant) {
        await interaction.editReply({ content: 'This server is not connected to a tenant/workspace.' });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      const isSuperAdmin = isSuperAdminUser(interaction.user.id);

      if (subcommand === 'authorized') {
        if (!isSuperAdmin) {
          await interaction.editReply({ content: getSuperAdminOnlyAccessMessage() });
          return;
        }

        const result = await joinGateAccessService.listAuthorizedUsers({
          tenantId: tenant.tenantId,
          guildId: interaction.guild.id,
        });
        if (result.isErr()) {
          await interaction.editReply({ content: mapJoinGateError(result.error) });
          return;
        }

        await interaction.editReply({ content: buildJoinGateAuthorizedUsersMessage(result.value) });
        return;
      }

      if (subcommand === 'grant') {
        if (!isSuperAdmin) {
          await interaction.editReply({ content: getSuperAdminOnlyAccessMessage() });
          return;
        }

        const targetUser = interaction.options.getUser('user', true);
        const result = await joinGateAccessService.grantUserAccess({
          tenantId: tenant.tenantId,
          guildId: interaction.guild.id,
          discordUserId: targetUser.id,
          grantedByDiscordUserId: interaction.user.id,
        });
        if (result.isErr()) {
          await interaction.editReply({ content: mapJoinGateError(result.error) });
          return;
        }

        await interaction.editReply({
          content: result.value.created
            ? `Granted \`/join-gate\` access for <@${targetUser.id}> in this server.`
            : `<@${targetUser.id}> already had \`/join-gate\` access in this server.`,
        });
        return;
      }

      if (subcommand === 'revoke') {
        if (!isSuperAdmin) {
          await interaction.editReply({ content: getSuperAdminOnlyAccessMessage() });
          return;
        }

        const targetUser = interaction.options.getUser('user', true);
        const result = await joinGateAccessService.revokeUserAccess({
          tenantId: tenant.tenantId,
          guildId: interaction.guild.id,
          discordUserId: targetUser.id,
        });
        if (result.isErr()) {
          await interaction.editReply({ content: mapJoinGateError(result.error) });
          return;
        }

        await interaction.editReply({
          content: result.value.revoked
            ? `Revoked \`/join-gate\` access for <@${targetUser.id}> in this server.`
            : `No extra \`/join-gate\` access entry exists for <@${targetUser.id}> in this server.`,
        });
        return;
      }

      if (!isSuperAdmin) {
        const accessState = await joinGateAccessService.getCommandAccessState({
          tenantId: tenant.tenantId,
          guildId: interaction.guild.id,
          discordUserId: interaction.user.id,
        });
        if (accessState.isErr()) {
          await interaction.editReply({ content: mapJoinGateError(accessState.error) });
          return;
        }

        if (accessState.value.locked && !accessState.value.allowed) {
          await interaction.editReply({
            content: getJoinGateLockedMessage(accessState.value.authorizedUserCount),
          });
          return;
        }
      }

      if (subcommand === 'status') {
        await runJoinGateStatus(interaction);
        return;
      }

      if (subcommand === 'sync') {
        await runJoinGateSync(interaction);
        return;
      }

      if (subcommand === 'install') {
        await runJoinGateInstall(interaction);
        return;
      }

      await interaction.editReply({ content: `Unknown subcommand: ${subcommand}` });
    } catch (error) {
      await interaction.editReply({ content: mapJoinGateError(error) });
    }
  },
};

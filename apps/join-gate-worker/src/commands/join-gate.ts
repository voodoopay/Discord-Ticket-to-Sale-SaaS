import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  AppError,
  type GuildConfigRecord,
  type JoinGateAuthorizedUserSummary,
  JoinGateAccessService,
  TenantRepository,
  getEnv,
  validateJoinGateConfig,
} from '@voodoo/core';

import { mapJoinGateError, runJoinGateInstall, runJoinGateStatus, runJoinGateSync } from '../join-gate-runtime.js';

const tenantRepository = new TenantRepository();
const joinGateAccessService = new JoinGateAccessService();

const DEFAULT_REFERRAL_THANK_YOU_TEMPLATE =
  'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.';
const DEFAULT_REFERRAL_SUBMISSION_TEMPLATE =
  'Referral submitted successfully. We will reward points automatically after the first paid order.';

type JoinGateConfigWriteInput = {
  joinGateEnabled: boolean;
  joinGateFallbackChannelId: string | null;
  joinGateVerifiedRoleId: string | null;
  joinGateTicketCategoryId: string | null;
  joinGateCurrentLookupChannelId: string | null;
  joinGateNewLookupChannelId: string | null;
};

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

function buildBaseGuildConfigRecord(input: {
  tenantId: string;
  guildId: string;
  existingConfig: GuildConfigRecord | null;
}): Omit<GuildConfigRecord, 'id'> {
  return {
    tenantId: input.tenantId,
    guildId: input.guildId,
    paidLogChannelId: input.existingConfig?.paidLogChannelId ?? null,
    staffRoleIds: input.existingConfig?.staffRoleIds ?? [],
    defaultCurrency: input.existingConfig?.defaultCurrency ?? 'GBP',
    tipEnabled: input.existingConfig?.tipEnabled ?? false,
    pointsEarnCategoryKeys: input.existingConfig?.pointsEarnCategoryKeys ?? [],
    pointsRedeemCategoryKeys: input.existingConfig?.pointsRedeemCategoryKeys ?? [],
    pointValueMinor: input.existingConfig?.pointValueMinor ?? 1,
    referralRewardMinor: input.existingConfig?.referralRewardMinor ?? 0,
    referralRewardCategoryKeys: input.existingConfig?.referralRewardCategoryKeys ?? [],
    referralLogChannelId: input.existingConfig?.referralLogChannelId ?? null,
    referralThankYouTemplate:
      input.existingConfig?.referralThankYouTemplate ?? DEFAULT_REFERRAL_THANK_YOU_TEMPLATE,
    referralSubmissionTemplate:
      input.existingConfig?.referralSubmissionTemplate ?? DEFAULT_REFERRAL_SUBMISSION_TEMPLATE,
    ticketMetadataKey: input.existingConfig?.ticketMetadataKey ?? 'isTicket',
    joinGateEnabled: input.existingConfig?.joinGateEnabled ?? false,
    joinGateFallbackChannelId: input.existingConfig?.joinGateFallbackChannelId ?? null,
    joinGateVerifiedRoleId: input.existingConfig?.joinGateVerifiedRoleId ?? null,
    joinGateTicketCategoryId: input.existingConfig?.joinGateTicketCategoryId ?? null,
    joinGateCurrentLookupChannelId: input.existingConfig?.joinGateCurrentLookupChannelId ?? null,
    joinGateNewLookupChannelId: input.existingConfig?.joinGateNewLookupChannelId ?? null,
  };
}

async function saveJoinGateConfig(input: {
  guildId: string;
  config: JoinGateConfigWriteInput;
}): Promise<GuildConfigRecord> {
  const tenant = await tenantRepository.getTenantByGuildId(input.guildId);
  if (!tenant) {
    throw new AppError('JOIN_GATE_GUILD_NOT_CONNECTED', 'This server is not connected to a tenant/workspace.', 404);
  }

  const validation = validateJoinGateConfig(input.config);
  if (validation.isErr()) {
    throw validation.error;
  }

  const existingConfig = await tenantRepository.getGuildConfig({
    tenantId: tenant.tenantId,
    guildId: input.guildId,
  });
  const baseConfig = buildBaseGuildConfigRecord({
    tenantId: tenant.tenantId,
    guildId: input.guildId,
    existingConfig,
  });

  return tenantRepository.upsertGuildConfig({
    ...baseConfig,
    ...input.config,
  });
}

function buildJoinGateSetupSavedMessage(config: GuildConfigRecord): string {
  return [
    'Join gate configuration saved for this server.',
    `Fallback verify channel: <#${config.joinGateFallbackChannelId}>`,
    `Verified role: <@&${config.joinGateVerifiedRoleId}>`,
    `Ticket category: <#${config.joinGateTicketCategoryId}>`,
    `Current-customer lookup: <#${config.joinGateCurrentLookupChannelId}>`,
    `New-customer lookup: <#${config.joinGateNewLookupChannelId}>`,
    'Next steps: run `/join-gate sync`, then `/join-gate install`, then `/join-gate status`.',
  ].join('\n');
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
      subcommand
        .setName('setup')
        .setDescription('Configure join-gate channels, role, and category from Discord')
        .addChannelOption((option) =>
          option
            .setName('fallback_channel')
            .setDescription('Text channel unverified members can still see')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('verified_role')
            .setDescription('Role granted after successful verification')
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('ticket_category')
            .setDescription('Category where private verification tickets are created')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('current_lookup_channel')
            .setDescription('Lookup channel for current-customer email matches')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('new_lookup_channel')
            .setDescription('Lookup channel for new-customer or referral email matches')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('disable').setDescription('Disable join gate and clear its Discord-side configuration'),
    )
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

      if (subcommand === 'setup') {
        const fallbackChannel = interaction.options.getChannel('fallback_channel', true);
        const verifiedRole = interaction.options.getRole('verified_role', true);
        const ticketCategory = interaction.options.getChannel('ticket_category', true);
        const currentLookupChannel = interaction.options.getChannel('current_lookup_channel', true);
        const newLookupChannel = interaction.options.getChannel('new_lookup_channel', true);

        const config = await saveJoinGateConfig({
          guildId: interaction.guild.id,
          config: {
            joinGateEnabled: true,
            joinGateFallbackChannelId: fallbackChannel.id,
            joinGateVerifiedRoleId: verifiedRole.id,
            joinGateTicketCategoryId: ticketCategory.id,
            joinGateCurrentLookupChannelId: currentLookupChannel.id,
            joinGateNewLookupChannelId: newLookupChannel.id,
          },
        });

        await interaction.editReply({
          content: buildJoinGateSetupSavedMessage(config),
        });
        return;
      }

      if (subcommand === 'disable') {
        await saveJoinGateConfig({
          guildId: interaction.guild.id,
          config: {
            joinGateEnabled: false,
            joinGateFallbackChannelId: null,
            joinGateVerifiedRoleId: null,
            joinGateTicketCategoryId: null,
            joinGateCurrentLookupChannelId: null,
            joinGateNewLookupChannelId: null,
          },
        });

        await interaction.editReply({
          content: 'Join gate is disabled for this server. Its Discord-side configuration has been cleared.',
        });
        return;
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

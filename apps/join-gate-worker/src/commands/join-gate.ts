import {
  ApplicationCommandOptionType,
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

type JoinGateConfigPatch = Partial<
  Pick<
    GuildConfigRecord,
    | 'joinGateEnabled'
    | 'joinGateStaffRoleIds'
    | 'joinGateFallbackChannelId'
    | 'joinGateVerifiedRoleId'
    | 'joinGateTicketCategoryId'
    | 'joinGateCurrentLookupChannelId'
    | 'joinGateNewLookupChannelId'
    | 'joinGatePanelTitle'
    | 'joinGatePanelMessage'
  >
>;

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
    couponsEnabled: input.existingConfig?.couponsEnabled ?? true,
    pointsEnabled: input.existingConfig?.pointsEnabled ?? true,
    referralsEnabled: input.existingConfig?.referralsEnabled ?? true,
    telegramEnabled: input.existingConfig?.telegramEnabled ?? false,
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
    joinGateStaffRoleIds: input.existingConfig?.joinGateStaffRoleIds ?? [],
    joinGateFallbackChannelId: input.existingConfig?.joinGateFallbackChannelId ?? null,
    joinGateVerifiedRoleId: input.existingConfig?.joinGateVerifiedRoleId ?? null,
    joinGateTicketCategoryId: input.existingConfig?.joinGateTicketCategoryId ?? null,
    joinGateCurrentLookupChannelId: input.existingConfig?.joinGateCurrentLookupChannelId ?? null,
    joinGateNewLookupChannelId: input.existingConfig?.joinGateNewLookupChannelId ?? null,
    joinGatePanelTitle: input.existingConfig?.joinGatePanelTitle ?? null,
    joinGatePanelMessage: input.existingConfig?.joinGatePanelMessage ?? null,
  };
}

function normalizeOptionalConfigText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function saveGuildConfigPatch(input: {
  guildId: string;
  patch: JoinGateConfigPatch;
}): Promise<GuildConfigRecord> {
  const tenant = await tenantRepository.getTenantByGuildId(input.guildId);
  if (!tenant) {
    throw new AppError('JOIN_GATE_GUILD_NOT_CONNECTED', 'This server is not connected to a tenant/workspace.', 404);
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

  const nextConfig = {
    ...baseConfig,
    ...input.patch,
  };

  const validation = validateJoinGateConfig(nextConfig);
  if (validation.isErr()) {
    throw validation.error;
  }

  return tenantRepository.upsertGuildConfig(nextConfig);
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

function buildJoinGateStaffRolesMessage(roleIds: string[]): string {
  if (roleIds.length === 0) {
    return [
      'No join-gate staff roles are configured yet.',
      'Use `/join-gate staff-add role:@Staff` to allow a role to see newly opened verification tickets.',
    ].join('\n');
  }

  return [
    'Join-gate staff roles:',
    ...roleIds.map((roleId) => `<@&${roleId}>`),
  ].join('\n');
}

function buildJoinGatePanelSavedMessage(config: GuildConfigRecord): string {
  return [
    'Fallback verify panel text saved.',
    `Title: ${config.joinGatePanelTitle ? `"${config.joinGatePanelTitle}"` : 'Default title'}`,
    `Message: ${config.joinGatePanelMessage ? `"${config.joinGatePanelMessage}"` : 'Default welcome message'}`,
    'Run `/join-gate install` to post or refresh the fallback panel with the updated embed.',
  ].join('\n');
}

function getRawSubcommandOptionId(
  interaction: ChatInputCommandInteraction,
  optionName: string,
): string {
  const subcommandOption = interaction.options.data.find(
    (option) => option.type === ApplicationCommandOptionType.Subcommand,
  );
  const targetOption = subcommandOption?.options?.find((option) => option.name === optionName);
  const value = targetOption?.value;

  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  throw new AppError(
    'JOIN_GATE_OPTION_INVALID',
    `The required \`${optionName}\` value could not be resolved from this command interaction.`,
    400,
  );
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
      subcommand
        .setName('panel')
        .setDescription('Save a custom fallback embed title and welcome message for the verify panel')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('Optional custom embed title for the fallback verify panel')
            .setMaxLength(120),
        )
        .addStringOption((option) =>
          option
            .setName('message')
            .setDescription('Optional custom welcome message shown above the verification instructions')
            .setMaxLength(2000),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('panel-reset').setDescription('Reset the fallback verify panel back to the default title and message'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('staff-add')
        .setDescription('Allow a staff role to see new verification tickets')
        .addRoleOption((option) =>
          option.setName('role').setDescription('Role that should see new verification tickets').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('staff-remove')
        .setDescription('Remove a staff role from new verification tickets')
        .addRoleOption((option) =>
          option.setName('role').setDescription('Role to remove from verification ticket access').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('staff-list').setDescription('List the staff roles that can see new verification tickets'),
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
        const fallbackChannelId = getRawSubcommandOptionId(interaction, 'fallback_channel');
        const verifiedRoleId = getRawSubcommandOptionId(interaction, 'verified_role');
        const ticketCategoryId = getRawSubcommandOptionId(interaction, 'ticket_category');
        const currentLookupChannelId = getRawSubcommandOptionId(interaction, 'current_lookup_channel');
        const newLookupChannelId = getRawSubcommandOptionId(interaction, 'new_lookup_channel');

        const config = await saveGuildConfigPatch({
          guildId: interaction.guild.id,
          patch: {
            joinGateEnabled: true,
            joinGateFallbackChannelId: fallbackChannelId,
            joinGateVerifiedRoleId: verifiedRoleId,
            joinGateTicketCategoryId: ticketCategoryId,
            joinGateCurrentLookupChannelId: currentLookupChannelId,
            joinGateNewLookupChannelId: newLookupChannelId,
          },
        });

        await interaction.editReply({
          content: buildJoinGateSetupSavedMessage(config),
        });
        return;
      }

      if (subcommand === 'disable') {
        await saveGuildConfigPatch({
          guildId: interaction.guild.id,
          patch: {
            joinGateEnabled: false,
            joinGateFallbackChannelId: null,
            joinGateVerifiedRoleId: null,
            joinGateTicketCategoryId: null,
            joinGateCurrentLookupChannelId: null,
            joinGateNewLookupChannelId: null,
            joinGatePanelTitle: null,
            joinGatePanelMessage: null,
          },
        });

        await interaction.editReply({
          content: 'Join gate is disabled for this server. Its Discord-side configuration has been cleared.',
        });
        return;
      }

      if (subcommand === 'panel') {
        const title = normalizeOptionalConfigText(interaction.options.getString('title'));
        const message = normalizeOptionalConfigText(interaction.options.getString('message'));

        if (!title && !message) {
          await interaction.editReply({
            content: 'Provide `title`, `message`, or both so I know what to save for the fallback verify panel.',
          });
          return;
        }

        const config = await saveGuildConfigPatch({
          guildId: interaction.guild.id,
          patch: {
            ...(title !== null ? { joinGatePanelTitle: title } : {}),
            ...(message !== null ? { joinGatePanelMessage: message } : {}),
          },
        });

        await interaction.editReply({
          content: buildJoinGatePanelSavedMessage(config),
        });
        return;
      }

      if (subcommand === 'panel-reset') {
        const config = await saveGuildConfigPatch({
          guildId: interaction.guild.id,
          patch: {
            joinGatePanelTitle: null,
            joinGatePanelMessage: null,
          },
        });

        await interaction.editReply({
          content: buildJoinGatePanelSavedMessage(config),
        });
        return;
      }

      if (subcommand === 'staff-list') {
        const existingConfig = await tenantRepository.getGuildConfig({
          tenantId: tenant.tenantId,
          guildId: interaction.guild.id,
        });

        await interaction.editReply({
          content: buildJoinGateStaffRolesMessage(existingConfig?.joinGateStaffRoleIds ?? []),
        });
        return;
      }

      if (subcommand === 'staff-add') {
        const roleId = getRawSubcommandOptionId(interaction, 'role');
        const existingConfig = await tenantRepository.getGuildConfig({
          tenantId: tenant.tenantId,
          guildId: interaction.guild.id,
        });
        const nextRoleIds = Array.from(new Set([...(existingConfig?.joinGateStaffRoleIds ?? []), roleId]));
        const config = await saveGuildConfigPatch({
          guildId: interaction.guild.id,
          patch: {
            joinGateStaffRoleIds: nextRoleIds,
          },
        });

        await interaction.editReply({
          content: [
            `Added <@&${roleId}> to join-gate staff ticket access.`,
            buildJoinGateStaffRolesMessage(config.joinGateStaffRoleIds ?? []),
          ].join('\n'),
        });
        return;
      }

      if (subcommand === 'staff-remove') {
        const roleId = getRawSubcommandOptionId(interaction, 'role');
        const existingConfig = await tenantRepository.getGuildConfig({
          tenantId: tenant.tenantId,
          guildId: interaction.guild.id,
        });
        const nextRoleIds = (existingConfig?.joinGateStaffRoleIds ?? []).filter(
          (existingRoleId) => existingRoleId !== roleId,
        );
        const config = await saveGuildConfigPatch({
          guildId: interaction.guild.id,
          patch: {
            joinGateStaffRoleIds: nextRoleIds,
          },
        });

        await interaction.editReply({
          content: [
            `Removed <@&${roleId}> from join-gate staff ticket access.`,
            buildJoinGateStaffRolesMessage(config.joinGateStaffRoleIds ?? []),
          ].join('\n'),
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

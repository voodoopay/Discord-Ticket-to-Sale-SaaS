import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  AppError,
  type ChannelNukeAuthorizedUserSummary,
  type ChannelNukeScheduleSummary,
  getEnv,
  NukeService,
  TenantRepository,
  logger,
} from '@voodoo/core';
import { deferEphemeralReply, sendEphemeralReply } from '../utils/replies.js';
import { getTimezoneAutocompleteChoices } from './nuke-timezones.js';

const nukeService = new NukeService();
const tenantRepository = new TenantRepository();

type PermissionCheckResult = {
  ok: boolean;
  error?: string;
};

function hasManageChannelAccess(interaction: ChatInputCommandInteraction): boolean {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) === true ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true
  );
}

function hasBotChannelPermissions(interaction: ChatInputCommandInteraction): boolean {
  return (
    interaction.appPermissions?.has(PermissionFlagsBits.ViewChannel) === true &&
    interaction.appPermissions?.has(PermissionFlagsBits.ManageChannels) === true
  );
}

function checkInteractionPermissions(interaction: ChatInputCommandInteraction): PermissionCheckResult {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.guild || !interaction.channel) {
    return {
      ok: false,
      error: 'This command can only be used inside a Discord server text channel.',
    };
  }

  if (
    interaction.channel.type !== ChannelType.GuildText &&
    interaction.channel.type !== ChannelType.GuildAnnouncement
  ) {
    return {
      ok: false,
      error: 'Nuke can only be used in server text or announcement channels.',
    };
  }

  if (!hasManageChannelAccess(interaction)) {
    return {
      ok: false,
      error: 'You need `Manage Channels` or `Administrator` permission to use this command.',
    };
  }

  if (!hasBotChannelPermissions(interaction)) {
    return {
      ok: false,
      error:
        'I am missing channel permissions. Required: View Channel, Manage Channels.',
    };
  }

  return { ok: true };
}

function isSuperAdminUser(discordUserId: string): boolean {
  return getEnv().superAdminDiscordIds.includes(discordUserId);
}

function getNukeCommandLockedMessage(authorizedUserCount: number): string {
  if (authorizedUserCount === 0) {
    return 'This nuke worker is locked for this server. A super admin must activate this server by granting your Discord ID access before you can use `/nuke` commands.';
  }

  return 'This nuke worker is active for this server, but your Discord ID is not on the `/nuke` allowlist. A super admin must grant your Discord ID access before you can use `/nuke` commands.';
}

function getSuperAdminOnlyAccessMessage(): string {
  return 'Only the configured super admin Discord ID can manage `/nuke` access.';
}

type NukeExecutionResult = {
  status: 'success' | 'partial' | 'duplicate';
  oldChannelId: string;
  newChannelId: string | null;
  oldChannelDeleted: boolean;
  message: string;
};

function buildNukeResultMessage(result: NukeExecutionResult): string {
  return [
    result.message,
    `Old Channel: \`${result.oldChannelId}\``,
    result.newChannelId ? `New Channel: \`${result.newChannelId}\`` : 'New Channel: (none)',
  ].join('\n');
}

export function buildScheduleStatusMessage(schedule: ChannelNukeScheduleSummary): string {
  return [
    'Current daily nuke schedule for this channel:',
    `Status: ${schedule.enabled ? 'Enabled' : 'Disabled'}`,
    `Time: ${schedule.localTimeHhMm}`,
    `Timezone: ${schedule.timezone}`,
    `Next run (UTC): ${schedule.nextRunAtUtc}`,
    `Last run (UTC): ${schedule.lastRunAtUtc ?? 'Never'}`,
    `Last local run date: ${schedule.lastLocalRunDate ?? 'Never'}`,
    `Consecutive failures: ${schedule.consecutiveFailures}`,
    `Schedule ID: \`${schedule.scheduleId}\``,
  ].join('\n');
}

export function buildAuthorizedUsersMessage(
  authorizedUsers: ChannelNukeAuthorizedUserSummary[],
): string {
  if (authorizedUsers.length === 0) {
    return [
      'This server is not activated for `/nuke` yet.',
      'When the list is empty, only users in `SUPER_ADMIN_DISCORD_IDS` can manage activation.',
      'Use `/nuke grant user:@someone` to activate this server for the first allowed user.',
    ].join('\n');
  }

  return [
    'Authorized `/nuke` users for this server:',
    ...authorizedUsers.map((user) => `<@${user.discordUserId}> (\`${user.discordUserId}\`)`),
    'Only listed users plus super admins can use `/nuke` in this server.',
  ].join('\n');
}

async function respondToTimezoneAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'timezone') {
    await interaction.respond([]);
    return;
  }

  await interaction.respond(getTimezoneAutocompleteChoices(String(focused.value ?? '')));
}

async function sendManualNukeCompletionNotice(
  interaction: ChatInputCommandInteraction,
  result: NukeExecutionResult,
): Promise<void> {
  if (!result.newChannelId) {
    return;
  }

  const content = [
    `<@${interaction.user.id}> ${result.message}`,
    `Old Channel: \`${result.oldChannelId}\``,
    result.newChannelId ? `New Channel: <#${result.newChannelId}>` : 'New Channel: (none)',
  ].join('\n');

  if (result.newChannelId) {
    try {
      const replacementChannel = await interaction.client.channels.fetch(result.newChannelId);
      if (replacementChannel?.isTextBased() && 'send' in replacementChannel) {
        await replacementChannel.send({ content });
        return;
      }
    } catch (error) {
      logger.warn(
        {
          err: error,
          guildId: interaction.guildId,
          oldChannelId: result.oldChannelId,
          newChannelId: result.newChannelId,
        },
        'failed to post nuke completion notice in replacement channel',
      );
    }
  }
}

export const nukeCommand = {
  data: new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Nuke this channel now or configure daily channel nuke schedule')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('schedule')
        .setDescription('Set daily nuke time for this channel')
        .addStringOption((option) =>
          option
            .setName('time')
            .setDescription('Daily time in HH:mm (24-hour) format')
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('timezone')
            .setDescription('IANA timezone (e.g., Europe/Berlin)')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('Show daily nuke schedule for this channel'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('authorized').setDescription('List Discord users allowed to use /nuke here'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('grant')
        .setDescription('Grant /nuke access to a Discord user for this server')
        .addUserOption((option) =>
          option.setName('user').setDescription('Discord user to authorize').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('revoke')
        .setDescription('Revoke /nuke access from a Discord user for this server')
        .addUserOption((option) =>
          option.setName('user').setDescription('Discord user to remove').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('disable').setDescription('Disable daily nuke schedule for this channel'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('now')
        .setDescription('Nuke this channel immediately')
        .addStringOption((option) =>
          option
            .setName('confirm')
            .setDescription('Type NUKE to confirm')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('delete')
        .setDescription('Delete this channel immediately without creating a replacement')
        .addStringOption((option) =>
          option
            .setName('confirm')
            .setDescription('Type DELETE to confirm permanent channel deletion')
            .setRequired(true),
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const permissionCheck = checkInteractionPermissions(interaction);
    if (!permissionCheck.ok) {
      await sendEphemeralReply(interaction, permissionCheck.error ?? 'Permission check failed.');
      return;
    }

    await deferEphemeralReply(interaction);

    try {
      const guildId = interaction.guildId as string;
      const channelId = interaction.channelId;
      const tenant = await tenantRepository.getTenantByGuildId(guildId);
      if (!tenant) {
        await sendEphemeralReply(interaction, 'This server is not linked to a tenant/workspace.');
        return;
      }

      const subcommand = interaction.options.getSubcommand(true);
      const isSuperAdmin = isSuperAdminUser(interaction.user.id);

      if (subcommand === 'authorized') {
        if (!isSuperAdmin) {
          await sendEphemeralReply(interaction, getSuperAdminOnlyAccessMessage());
          return;
        }

        const result = await nukeService.listAuthorizedUsers({
          tenantId: tenant.tenantId,
          guildId,
        });

        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        await sendEphemeralReply(interaction, buildAuthorizedUsersMessage(result.value));
        return;
      }

      if (subcommand === 'grant') {
        if (!isSuperAdmin) {
          await sendEphemeralReply(interaction, getSuperAdminOnlyAccessMessage());
          return;
        }

        const targetUser = interaction.options.getUser('user', true);
        const result = await nukeService.grantUserAccess({
          tenantId: tenant.tenantId,
          guildId,
          discordUserId: targetUser.id,
          grantedByDiscordUserId: interaction.user.id,
        });

        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        await sendEphemeralReply(
          interaction,
          result.value.created
            ? `Granted \`/nuke\` access for <@${targetUser.id}> in this server.`
            : `<@${targetUser.id}> already had \`/nuke\` access in this server.`,
        );
        return;
      }

      if (subcommand === 'revoke') {
        if (!isSuperAdmin) {
          await sendEphemeralReply(interaction, getSuperAdminOnlyAccessMessage());
          return;
        }

        const targetUser = interaction.options.getUser('user', true);
        const result = await nukeService.revokeUserAccess({
          tenantId: tenant.tenantId,
          guildId,
          discordUserId: targetUser.id,
        });

        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        await sendEphemeralReply(
          interaction,
          result.value.revoked
            ? `Revoked \`/nuke\` access for <@${targetUser.id}> in this server.`
            : `No extra \`/nuke\` access entry exists for <@${targetUser.id}> in this server.`,
        );
        return;
      }

      if (!isSuperAdmin) {
        const accessState = await nukeService.getCommandAccessState({
          tenantId: tenant.tenantId,
          guildId,
          discordUserId: interaction.user.id,
        });

        if (accessState.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(accessState.error));
          return;
        }

        if (accessState.value.locked && !accessState.value.allowed) {
          await sendEphemeralReply(
            interaction,
            getNukeCommandLockedMessage(accessState.value.authorizedUserCount),
          );
          return;
        }
      }

      if (subcommand === 'status') {
        const result = await nukeService.getChannelSchedule({
          tenantId: tenant.tenantId,
          guildId,
          channelId,
        });

        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        await sendEphemeralReply(
          interaction,
          result.value ? buildScheduleStatusMessage(result.value) : 'No daily nuke schedule exists for this channel.',
        );
        return;
      }

      if (subcommand === 'schedule') {
        const timeHhMm = interaction.options.getString('time', true);
        const timezone = interaction.options.getString('timezone', true);

        const result = await nukeService.setDailySchedule({
          tenantId: tenant.tenantId,
          guildId,
          channelId,
          timeHhMm,
          timezone,
          actorDiscordUserId: interaction.user.id,
        });

        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        await sendEphemeralReply(
          interaction,
          [
            'Daily nuke schedule saved for this channel.',
            `Time: ${result.value.localTimeHhMm}`,
            `Timezone: ${result.value.timezone}`,
            `Next run (UTC): ${result.value.nextRunAtUtc}`,
            `Schedule ID: \`${result.value.scheduleId}\``,
          ].join('\n'),
        );
        return;
      }

      if (subcommand === 'disable') {
        const result = await nukeService.disableSchedule({
          tenantId: tenant.tenantId,
          guildId,
          channelId,
          actorDiscordUserId: interaction.user.id,
        });

        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        await sendEphemeralReply(
          interaction,
          result.value.disabled
            ? 'Daily nuke schedule disabled for this channel.'
            : 'No nuke schedule exists for this channel.',
        );
        return;
      }

      if (subcommand === 'now') {
        const confirm = interaction.options.getString('confirm', true).trim();
        if (confirm !== 'NUKE') {
          await sendEphemeralReply(interaction, 'Confirmation failed. Use `confirm: NUKE` to proceed.');
          return;
        }

        await sendEphemeralReply(
          interaction,
          'Nuking this channel now. If it succeeds, I will post the result in the replacement channel.',
        );

        const result = await nukeService.runNukeNow({
          tenantId: tenant.tenantId,
          guildId,
          channelId,
          actorDiscordUserId: interaction.user.id,
          reason: 'manual',
          idempotencyKey: interaction.id,
        });

        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        if (result.value.oldChannelDeleted && result.value.newChannelId) {
          await sendManualNukeCompletionNotice(interaction, result.value);
          return;
        }

        await sendEphemeralReply(interaction, buildNukeResultMessage(result.value));
        return;
      }

      if (subcommand === 'delete') {
        const confirm = interaction.options.getString('confirm', true).trim();
        if (confirm !== 'DELETE') {
          await sendEphemeralReply(interaction, 'Confirmation failed. Use `confirm: DELETE` to proceed.');
          return;
        }

        await sendEphemeralReply(
          interaction,
          'Deleting this channel now without creating a replacement.',
        );

        const result = await nukeService.runDeleteNow({
          tenantId: tenant.tenantId,
          guildId,
          channelId,
          actorDiscordUserId: interaction.user.id,
          reason: 'manual',
          idempotencyKey: interaction.id,
        });

        if (result.isErr()) {
          await sendEphemeralReply(interaction, mapNukeError(result.error));
          return;
        }

        if (result.value.oldChannelDeleted && result.value.newChannelId) {
          await sendManualNukeCompletionNotice(interaction, result.value);
          return;
        }

        await sendEphemeralReply(interaction, buildNukeResultMessage(result.value));
        return;
      }

      await sendEphemeralReply(interaction, 'Unknown nuke subcommand.');
    } catch (error) {
      await sendEphemeralReply(interaction, mapNukeError(error));
    }
  },
  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await respondToTimezoneAutocomplete(interaction);
  },
};

export function startNukeScheduler(client: unknown, pollIntervalMs: number): void {
  nukeService.startSchedulerLoop(client, { pollIntervalMs });
}

const ACTIONABLE_INTERNAL_NUKE_CODES = new Set([
  'NUKE_BOT_TOKEN_MISSING',
  'NUKE_DISCORD_API_ERROR',
  'NUKE_DISCORD_NETWORK_ERROR',
]);

export function mapNukeError(error: unknown): string {
  if (error instanceof AppError) {
    if (ACTIONABLE_INTERNAL_NUKE_CODES.has(error.code)) {
      return error.message;
    }

    if (error.statusCode >= 500) {
      return 'Nuke command failed due to an internal worker error. Please try again and check logs.';
    }
    return error.message;
  }
  return 'Nuke command failed due to an internal worker error. Please try again and check logs.';
}

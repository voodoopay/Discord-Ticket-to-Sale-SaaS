import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
} from 'discord.js';
import {
  PaidOrderService,
  TenantRepository,
  buildPaidOrderFulfillmentCustomId,
  getPaidOrderFulfillmentButtonPresentation,
  parsePaidOrderFulfillmentCustomId,
} from '@voodoo/core';

import { hasConfiguredStaffAccess } from '../permissions/sale-permissions.js';

const paidOrderService = new PaidOrderService();
const tenantRepository = new TenantRepository();

function extractInteractionRoleIds(interaction: ButtonInteraction): string[] {
  const member = interaction.member;
  if (!member || typeof member !== 'object' || !('roles' in member)) {
    return [];
  }

  const roles = member.roles;
  if (Array.isArray(roles)) {
    return roles.filter((roleId): roleId is string => typeof roleId === 'string');
  }

  if (roles && typeof roles === 'object' && 'cache' in roles) {
    return [...roles.cache.keys()];
  }

  return [];
}

function buildFulfillmentButtonRow(input: {
  paidOrderId: string;
  fulfillmentStatus: 'needs_action' | 'fulfilled';
}): ActionRowBuilder<ButtonBuilder> {
  const presentation = getPaidOrderFulfillmentButtonPresentation(input.fulfillmentStatus);
  const style = presentation.apiStyle === 3 ? ButtonStyle.Success : ButtonStyle.Danger;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildPaidOrderFulfillmentCustomId(input.paidOrderId))
      .setLabel(presentation.label)
      .setStyle(style)
      .setDisabled(presentation.disabled),
  );
}

export async function handlePaidOrderFulfillment(interaction: ButtonInteraction): Promise<void> {
  const paidOrderId = parsePaidOrderFulfillmentCustomId(interaction.customId);
  if (!paidOrderId) {
    await interaction.reply({
      content: 'This paid-order action is invalid.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: 'This button can only be used inside a Discord server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const paidOrderResult = await paidOrderService.getPaidOrderByGuild({
    paidOrderId,
    guildId: interaction.guildId,
  });
  if (paidOrderResult.isErr()) {
    await interaction.reply({
      content: paidOrderResult.error.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const paidOrder = paidOrderResult.value;
  const guildConfig = await tenantRepository.getGuildConfig({
    tenantId: paidOrder.tenantId,
    guildId: interaction.guildId,
  });
  const hasStaffAccess = hasConfiguredStaffAccess({
    configuredRoleIds: guildConfig?.staffRoleIds ?? [],
    hasManageGuild: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true,
    hasAdministrator: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true,
    memberRoleIds: extractInteractionRoleIds(interaction),
  });

  if (!hasStaffAccess) {
    await interaction.reply({
      content: 'Only configured staff roles or server administrators can mark paid orders fulfilled.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const fulfilledResult = await paidOrderService.markPaidOrderFulfilled({
    paidOrderId,
    guildId: interaction.guildId,
    actorDiscordUserId: interaction.user.id,
  });
  if (fulfilledResult.isErr()) {
    await interaction.reply({
      content: fulfilledResult.error.message,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.update({
    components: [
      buildFulfillmentButtonRow({
        paidOrderId,
        fulfillmentStatus: fulfilledResult.value.fulfillmentStatus,
      }),
    ],
  });
}

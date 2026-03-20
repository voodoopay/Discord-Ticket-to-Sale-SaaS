import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
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
const FULFILLMENT_MESSAGE_MODAL_FIELD_ID = 'customerMessage';

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

function buildFulfillmentMessageModal(paidOrderId: string): ModalBuilder {
  const messageInput = new TextInputBuilder()
    .setCustomId(FULFILLMENT_MESSAGE_MODAL_FIELD_ID)
    .setLabel('Customer message (optional)')
    .setRequired(false)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1800)
    .setPlaceholder('Type any delivery info or completion message you want sent to the customer.');

  return new ModalBuilder()
    .setCustomId(`paid-order:fulfillment-modal:${paidOrderId}`)
    .setTitle('Complete Order')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(messageInput));
}

function buildFulfillmentReplyContent(input: {
  alreadyFulfilled: boolean;
  customerNotification: {
    attempted: boolean;
    delivered: boolean;
    target: 'discord_channel' | 'telegram_dm' | null;
    errorMessage: string | null;
  };
}): string {
  if (!input.customerNotification.attempted) {
    return input.alreadyFulfilled ? 'Order was already fulfilled.' : 'Order marked fulfilled.';
  }

  if (input.customerNotification.delivered) {
    const targetLabel =
      input.customerNotification.target === 'telegram_dm' ? 'Telegram DM' : 'the Discord sale channel';
    return input.alreadyFulfilled
      ? `Order was already fulfilled. Your customer message was sent to ${targetLabel}.`
      : `Order marked fulfilled. Your customer message was sent to ${targetLabel}.`;
  }

  return [
    input.alreadyFulfilled ? 'Order was already fulfilled.' : 'Order marked fulfilled.',
    `Customer message was not delivered: ${input.customerNotification.errorMessage ?? 'Unknown delivery error.'}`,
  ].join('\n');
}

async function handleFulfillmentModalSubmission(
  interaction: ModalSubmitInteraction,
  paidOrderId: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.editReply({
      content: 'This fulfillment form can only be used inside a Discord server.',
    });
    return;
  }

  const customerMessage = interaction.fields.getTextInputValue(FULFILLMENT_MESSAGE_MODAL_FIELD_ID);
  const fulfilledResult = await paidOrderService.completePaidOrderFulfillment({
    paidOrderId,
    guildId: interaction.guildId,
    actorDiscordUserId: interaction.user.id,
    customerMessage,
  });
  if (fulfilledResult.isErr()) {
    await interaction.editReply({
      content: fulfilledResult.error.message,
    });
    return;
  }

  const messageWithEdit = interaction as ModalSubmitInteraction & {
    message?: {
      edit: (payload: { components: Array<ActionRowBuilder<ButtonBuilder>> }) => Promise<unknown>;
    };
  };
  if (messageWithEdit.message) {
    await messageWithEdit.message.edit({
      components: [
        buildFulfillmentButtonRow({
          paidOrderId,
          fulfillmentStatus: fulfilledResult.value.fulfillmentStatus,
        }),
      ],
    });
  }

  await interaction.editReply({
    content: buildFulfillmentReplyContent({
      alreadyFulfilled: fulfilledResult.value.alreadyFulfilled,
      customerNotification: fulfilledResult.value.customerNotification,
    }),
  });
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

  await interaction.showModal(buildFulfillmentMessageModal(paidOrderId));

  try {
    const modalInteraction = await interaction.awaitModalSubmit({
      filter: (submittedInteraction) =>
        submittedInteraction.customId === `paid-order:fulfillment-modal:${paidOrderId}` &&
        submittedInteraction.user.id === interaction.user.id,
      time: 300_000,
    });

    await handleFulfillmentModalSubmission(modalInteraction, paidOrderId);
  } catch {
    // Modal close/timeouts do not need a follow-up. The order stays untouched until the form is submitted.
  }
}

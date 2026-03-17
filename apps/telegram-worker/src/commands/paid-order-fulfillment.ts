import {
  buildPaidOrderFulfillmentTelegramReplyMarkup,
  PaidOrderService,
  parsePaidOrderFulfillmentCustomId,
  toTelegramScopedId,
} from '@voodoo/core';
import type { Context } from 'grammy';

import { getLinkedStoreForChat, isTelegramChatAdmin } from '../lib/telegram.js';

const paidOrderService = new PaidOrderService();

export async function handlePaidOrderFulfillmentCallback(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
    return false;
  }

  const callbackData = ctx.callbackQuery.data;
  if (!callbackData) {
    return false;
  }

  const paidOrderId = parsePaidOrderFulfillmentCustomId(callbackData);
  if (!paidOrderId) {
    return false;
  }

  const linkedStore = await getLinkedStoreForChat(String(ctx.chat.id));
  if (!linkedStore) {
    await ctx.answerCallbackQuery({ text: 'This chat is not linked to a store.', show_alert: true });
    return true;
  }

  const isAdmin = await isTelegramChatAdmin(ctx.api, ctx.chat.id, ctx.from.id);
  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: 'Only Telegram chat admins can mark orders fulfilled.', show_alert: true });
    return true;
  }

  const fulfilled = await paidOrderService.markPaidOrderFulfilled({
    paidOrderId,
    guildId: linkedStore.guildId,
    actorDiscordUserId: toTelegramScopedId(String(ctx.from.id)),
  });
  if (fulfilled.isErr()) {
    await ctx.answerCallbackQuery({ text: fulfilled.error.message, show_alert: true });
    return true;
  }

  const messageId =
    'message' in ctx.callbackQuery && ctx.callbackQuery.message ? ctx.callbackQuery.message.message_id : null;
  if (messageId !== null) {
    await ctx.api.editMessageReplyMarkup(ctx.chat.id, messageId, {
      reply_markup: buildPaidOrderFulfillmentTelegramReplyMarkup({
        paidOrderId,
        fulfillmentStatus: fulfilled.value.fulfillmentStatus,
      }) as any,
    });
  }

  await ctx.answerCallbackQuery({
    text: fulfilled.value.alreadyFulfilled ? 'Order already fulfilled.' : 'Order marked fulfilled.',
  });
  return true;
}

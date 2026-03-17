import { PointsService } from '@voodoo/core';
import type { Context } from 'grammy';

import { getLinkedStoreForChat, parseCommandArgs } from '../lib/telegram.js';

const pointsService = new PointsService();
const pendingPointsLookups = new Map<string, { tenantId: string; guildId: string }>();

function getPendingPointsKey(chatId: number | string, userId: number): string {
  return `${chatId}:${userId}`;
}

async function replyWithPoints(input: {
  ctx: Context;
  tenantId: string;
  guildId: string;
  email: string;
}): Promise<void> {
  const balance = await pointsService.getBalanceByEmail({
    tenantId: input.tenantId,
    guildId: input.guildId,
    email: input.email,
  });

  if (balance.isErr()) {
    await input.ctx.reply(balance.error.message);
    return;
  }

  await input.ctx.reply(
    [
      `Points for ${balance.value.emailDisplay}`,
      `Balance: ${balance.value.balancePoints} point(s)`,
      `Reserved: ${balance.value.reservedPoints} point(s)`,
      `Available: ${balance.value.availablePoints} point(s)`,
    ].join('\n'),
  );
}

export async function handlePointsCommand(ctx: Context): Promise<void> {
  if (!ctx.chat || !ctx.from || !ctx.message || !('text' in ctx.message)) {
    return;
  }

  const linkedStore = await getLinkedStoreForChat(String(ctx.chat.id));
  if (!linkedStore) {
    await ctx.reply('This Telegram chat is not linked to a store yet.');
    return;
  }

  const commandText = ctx.message.text ?? '';
  const args = parseCommandArgs(commandText);
  const email = args[0]?.trim() ?? '';
  const pendingKey = getPendingPointsKey(ctx.chat.id, ctx.from.id);

  if (!email) {
    pendingPointsLookups.set(pendingKey, {
      tenantId: linkedStore.tenantId,
      guildId: linkedStore.guildId,
    });
    await ctx.reply('Send the customer email as your next message to check their points balance.');
    return;
  }

  pendingPointsLookups.delete(pendingKey);
  await replyWithPoints({
    ctx,
    tenantId: linkedStore.tenantId,
    guildId: linkedStore.guildId,
    email,
  });
}

export async function handlePendingPointsMessage(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !ctx.message || !('text' in ctx.message)) {
    return false;
  }

  const pendingKey = getPendingPointsKey(ctx.chat.id, ctx.from.id);
  const pending = pendingPointsLookups.get(pendingKey);
  if (!pending) {
    return false;
  }

  pendingPointsLookups.delete(pendingKey);
  const messageText = ctx.message.text?.trim() ?? '';
  await replyWithPoints({
    ctx,
    tenantId: pending.tenantId,
    guildId: pending.guildId,
    email: messageText,
  });
  return true;
}

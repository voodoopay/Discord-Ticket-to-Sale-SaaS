import { getEnv, TelegramLinkRepository, TenantRepository, verifyTelegramLinkToken } from '@voodoo/core';
import type { Context } from 'grammy';

import { isTelegramChatAdmin, isTelegramGroupChat, parseCommandArgs } from '../lib/telegram.js';

const env = getEnv();
const telegramLinkRepository = new TelegramLinkRepository();
const tenantRepository = new TenantRepository();

export async function handleConnectCommand(ctx: Context): Promise<void> {
  if (!ctx.chat || !ctx.from || !ctx.message || !('text' in ctx.message)) {
    return;
  }

  if (!isTelegramGroupChat(ctx.chat.type)) {
    await ctx.reply('Use `/connect <token>` inside the Telegram group you want to link.', {
      reply_parameters: {
        message_id: ctx.message.message_id,
      },
    });
    return;
  }

  const isAdmin = await isTelegramChatAdmin(ctx.api, ctx.chat.id, ctx.from.id);
  if (!isAdmin) {
    await ctx.reply('Only Telegram group admins can link this store.');
    return;
  }

  const commandText = ctx.message.text ?? '';
  const args = parseCommandArgs(commandText);
  const token = args[0];
  if (!token) {
    await ctx.reply('Missing link token. Generate a fresh Telegram link command in the dashboard first.');
    return;
  }

  const payload = verifyTelegramLinkToken(token, env.SESSION_SECRET);
  const linkedGuild = await tenantRepository.getTenantGuild({
    tenantId: payload.tenantId,
    guildId: payload.guildId,
  });
  if (!linkedGuild) {
    await ctx.reply('This token points to a Discord server that is no longer linked to the selected workspace.');
    return;
  }

  const config = await tenantRepository.getGuildConfig({
    tenantId: payload.tenantId,
    guildId: payload.guildId,
  });
  if (!config?.telegramEnabled) {
    await ctx.reply('Telegram is currently disabled for this server. Re-enable it in the dashboard first.');
    return;
  }

  await telegramLinkRepository.upsertLink({
    tenantId: payload.tenantId,
    guildId: payload.guildId,
    chatId: String(ctx.chat.id),
    chatTitle: 'title' in ctx.chat ? (ctx.chat.title?.trim() || String(ctx.chat.id)) : String(ctx.chat.id),
    linkedByDiscordUserId: null,
  });

  await ctx.reply(
    `Telegram group linked. This chat now uses the store config from Discord server "${linkedGuild.guildName}".`,
  );
}

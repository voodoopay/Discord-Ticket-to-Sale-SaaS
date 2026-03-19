import {
  getEnv,
  postMessageToDiscordChannel,
  ReferralService,
  TenantRepository,
  toTelegramScopedId,
} from '@voodoo/core';
import { InlineKeyboard, type Context } from 'grammy';

import {
  createTelegramPrivateHandoff,
  getTelegramPrivateHandoff,
  removeTelegramPrivateHandoff,
} from '../flows/private-handoff-store.js';
import {
  buildTelegramBotDeepLink,
  parseTelegramReferStartPayload,
} from '../lib/sale-links.js';
import { formatTelegramReferralSubmissionLog } from '../lib/referral-submission-log.js';
import {
  formatTelegramUserLabel,
  getLinkedStoreForChat,
  isTelegramGroupChat,
} from '../lib/telegram.js';

const env = getEnv();
const tenantRepository = new TenantRepository();
const referralService = new ReferralService();
const DEFAULT_REFERRAL_SUBMISSION_TEMPLATE =
  'Referral submitted successfully. We will reward points automatically after the first paid order.';

type PendingReferral =
  | {
      step: 'referrer_email';
      tenantId: string;
      guildId: string;
    }
  | {
      step: 'referred_email';
      tenantId: string;
      guildId: string;
      referrerEmail: string;
    };

const pendingReferrals = new Map<string, PendingReferral>();

function getReferralKey(chatId: number | string, userId: number): string {
  return `${chatId}:${userId}`;
}

function isTelegramPrivateChat(chatType: string | undefined): boolean {
  return chatType === 'private';
}

function renderSubmissionTemplate(input: {
  template: string | null | undefined;
  submitterLabel: string;
  referrerEmail: string;
  referredEmail: string;
}): string {
  const template =
    typeof input.template === 'string' && input.template.trim().length > 0
      ? input.template
      : DEFAULT_REFERRAL_SUBMISSION_TEMPLATE;

  const values: Record<string, string> = {
    submitter_mention: input.submitterLabel,
    referrer_email: input.referrerEmail,
    referred_email: input.referredEmail,
  };

  return template.replace(/\{([a-z_]+)\}/gi, (token, key: string) => values[key.toLowerCase()] ?? token);
}

function formatSubmissionOutcomeMessage(input: {
  status: 'accepted' | 'duplicate' | 'self_blocked';
  submitterLabel: string;
  successTemplate: string | null | undefined;
  referrerEmail: string;
  referredEmail: string;
}): string {
  if (input.status === 'accepted') {
    return renderSubmissionTemplate({
      template: input.successTemplate,
      submitterLabel: input.submitterLabel,
      referrerEmail: input.referrerEmail,
      referredEmail: input.referredEmail,
    });
  }

  if (input.status === 'duplicate') {
    return 'This customer email already has a referral claim on record. The first valid claim remains active.';
  }

  return 'Referral blocked: your email and the new customer email cannot be the same.';
}

async function postReferralSubmissionLog(input: {
  referralLogChannelId: string | null;
  submitterLabel: string;
  submitterTelegramUserId: string;
  guildId: string;
  referrerEmail: string;
  referredEmail: string;
  status: 'accepted' | 'duplicate' | 'self_blocked';
}): Promise<void> {
  if (!input.referralLogChannelId) {
    return;
  }

  await postMessageToDiscordChannel({
    botToken: env.DISCORD_TOKEN,
    channelId: input.referralLogChannelId,
    content: formatTelegramReferralSubmissionLog({
      submitterLabel: input.submitterLabel,
      submitterTelegramUserId: input.submitterTelegramUserId,
      guildId: input.guildId,
      referrerEmail: input.referrerEmail,
      referredEmail: input.referredEmail,
      status: input.status,
    }),
  });
}

export async function handleReferStartCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !isTelegramPrivateChat(ctx.chat.type)) {
    return false;
  }

  const payload =
    'match' in ctx && typeof (ctx as Context & { match?: unknown }).match === 'string'
      ? ((ctx as Context & { match?: string }).match ?? '').trim()
      : '';
  const handoffId = parseTelegramReferStartPayload(payload);
  if (!handoffId) {
    return false;
  }

  const handoff = getTelegramPrivateHandoff(handoffId);
  if (!handoff || handoff.kind !== 'refer') {
    await ctx.reply('This referral link expired. Run /refer again in the Telegram group.');
    return true;
  }

  if (handoff.requesterTelegramUserId !== toTelegramScopedId(String(ctx.from.id))) {
    await ctx.reply('This private referral link is only valid for the person who started it.');
    return true;
  }

  removeTelegramPrivateHandoff(handoff.id);
  pendingReferrals.set(getReferralKey(ctx.chat.id, ctx.from.id), {
    step: 'referrer_email',
    tenantId: handoff.tenantId,
    guildId: handoff.guildId,
  });

  await ctx.reply('Private referral started. Send your email as your next message.');
  return true;
}

export async function handleReferCommand(ctx: Context): Promise<void> {
  if (!ctx.chat || !ctx.from) {
    return;
  }

  if (isTelegramPrivateChat(ctx.chat.type)) {
    const pending = pendingReferrals.get(getReferralKey(ctx.chat.id, ctx.from.id));
    if (!pending) {
      await ctx.reply('Start /refer in a linked Telegram group first. The bot will then continue privately here.');
      return;
    }

    if (pending.step === 'referrer_email') {
      await ctx.reply('Send your email as your next message to begin the referral submission.');
      return;
    }

    await ctx.reply('Now send the new customer email as your next message.');
    return;
  }

  if (!isTelegramGroupChat(ctx.chat.type)) {
    await ctx.reply('Use /refer inside a linked Telegram group. The bot will continue in DM.');
    return;
  }

  const linkedStore = await getLinkedStoreForChat(String(ctx.chat.id));
  if (!linkedStore) {
    await ctx.reply('This Telegram chat is not linked to a store yet.');
    return;
  }

  const handoff = createTelegramPrivateHandoff({
    kind: 'refer',
    tenantId: linkedStore.tenantId,
    guildId: linkedStore.guildId,
    requesterTelegramUserId: toTelegramScopedId(String(ctx.from.id)),
    chatTitle: linkedStore.chatTitle,
  });

  let continueUrl: string;
  try {
    continueUrl = buildTelegramBotDeepLink(env.TELEGRAM_BOT_USERNAME, `refer_${handoff.id}`);
  } catch (error) {
    removeTelegramPrivateHandoff(handoff.id);
    await ctx.reply(error instanceof Error ? error.message : 'TELEGRAM_BOT_USERNAME is required for private referrals.');
    return;
  }

  await ctx.reply(
    'Referrals are handled in DM so only you can see the email addresses you submit.',
    {
      reply_markup: new InlineKeyboard().url('Continue in DM', continueUrl),
    },
  );
}

export async function handlePendingReferMessage(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !ctx.message || !('text' in ctx.message) || !isTelegramPrivateChat(ctx.chat.type)) {
    return false;
  }

  const pendingKey = getReferralKey(ctx.chat.id, ctx.from.id);
  const pending = pendingReferrals.get(pendingKey);
  if (!pending) {
    return false;
  }

  const text = ctx.message.text?.trim() ?? '';
  if (!text) {
    await ctx.reply('Email cannot be empty. Send it again.');
    return true;
  }

  if (pending.step === 'referrer_email') {
    pendingReferrals.set(pendingKey, {
      ...pending,
      step: 'referred_email',
      referrerEmail: text,
    });
    await ctx.reply('Now send the new customer email as your next message.');
    return true;
  }

  pendingReferrals.delete(pendingKey);

  const created = await referralService.createClaimFromCommand({
    tenantId: pending.tenantId,
    guildId: pending.guildId,
    referrerDiscordUserId: toTelegramScopedId(String(ctx.from.id)),
    referrerEmail: pending.referrerEmail,
    referredEmail: text,
  });

  if (created.isErr()) {
    await ctx.reply(created.error.message);
    return true;
  }

  const config = await tenantRepository.getGuildConfig({
    tenantId: pending.tenantId,
    guildId: pending.guildId,
  });
  const submitterLabel = formatTelegramUserLabel(ctx.from);
  const submitterTelegramUserId = toTelegramScopedId(String(ctx.from.id));
  const referrerEmail = pending.referrerEmail.trim();
  const referredEmail = text.trim();

  try {
    await postReferralSubmissionLog({
      referralLogChannelId: config?.referralLogChannelId ?? null,
      submitterLabel,
      submitterTelegramUserId,
      guildId: pending.guildId,
      referrerEmail,
      referredEmail,
      status: created.value.status,
    });
  } catch {
    // Do not fail the DM response if the merchant referral log channel post fails.
  }

  await ctx.reply(
    formatSubmissionOutcomeMessage({
      status: created.value.status,
      submitterLabel,
      successTemplate: config?.referralSubmissionTemplate,
      referrerEmail,
      referredEmail,
    }),
  );

  return true;
}

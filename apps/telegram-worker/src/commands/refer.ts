import { ReferralService, TenantRepository, toTelegramScopedId } from '@voodoo/core';
import type { Context } from 'grammy';

import {
  formatTelegramUserLabel,
  getLinkedStoreForChat,
} from '../lib/telegram.js';

const tenantRepository = new TenantRepository();
const referralService = new ReferralService();
const DEFAULT_REFERRAL_SUBMISSION_TEMPLATE =
  'Referral submitted successfully. We will reward points automatically after the first paid order.';

type PendingReferral =
  | {
      step: 'referrer_email';
      tenantId: string;
      guildId: string;
      chatTitle: string;
    }
  | {
      step: 'referred_email';
      tenantId: string;
      guildId: string;
      chatTitle: string;
      referrerEmail: string;
    };

const pendingReferrals = new Map<string, PendingReferral>();

function getReferralKey(chatId: number | string, userId: number): string {
  return `${chatId}:${userId}`;
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

function formatReferralSubmissionLog(input: {
  submitterLabel: string;
  chatTitle: string;
  referrerEmail: string;
  referredEmail: string;
  status: 'accepted' | 'duplicate' | 'self_blocked';
}): string {
  const safeReferrer = input.referrerEmail.replace(/`/g, "'");
  const safeReferred = input.referredEmail.replace(/`/g, "'");

  return [
    'Referral Submission',
    `Chat: ${input.chatTitle}`,
    `Submitter: ${input.submitterLabel}`,
    `Referrer Email: ${safeReferrer}`,
    `Referred Email: ${safeReferred}`,
    `Result: ${input.status}`,
  ].join('\n');
}

export async function handleReferCommand(ctx: Context): Promise<void> {
  if (!ctx.chat || !ctx.from) {
    return;
  }

  const linkedStore = await getLinkedStoreForChat(String(ctx.chat.id));
  if (!linkedStore) {
    await ctx.reply('This Telegram chat is not linked to a store yet.');
    return;
  }

  pendingReferrals.set(getReferralKey(ctx.chat.id, ctx.from.id), {
    step: 'referrer_email',
    tenantId: linkedStore.tenantId,
    guildId: linkedStore.guildId,
    chatTitle: linkedStore.chatTitle,
  });

  await ctx.reply('Send your email as your next message to begin the referral submission.');
}

export async function handlePendingReferMessage(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !ctx.message || !('text' in ctx.message)) {
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
  const referrerEmail = pending.referrerEmail.trim();
  const referredEmail = text.trim();

  await ctx.reply(
    formatSubmissionOutcomeMessage({
      status: created.value.status,
      submitterLabel,
      successTemplate: config?.referralSubmissionTemplate,
      referrerEmail,
      referredEmail,
    }),
  );

  await ctx.reply(
    formatReferralSubmissionLog({
      submitterLabel,
      chatTitle: pending.chatTitle,
      referrerEmail,
      referredEmail,
      status: created.value.status,
    }),
  );

  return true;
}

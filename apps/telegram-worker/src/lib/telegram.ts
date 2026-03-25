import { TelegramLinkRepository, TenantRepository, type TelegramChatLinkRecord } from '@voodoo/core';
import type { Api } from 'grammy';

const telegramLinkRepository = new TelegramLinkRepository();
const tenantRepository = new TenantRepository();

export type LinkedTelegramStore = TelegramChatLinkRecord;
export type TelegramCommandUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_bot?: boolean;
};
export type TelegramCommandEntity = {
  type: string;
  offset: number;
  length: number;
  user?: TelegramCommandUser;
};
export type TelegramSaleCustomerTarget = {
  label: string;
  id: number | null;
  usernameNormalized: string | null;
};

export function parseCommandArgs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const [, ...rest] = trimmed.split(/\s+/);
  return rest;
}

export function isTelegramGroupChat(chatType: string | undefined): boolean {
  return chatType === 'group' || chatType === 'supergroup';
}

export function normalizeTelegramUsername(input: string | null | undefined): string | null {
  const trimmed = input?.trim() ?? '';
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (!normalized || !/^[A-Za-z0-9_]+$/.test(normalized)) {
    return null;
  }

  return normalized.toLowerCase();
}

export function formatTelegramUserLabel(input: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): string {
  if (input.username) {
    return `@${input.username}`;
  }

  const fullName = [input.first_name, input.last_name].filter(Boolean).join(' ').trim();
  if (fullName) {
    return fullName;
  }

  return `Telegram user ${input.id}`;
}

function toTelegramSaleCustomerTarget(user: TelegramCommandUser): TelegramSaleCustomerTarget {
  return {
    label: formatTelegramUserLabel(user),
    id: user.id,
    usernameNormalized: normalizeTelegramUsername(user.username),
  };
}

function resolveMentionTarget(input: {
  text: string;
  entities?: TelegramCommandEntity[] | null;
}): TelegramSaleCustomerTarget | null {
  for (const entity of input.entities ?? []) {
    if (entity.type === 'text_mention' && entity.user && !entity.user.is_bot) {
      return toTelegramSaleCustomerTarget(entity.user);
    }

    if (entity.type !== 'mention') {
      continue;
    }

    const rawMention = input.text.slice(entity.offset, entity.offset + entity.length).trim();
    const usernameNormalized = normalizeTelegramUsername(rawMention);
    if (!usernameNormalized) {
      continue;
    }

    return {
      label: rawMention.startsWith('@') ? rawMention : `@${usernameNormalized}`,
      id: null,
      usernameNormalized,
    };
  }

  return null;
}

export function resolveTelegramSaleCustomer(input: {
  text: string;
  from: TelegramCommandUser;
  replyToUser?: TelegramCommandUser | null;
  entities?: TelegramCommandEntity[] | null;
}): TelegramSaleCustomerTarget {
  const mentionedCustomer = resolveMentionTarget({
    text: input.text,
    entities: input.entities,
  });
  if (mentionedCustomer) {
    return mentionedCustomer;
  }

  if (input.replyToUser && !input.replyToUser.is_bot) {
    return toTelegramSaleCustomerTarget(input.replyToUser);
  }

  return toTelegramSaleCustomerTarget(input.from);
}

export function canTelegramUserAccessSaleDraft(input: {
  expectedUserId: string | null;
  expectedUsernameNormalized: string | null;
  actualUserId: string;
  actualUsername?: string | null;
}): boolean {
  if (input.expectedUserId && input.expectedUserId === input.actualUserId) {
    return true;
  }

  const actualUsernameNormalized = normalizeTelegramUsername(input.actualUsername);
  return Boolean(
    input.expectedUsernameNormalized &&
      actualUsernameNormalized &&
      input.expectedUsernameNormalized === actualUsernameNormalized,
  );
}

export async function getLinkedStoreForChat(chatId: string): Promise<LinkedTelegramStore | null> {
  const linkedStore = await telegramLinkRepository.getByChatId(chatId);
  if (!linkedStore) {
    return null;
  }

  const config = await tenantRepository.getGuildConfig({
    tenantId: linkedStore.tenantId,
    guildId: linkedStore.guildId,
  });
  if (!config?.telegramEnabled) {
    return null;
  }

  return linkedStore;
}

export async function isTelegramChatAdmin(
  api: Api,
  chatId: number | string,
  userId: number,
): Promise<boolean> {
  const member = await api.getChatMember(chatId, userId);
  return member.status === 'administrator' || member.status === 'creator';
}

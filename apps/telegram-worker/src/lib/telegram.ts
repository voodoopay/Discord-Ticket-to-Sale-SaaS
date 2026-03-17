import { TelegramLinkRepository, type TelegramChatLinkRecord } from '@voodoo/core';
import type { Api } from 'grammy';

const telegramLinkRepository = new TelegramLinkRepository();

export type LinkedTelegramStore = TelegramChatLinkRecord;

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

export async function getLinkedStoreForChat(chatId: string): Promise<LinkedTelegramStore | null> {
  return telegramLinkRepository.getByChatId(chatId);
}

export async function isTelegramChatAdmin(
  api: Api,
  chatId: number | string,
  userId: number,
): Promise<boolean> {
  const member = await api.getChatMember(chatId, userId);
  return member.status === 'administrator' || member.status === 'creator';
}

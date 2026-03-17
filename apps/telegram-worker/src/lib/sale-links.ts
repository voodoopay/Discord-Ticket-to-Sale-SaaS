export type TelegramCheckoutMethod = 'pay' | 'crypto';

export function normalizeTelegramBotUsername(value: string): string | null {
  const normalized = value.trim().replace(/^@+/u, '');
  return normalized.length > 0 ? normalized : null;
}

export function buildTelegramBotDeepLink(botUsername: string, startPayload: string): string {
  const normalizedBotUsername = normalizeTelegramBotUsername(botUsername);
  if (!normalizedBotUsername) {
    throw new Error('TELEGRAM_BOT_USERNAME is required for Telegram DM sale handoff.');
  }

  const url = new URL(`https://t.me/${normalizedBotUsername}`);
  url.searchParams.set('start', startPayload);
  return url.toString();
}

export function buildTelegramCheckoutRedirectUrl(input: {
  botPublicUrl: string;
  orderSessionId: string;
  method: TelegramCheckoutMethod;
}): string {
  const url = new URL(`/checkout/${input.orderSessionId}`, input.botPublicUrl);
  if (input.method === 'crypto') {
    url.searchParams.set('method', 'crypto');
  }

  return url.toString();
}

export function parseTelegramSaleStartPayload(payload: string): string | null {
  const normalized = payload.trim();
  if (!normalized.startsWith('sale_')) {
    return null;
  }

  const draftId = normalized.slice('sale_'.length).trim();
  return /^[a-f0-9]{16}$/u.test(draftId) ? draftId : null;
}

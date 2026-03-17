import { describe, expect, it } from 'vitest';

import {
  buildTelegramBotDeepLink,
  buildTelegramCheckoutRedirectUrl,
  normalizeTelegramBotUsername,
  parseTelegramSaleStartPayload,
} from './sale-links.js';

describe('sale-links', () => {
  it('normalizes Telegram bot usernames with or without a leading at-sign', () => {
    expect(normalizeTelegramBotUsername('@voodoopay_bot')).toBe('voodoopay_bot');
    expect(normalizeTelegramBotUsername('voodoopay_bot')).toBe('voodoopay_bot');
  });

  it('builds a Telegram deep link for DM handoff', () => {
    expect(buildTelegramBotDeepLink('@voodoopay_bot', 'sale_deadbeefdeadbeef')).toBe(
      'https://t.me/voodoopay_bot?start=sale_deadbeefdeadbeef',
    );
  });

  it('builds a short redirect URL for Telegram crypto checkout buttons', () => {
    expect(
      buildTelegramCheckoutRedirectUrl({
        botPublicUrl: 'https://voodoopaybot.online',
        orderSessionId: '01ABC',
        method: 'crypto',
      }),
    ).toBe('https://voodoopaybot.online/checkout/01ABC?method=crypto');
  });

  it('parses a sale deep-link payload and rejects unrelated values', () => {
    expect(parseTelegramSaleStartPayload('sale_deadbeefdeadbeef')).toBe('deadbeefdeadbeef');
    expect(parseTelegramSaleStartPayload('connect_deadbeefdeadbeef')).toBeNull();
  });
});

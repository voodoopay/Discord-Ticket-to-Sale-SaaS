import { describe, expect, it } from 'vitest';

import { buildPaidOrderFulfillmentTelegramReplyMarkup } from '../src/services/paid-order-service.js';
import { signTelegramLinkToken, verifyTelegramLinkToken } from '../src/security/telegram-link-token.js';
import { formatUserReference, parsePlatformScopedId, toTelegramScopedId } from '../src/utils/platform-ids.js';

describe('Telegram helpers', () => {
  it('signs and verifies Telegram link tokens', () => {
    const token = signTelegramLinkToken(
      {
        tenantId: 'tenant_1',
        guildId: 'guild_1',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'super-secret',
    );

    expect(verifyTelegramLinkToken(token, 'super-secret')).toEqual({
      tenantId: 'tenant_1',
      guildId: 'guild_1',
      exp: expect.any(Number),
    });
  });

  it('parses Telegram-scoped ids and formats user references', () => {
    const scopedId = toTelegramScopedId('123456');

    expect(parsePlatformScopedId(scopedId)).toEqual({
      platform: 'telegram',
      rawId: '123456',
    });
    expect(formatUserReference(scopedId)).toBe('Telegram user 123456');
    expect(formatUserReference('987654321')).toBe('<@987654321>');
  });

  it('parses Discord-scoped ids after trimming whitespace', () => {
    expect(parsePlatformScopedId('  dc:555666777  ')).toEqual({
      platform: 'discord',
      rawId: '555666777',
    });
    expect(formatUserReference('dc:555666777')).toBe('<@555666777>');
  });

  it('builds Telegram fulfillment inline keyboards', () => {
    expect(
      buildPaidOrderFulfillmentTelegramReplyMarkup({
        paidOrderId: 'paid_123',
        fulfillmentStatus: 'needs_action',
      }),
    ).toEqual({
      inline_keyboard: [[{ text: 'Need Actioned', callback_data: 'paid-order:fulfillment:paid_123' }]],
    });
  });
});

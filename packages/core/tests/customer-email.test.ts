import { describe, expect, it } from 'vitest';

import {
  isInternalPlaceholderCustomerEmail,
  resolveOrderSessionCustomerEmail,
} from '../src/utils/customer-email.js';

describe('customer email utilities', () => {
  it('treats legacy Telegram placeholder emails as non-customer emails', () => {
    expect(isInternalPlaceholderCustomerEmail('discord@voodoo-services.com')).toBe(true);
    expect(
      resolveOrderSessionCustomerEmail({
        customerEmailNormalized: 'discord@voodoo-services.com',
        customerDiscordId: 'tg:7694095003',
        ticketChannelId: 'tg:-1003848597553',
      } as const),
    ).toBeNull();
  });

  it('treats current generated fallback emails as non-customer emails for Telegram orders', () => {
    expect(isInternalPlaceholderCustomerEmail('discord-7694095003@voodoopaybot.online')).toBe(true);
    expect(
      resolveOrderSessionCustomerEmail({
        customerEmailNormalized: 'discord-7694095003@voodoopaybot.online',
        customerDiscordId: 'tg:7694095003',
        ticketChannelId: 'tg:-1003848597553',
      } as const),
    ).toBeNull();
  });

  it('keeps real customer emails intact', () => {
    expect(
      resolveOrderSessionCustomerEmail({
        customerEmailNormalized: 'customer@example.com',
        customerDiscordId: 'tg:7694095003',
        ticketChannelId: 'tg:-1003848597553',
      } as const),
    ).toBe('customer@example.com');
  });
});

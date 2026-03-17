import { describe, expect, it } from 'vitest';

import { parseCheckoutRedirectMethod, resolveCheckoutRedirectUrl } from './checkout-redirect.js';

describe('checkout-redirect', () => {
  it('defaults to pay when no redirect method is provided', () => {
    expect(parseCheckoutRedirectMethod(null)).toBe('pay');
  });

  it('selects the crypto checkout URL when requested', () => {
    expect(
      resolveCheckoutRedirectUrl({
        method: 'crypto',
        checkoutUrl: 'https://example.com/pay',
        checkoutUrlCrypto: 'https://example.com/crypto',
      }),
    ).toBe('https://example.com/crypto');
  });

  it('selects the standard checkout URL for pay mode', () => {
    expect(
      resolveCheckoutRedirectUrl({
        method: 'pay',
        checkoutUrl: 'https://example.com/pay',
        checkoutUrlCrypto: 'https://example.com/crypto',
      }),
    ).toBe('https://example.com/pay');
  });
});

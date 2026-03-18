import { describe, expect, it } from 'vitest';

import { buildTelegramCheckoutButtonLabel } from './checkout-links.js';

describe('telegram checkout links', () => {
  it('uses a clear single-button label for one checkout option', () => {
    expect(
      buildTelegramCheckoutButtonLabel({
        label: 'Pay',
        index: 0,
        total: 1,
      }),
    ).toBe('Open Checkout');
  });

  it('keeps explicit labels when multiple checkout options exist', () => {
    expect(
      buildTelegramCheckoutButtonLabel({
        label: 'Pay with Crypto',
        index: 1,
        total: 2,
      }),
    ).toBe('Pay with Crypto');
  });
});

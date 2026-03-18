import { describe, expect, it } from 'vitest';

import {
  buildTelegramCheckoutButtonLabel,
  buildTelegramCheckoutLinkFiles,
} from './checkout-links.js';

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

  it('builds an exact one-line checkout link file for a normal pay URL', () => {
    expect(
      buildTelegramCheckoutLinkFiles([
        {
          method: 'pay',
          label: 'Pay',
          url: 'https://checkout.voodoo-pay.uk/pay.php?vd_token=abc123',
        },
      ]),
    ).toEqual([
      {
        label: 'Pay',
        text: 'https://checkout.voodoo-pay.uk/pay.php?vd_token=abc123\n',
        fileName: 'pay-checkout-link.txt',
        caption:
          'Pay exact checkout link. Open this file, copy the single URL inside it, and paste it into Chrome or Safari.',
      },
    ]);
  });

  it('builds an exact one-line checkout link file for a long crypto URL', () => {
    const longUrl = `https://checkout.voodoo-pay.uk/crypto/hosted.php?payment_token=${'x'.repeat(5000)}`;

    expect(
      buildTelegramCheckoutLinkFiles([
        {
          method: 'crypto',
          label: 'Pay with Crypto',
          url: longUrl,
        },
      ]),
    ).toEqual([
      {
        label: 'Pay with Crypto',
        text: `${longUrl}\n`,
        fileName: 'pay-with-crypto-checkout-link.txt',
        caption:
          'Pay with Crypto exact checkout link. Open this file, copy the single URL inside it, and paste it into Chrome or Safari.',
      },
    ]);
  });
});

import { STANDARD_CHECKOUT_OPTION_LABEL } from '@voodoo/core';
import { describe, expect, it } from 'vitest';

import { buildCheckoutLinkLines } from './sale-flow.js';

describe('sale flow checkout links', () => {
  it('uses the expanded standard payment label when multiple checkout options exist', () => {
    expect(
      buildCheckoutLinkLines({
        checkoutUrl: 'https://checkout.example.com/pay',
        checkoutOptions: [
          {
            method: 'pay',
            label: STANDARD_CHECKOUT_OPTION_LABEL,
            url: 'https://checkout.example.com/pay',
          },
          {
            method: 'crypto',
            label: 'Pay with Crypto',
            url: 'https://checkout.example.com/crypto',
          },
        ],
      }),
    ).toEqual([
      '- [Pay via Revolut/Visa/Mastercard/Bank](<https://checkout.example.com/pay>)',
      '- [Pay with Crypto](<https://checkout.example.com/crypto>)',
    ]);
  });

  it('keeps the single-link shortcut copy for one checkout option', () => {
    expect(
      buildCheckoutLinkLines({
        checkoutUrl: 'https://checkout.example.com/pay',
      }),
    ).toEqual(['[Click Here To Pay](<https://checkout.example.com/pay>)']);
  });
});

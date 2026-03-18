import { describe, expect, it } from 'vitest';

import { buildVoodooPayHostedCryptoCheckoutUrl } from '../src/services/sale-service.js';

describe('buildVoodooPayHostedCryptoCheckoutUrl', () => {
  it('preserves provider-issued percent encoding inside payment tokens', () => {
    const url = buildVoodooPayHostedCryptoCheckoutUrl({
      checkoutDomain: 'checkout.voodoo-pay.uk',
      paymentToken: 'abc%2Fdef%3Dghi',
      addFees: true,
    });

    expect(url).toBe(
      'https://checkout.voodoo-pay.uk/crypto/hosted.php?payment_token=abc%2Fdef%3Dghi&add_fees=1',
    );
    expect(url).not.toContain('%252F');
    expect(url).not.toContain('%253D');
  });
});

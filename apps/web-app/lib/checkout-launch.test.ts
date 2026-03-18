import { describe, expect, it } from 'vitest';

import { buildAndroidIntentUrl } from './checkout-launch';

describe('checkout-launch', () => {
  it('builds an Android intent URL that preserves the full checkout target', () => {
    expect(
      buildAndroidIntentUrl('https://checkout.voodoo-pay.uk/crypto/hosted.php?payment_token=abc%2Bdef%2Fghi&add_fees=1'),
    ).toBe(
      'intent://checkout.voodoo-pay.uk/crypto/hosted.php?payment_token=abc%2Bdef%2Fghi&add_fees=1#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=https%3A%2F%2Fcheckout.voodoo-pay.uk%2Fcrypto%2Fhosted.php%3Fpayment_token%3Dabc%252Bdef%252Fghi%26add_fees%3D1;end',
    );
  });
});

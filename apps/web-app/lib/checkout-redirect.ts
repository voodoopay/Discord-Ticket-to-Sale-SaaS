export type CheckoutRedirectMethod = 'pay' | 'crypto';

export function parseCheckoutRedirectMethod(value: string | null): CheckoutRedirectMethod {
  return value === 'crypto' ? 'crypto' : 'pay';
}

export function resolveCheckoutRedirectUrl(input: {
  method: CheckoutRedirectMethod;
  checkoutUrl: string | null;
  checkoutUrlCrypto: string | null;
}): string | null {
  return input.method === 'crypto' ? input.checkoutUrlCrypto : input.checkoutUrl;
}

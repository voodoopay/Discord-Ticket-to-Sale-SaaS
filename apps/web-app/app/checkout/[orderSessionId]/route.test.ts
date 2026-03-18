import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrderSessionById } = vi.hoisted(() => ({
  getOrderSessionById: vi.fn(),
}));

vi.mock('@voodoo/core', () => {
  class AppError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    public constructor(code: string, message: string, statusCode: number) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  }

  return {
    AppError,
    OrderRepository: class {
      public getOrderSessionById = getOrderSessionById;
    },
  };
});

import { GET, POST } from './route';

describe('checkout redirect route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a single redirect to the standard checkout URL', async () => {
    getOrderSessionById.mockResolvedValue({
      checkoutTokenExpiresAt: new Date(Date.now() + 60_000),
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.voodoo-pay.uk/pay.php?vd_token=pay-token',
      checkoutUrlCrypto: 'https://checkout.voodoo-pay.uk/crypto/hosted.php?payment_token=crypto-token',
    });

    const response = await GET(new NextRequest('https://voodoopaybot.online/checkout/01ABC'), {
      params: Promise.resolve({ orderSessionId: '01ABC' }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://checkout.voodoo-pay.uk/pay.php?vd_token=pay-token');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('renders a Telegram handoff page instead of immediately launching checkout', async () => {
    getOrderSessionById.mockResolvedValue({
      checkoutTokenExpiresAt: new Date(Date.now() + 60_000),
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.voodoo-pay.uk/pay.php?vd_token=pay-token',
      checkoutUrlCrypto: 'https://checkout.voodoo-pay.uk/crypto/hosted.php?payment_token=crypto-token',
    });

    const response = await GET(
      new NextRequest('https://voodoopaybot.online/checkout/01ABC?source=telegram&method=crypto'),
      {
        params: Promise.resolve({ orderSessionId: '01ABC' }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Continue to Crypto Checkout');
  });

  it('launches the crypto checkout URL with a GET-friendly redirect when the Telegram handoff form is submitted', async () => {
    getOrderSessionById.mockResolvedValue({
      checkoutTokenExpiresAt: new Date(Date.now() + 60_000),
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.voodoo-pay.uk/pay.php?vd_token=pay-token',
      checkoutUrlCrypto: 'https://checkout.voodoo-pay.uk/crypto/hosted.php?payment_token=crypto-token',
    });

    const response = await POST(
      new NextRequest('https://voodoopaybot.online/checkout/01ABC?source=telegram&method=crypto', {
        method: 'POST',
      }),
      {
        params: Promise.resolve({ orderSessionId: '01ABC' }),
      },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://checkout.voodoo-pay.uk/crypto/hosted.php?payment_token=crypto-token',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

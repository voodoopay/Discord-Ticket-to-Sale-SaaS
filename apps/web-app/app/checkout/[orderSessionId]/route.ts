import { AppError, OrderRepository } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { parseCheckoutRedirectMethod, resolveCheckoutRedirectUrl } from '@/lib/checkout-redirect';

const orderRepository = new OrderRepository();

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orderSessionId: string }> },
): Promise<NextResponse> {
  try {
    const { orderSessionId } = await context.params;
    const session = await orderRepository.getOrderSessionById(orderSessionId);
    if (!session) {
      return NextResponse.json({ error: 'Order session not found' }, { status: 404 });
    }

    if (session.checkoutTokenExpiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: 'Checkout session expired' }, { status: 410 });
    }

    if (session.status !== 'pending_payment') {
      return NextResponse.json({ error: `Order session is ${session.status}` }, { status: 409 });
    }

    const method = parseCheckoutRedirectMethod(request.nextUrl.searchParams.get('method'));
    const targetUrl = resolveCheckoutRedirectUrl({
      method,
      checkoutUrl: session.checkoutUrl,
      checkoutUrlCrypto: session.checkoutUrlCrypto,
    });

    if (!targetUrl) {
      return NextResponse.json({ error: 'Checkout URL unavailable for this session' }, { status: 404 });
    }

    const safeUrl = escapeHtml(targetUrl);
    const jsUrl = JSON.stringify(targetUrl);
    const html = [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      `  <meta http-equiv="refresh" content="0;url=${safeUrl}" />`,
      '  <title>Redirecting to Checkout</title>',
      '</head>',
      '<body>',
      '  <p>Redirecting to checkout...</p>',
      `  <p>If nothing happens, <a href="${safeUrl}" rel="noreferrer">continue here</a>.</p>`,
      `  <script>window.location.replace(${jsUrl});</script>`,
      '</body>',
      '</html>',
    ].join('\n');

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

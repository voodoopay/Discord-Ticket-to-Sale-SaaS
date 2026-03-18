import { AppError, OrderRepository } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { parseCheckoutRedirectMethod, resolveCheckoutRedirectUrl } from '../../../lib/checkout-redirect';

const orderRepository = new OrderRepository();

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildTelegramLaunchPage(input: {
  actionUrl: string;
  buttonLabel: string;
  heading: string;
}): string {
  const safeActionUrl = escapeHtml(input.actionUrl);
  const safeButtonLabel = escapeHtml(input.buttonLabel);
  const safeHeading = escapeHtml(input.heading);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>Continue to Checkout</title>',
    '  <style>',
    '    :root { color-scheme: dark; }',
    '    body { margin: 0; font-family: system-ui, sans-serif; background: #0b1217; color: #f4f7fb; }',
    '    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }',
    '    section { width: min(100%, 420px); background: #121c23; border: 1px solid #21303b; border-radius: 20px; padding: 24px; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.24); }',
    '    h1 { margin: 0 0 12px; font-size: 1.4rem; line-height: 1.2; }',
    '    p { margin: 0 0 20px; color: #b7c3ce; line-height: 1.5; }',
    '    button { width: 100%; border: 0; border-radius: 14px; padding: 16px; font: inherit; font-weight: 700; background: #12c8df; color: #04151d; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    '    <section>',
    `      <h1>${safeHeading}</h1>`,
    '      <p>Telegram may pre-open checkout links. Tap once below to launch the live checkout session.</p>',
    `      <form method="post" action="${safeActionUrl}">`,
    `        <button type="submit">${safeButtonLabel}</button>`,
    '      </form>',
    '    </section>',
    '  </main>',
    '</body>',
    '</html>',
  ].join('\n');
}

async function resolveCheckoutTarget(
  request: NextRequest,
  context: { params: Promise<{ orderSessionId: string }> },
): Promise<{ method: 'pay' | 'crypto'; orderSessionId: string; targetUrl: string }> {
  const { orderSessionId } = await context.params;
  const session = await orderRepository.getOrderSessionById(orderSessionId);
  if (!session) {
    throw new AppError('ORDER_SESSION_NOT_FOUND', 'Order session not found', 404);
  }

  if (session.checkoutTokenExpiresAt.getTime() < Date.now()) {
    throw new AppError('CHECKOUT_SESSION_EXPIRED', 'Checkout session expired', 410);
  }

  if (session.status !== 'pending_payment') {
    throw new AppError('ORDER_SESSION_NOT_PENDING', `Order session is ${session.status}`, 409);
  }

  const method = parseCheckoutRedirectMethod(request.nextUrl.searchParams.get('method'));
  const targetUrl = resolveCheckoutRedirectUrl({
    method,
    checkoutUrl: session.checkoutUrl,
    checkoutUrlCrypto: session.checkoutUrlCrypto,
  });

  if (!targetUrl) {
    throw new AppError('CHECKOUT_URL_UNAVAILABLE', 'Checkout URL unavailable for this session', 404);
  }

  return { method, orderSessionId, targetUrl };
}

function handleRouteError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
}

function buildLaunchActionUrl(request: NextRequest): string {
  const query = request.nextUrl.searchParams.toString();
  return query.length > 0 ? `${request.nextUrl.pathname}?${query}` : request.nextUrl.pathname;
}

function buildCheckoutRedirectResponse(targetUrl: string, status = 307): NextResponse {
  return NextResponse.redirect(targetUrl, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orderSessionId: string }> },
): Promise<NextResponse> {
  try {
    const { method, targetUrl } = await resolveCheckoutTarget(request, context);

    if (request.nextUrl.searchParams.get('source') !== 'telegram') {
      return buildCheckoutRedirectResponse(targetUrl);
    }

    const html = buildTelegramLaunchPage({
      actionUrl: buildLaunchActionUrl(request),
      buttonLabel: method === 'crypto' ? 'Continue to Crypto Checkout' : 'Continue to Checkout',
      heading: method === 'crypto' ? 'Crypto Checkout Ready' : 'Checkout Ready',
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orderSessionId: string }> },
): Promise<NextResponse> {
  try {
    const { targetUrl } = await resolveCheckoutTarget(request, context);
    return buildCheckoutRedirectResponse(targetUrl, 303);
  } catch (error) {
    return handleRouteError(error);
  }
}

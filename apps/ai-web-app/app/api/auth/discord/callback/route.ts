import { AppError, AuthService, getEnv, logger } from '../../../../../../../packages/core/dist/index.js';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const authService = new AuthService();
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function firstHeaderValue(value: string | null): string {
  if (!value) {
    return '';
  }

  return value.split(',')[0]?.trim() ?? '';
}

function toHostname(hostWithPort: string): string {
  if (!hostWithPort) {
    return '';
  }

  try {
    return new URL(`http://${hostWithPort}`).hostname;
  } catch {
    return hostWithPort;
  }
}

function isLocalHost(hostWithPort: string): boolean {
  return LOCAL_HOSTNAMES.has(toHostname(hostWithPort).toLowerCase());
}

function resolveAiPublicOrigin(request: NextRequest): string {
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  if (forwardedHost && forwardedProto && !isLocalHost(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const requestHost = firstHeaderValue(request.headers.get('host')) || request.nextUrl.host;
  const requestProto = forwardedProto || request.nextUrl.protocol.replace(':', '');
  if (requestHost && !isLocalHost(requestHost)) {
    return `${requestProto}://${requestHost}`;
  }

  const configuredOrigin = new URL(getEnv().AI_WEB_PUBLIC_URL).origin;
  if (!isLocalHost(new URL(configuredOrigin).host)) {
    return configuredOrigin;
  }

  return request.nextUrl.origin;
}

function jsonError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode });
  }

  return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const code = request.nextUrl.searchParams.get('code');
    const state = request.nextUrl.searchParams.get('state');
    const expectedState = request.cookies.get('vd_oauth_state')?.value ?? '';
    const publicOrigin = resolveAiPublicOrigin(request);
    const redirectUri =
      request.cookies.get('vd_oauth_redirect_uri')?.value ??
      new URL('/api/auth/discord/callback', publicOrigin).toString();

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code/state' }, { status: 400 });
    }

    const result = await authService.exchangeCodeForSession({
      code,
      state,
      expectedState,
      redirectUri,
    });

    if (result.isErr()) {
      const failure = result.error;

      logger.warn(
        { code: failure.code, statusCode: failure.statusCode },
        'ai web app discord oauth callback failed',
      );

      const failureUrl = new URL('/dashboard', publicOrigin);
      failureUrl.searchParams.set('authError', failure.message);

      const response = NextResponse.redirect(failureUrl);
      response.cookies.delete('vd_oauth_state');
      response.cookies.delete('vd_oauth_redirect_uri');
      return response;
    }

    const response = NextResponse.redirect(new URL('/dashboard', publicOrigin));
    response.cookies.set('vd_session', result.value.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 12,
      path: '/',
    });
    response.cookies.set('vd_discord_access_token', result.value.discordAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 12,
      path: '/',
    });
    response.cookies.delete('vd_oauth_state');
    response.cookies.delete('vd_oauth_redirect_uri');

    return response;
  } catch (error) {
    return jsonError(error);
  }
}

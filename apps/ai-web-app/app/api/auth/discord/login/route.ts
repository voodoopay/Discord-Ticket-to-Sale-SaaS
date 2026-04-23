import crypto from 'node:crypto';

import { AuthService, getEnv } from '../../../../../../../packages/core/dist/index.js';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function createAiAuthService(): AuthService {
  const env = getEnv();

  return new AuthService({
    discordClientId: env.AI_DISCORD_CLIENT_ID,
    discordClientSecret: env.AI_DISCORD_CLIENT_SECRET,
    discordRedirectUri: env.AI_DISCORD_REDIRECT_URI,
  });
}

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const state = crypto.randomUUID();
  const publicOrigin = resolveAiPublicOrigin(request);
  const redirectUri = new URL('/api/auth/discord/callback', publicOrigin).toString();
  const authService = createAiAuthService();
  const loginUrl = authService.buildLoginUrl(state, redirectUri);

  const response = NextResponse.redirect(loginUrl);
  response.cookies.set('vd_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
  });
  response.cookies.set('vd_oauth_redirect_uri', redirectUri, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/',
  });

  return response;
}

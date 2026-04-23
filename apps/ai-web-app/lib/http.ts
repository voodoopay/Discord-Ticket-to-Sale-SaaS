import { AppError, AuthService, type SessionPayload } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const authService = new AuthService();

export async function requireSession(
  request: NextRequest,
): Promise<{ ok: true; session: SessionPayload } | { ok: false; response: NextResponse }> {
  const token = request.cookies.get('vd_session')?.value;
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    };
  }

  const session = await authService.getSession(token);
  if (session.isErr()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: session.error.message, code: session.error.code },
        { status: session.error.statusCode },
      ),
    };
  }

  return {
    ok: true,
    session: session.value,
  };
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details ?? null },
      { status: error.statusCode },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
}

export async function readJson<T>(request: NextRequest): Promise<T> {
  return (await request.json()) as T;
}

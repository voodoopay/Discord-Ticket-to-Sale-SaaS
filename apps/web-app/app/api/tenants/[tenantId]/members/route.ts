import { TenantService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, readJson, requireSession } from '@/lib/http';

const tenantService = new TenantService();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const { tenantId } = await context.params;
    const result = await tenantService.listTenantMembers(auth.session, { tenantId });
    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode });
    }

    return NextResponse.json(result.value);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const { tenantId } = await context.params;
    const body = await readJson<{
      discordUserId?: string;
      username?: string;
      avatarUrl?: string | null;
      role?: 'admin' | 'member';
    }>(request);

    const result = await tenantService.addTenantMember(auth.session, {
      tenantId,
      discordUserId: body.discordUserId ?? '',
      username: body.username ?? '',
      avatarUrl: body.avatarUrl ?? null,
      role: body.role ?? 'member',
    });
    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode });
    }

    return NextResponse.json(result.value, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

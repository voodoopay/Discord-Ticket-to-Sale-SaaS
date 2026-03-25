import { TenantService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, readJson, requireSession } from '@/lib/http';

const tenantService = new TenantService();

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const { guildId } = await context.params;
    const body = await readJson<{ tenantId?: string }>(request);
    const tenantId = body.tenantId?.trim() ?? '';
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const result = await tenantService.disconnectGuild(auth.session, { tenantId, guildId });
    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

import { TenantService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, requireSession } from '@/lib/http';

const tenantService = new TenantService();

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string; userId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const { tenantId, userId } = await context.params;
    const result = await tenantService.removeTenantMember(auth.session, { tenantId, userId });
    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

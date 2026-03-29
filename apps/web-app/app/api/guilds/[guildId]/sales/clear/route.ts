import { SalesHistoryService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, readJson, requireSession } from '@/lib/http';

const salesHistoryService = new SalesHistoryService();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const { guildId } = await context.params;
    const body = await readJson<{ tenantId: string }>(request);

    const result = await salesHistoryService.clearGuildHistory(auth.session, {
      tenantId: body.tenantId,
      guildId,
    });

    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode });
    }

    return NextResponse.json(result.value);
  } catch (error) {
    return jsonError(error);
  }
}

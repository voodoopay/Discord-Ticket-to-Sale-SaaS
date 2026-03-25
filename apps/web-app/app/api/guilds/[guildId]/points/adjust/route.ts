import { PointsService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, readJson, requireSession } from '@/lib/http';

const pointsService = new PointsService();

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
    const body = await readJson<{
      tenantId: string;
      email: string;
      action: 'add' | 'remove' | 'set' | 'clear';
      points: number;
    }>(request);

    const result = await pointsService.manualAdjust(auth.session, {
      tenantId: body.tenantId,
      guildId,
      email: body.email,
      action: body.action,
      points: body.points,
    });
    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message, code: result.error.code }, { status: result.error.statusCode });
    }

    return NextResponse.json({ customer: result.value });
  } catch (error) {
    return jsonError(error);
  }
}

import { DashboardService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, requireSession } from '@/lib/http';

const dashboardService = new DashboardService();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId query parameter' }, { status: 400 });
    }

    const timeZone = request.nextUrl.searchParams.get('timeZone');
    const { guildId } = await context.params;
    const result = await dashboardService.getGuildOverview(auth.session, {
      tenantId,
      guildId,
      timeZone,
    });

    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message, code: result.error.code }, { status: result.error.statusCode });
    }

    return NextResponse.json({ overview: result.value });
  } catch (error) {
    return jsonError(error);
  }
}

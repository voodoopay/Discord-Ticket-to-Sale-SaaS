import { AiDiscordChannelSyncService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAiGuildAccess } from '@/lib/ai-guild-access';
import { jsonError } from '@/lib/http';

const channelSyncService = new AiDiscordChannelSyncService();

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ guildId: string; categoryId: string }> },
): Promise<NextResponse> {
  try {
    const { guildId, categoryId } = await context.params;
    const access = await requireAiGuildAccess(request, guildId);
    if (!access.ok) {
      return access.response;
    }

    const result = await channelSyncService.deleteCategorySource({ guildId, categoryId });
    if (result.isErr()) {
      return NextResponse.json(
        { error: result.error.message, code: result.error.code },
        { status: result.error.statusCode },
      );
    }

    return NextResponse.json(result.value);
  } catch (error) {
    return jsonError(error);
  }
}

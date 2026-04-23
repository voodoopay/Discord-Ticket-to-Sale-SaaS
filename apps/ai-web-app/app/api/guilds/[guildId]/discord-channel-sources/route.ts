import { AiDiscordChannelSyncService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAiGuildAccess } from '@/lib/ai-guild-access';
import { jsonError } from '@/lib/http';

const channelSyncService = new AiDiscordChannelSyncService();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> },
): Promise<NextResponse> {
  try {
    const { guildId } = await context.params;
    const access = await requireAiGuildAccess(request, guildId);
    if (!access.ok) {
      return access.response;
    }

    const body = (await request.json()) as { channelId?: string };
    const result = await channelSyncService.createChannelSource({
      guildId,
      channelId: body.channelId ?? '',
      actorDiscordUserId: access.value.session.discordUserId,
    });

    if (result.isErr()) {
      return NextResponse.json(
        { error: result.error.message, code: result.error.code },
        { status: result.error.statusCode },
      );
    }

    return NextResponse.json(result.value, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

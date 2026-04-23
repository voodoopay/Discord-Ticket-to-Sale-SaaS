import { AiKnowledgeManagementService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAiGuildAccess } from '@/lib/ai-guild-access';
import { jsonError } from '@/lib/http';

const knowledgeManagementService = new AiKnowledgeManagementService();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ guildId: string; sourceId: string }> },
): Promise<NextResponse> {
  try {
    const { guildId, sourceId } = await context.params;
    const access = await requireAiGuildAccess(request, guildId);
    if (!access.ok) {
      return access.response;
    }

    const result = await knowledgeManagementService.syncWebsiteSource({
      guildId,
      sourceId,
      actorDiscordUserId: access.value.session.discordUserId,
    });

    if (result.isErr()) {
      return NextResponse.json(
        { error: result.error.message, code: result.error.code },
        { status: result.error.statusCode },
      );
    }

    return NextResponse.json({ syncResult: result.value });
  } catch (error) {
    return jsonError(error);
  }
}

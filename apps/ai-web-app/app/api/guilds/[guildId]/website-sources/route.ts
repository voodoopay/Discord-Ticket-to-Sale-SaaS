import { AiKnowledgeManagementService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAiGuildAccess } from '@/lib/ai-guild-access';
import { jsonError, readJson } from '@/lib/http';

const knowledgeManagementService = new AiKnowledgeManagementService();

type CreateWebsiteSourceBody = {
  url: string;
};

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

    const body = await readJson<CreateWebsiteSourceBody>(request);
    const result = await knowledgeManagementService.createWebsiteSource({
      guildId,
      url: body.url,
      actorDiscordUserId: access.value.session.discordUserId,
    });

    if (result.isErr()) {
      return NextResponse.json(
        { error: result.error.message, code: result.error.code },
        { status: result.error.statusCode },
      );
    }

    return NextResponse.json(
      {
        source: result.value.source,
        created: result.value.created,
        syncResult: result.value.syncResult,
      },
      { status: result.value.created ? 201 : 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

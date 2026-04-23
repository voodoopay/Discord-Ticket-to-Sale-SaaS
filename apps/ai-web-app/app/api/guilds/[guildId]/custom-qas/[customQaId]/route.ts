import { AiKnowledgeManagementService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAiGuildAccess } from '@/lib/ai-guild-access';
import { jsonError, readJson } from '@/lib/http';

const knowledgeManagementService = new AiKnowledgeManagementService();

type UpdateCustomQaBody = {
  question: string;
  answer: string;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ guildId: string; customQaId: string }> },
): Promise<NextResponse> {
  try {
    const { guildId, customQaId } = await context.params;
    const access = await requireAiGuildAccess(request, guildId);
    if (!access.ok) {
      return access.response;
    }

    const body = await readJson<UpdateCustomQaBody>(request);
    const result = await knowledgeManagementService.updateCustomQa({
      guildId,
      customQaId,
      question: body.question,
      answer: body.answer,
      actorDiscordUserId: access.value.session.discordUserId,
    });

    if (result.isErr()) {
      return NextResponse.json(
        { error: result.error.message, code: result.error.code },
        { status: result.error.statusCode },
      );
    }

    return NextResponse.json({ customQa: result.value });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ guildId: string; customQaId: string }> },
): Promise<NextResponse> {
  try {
    const { guildId, customQaId } = await context.params;
    const access = await requireAiGuildAccess(request, guildId);
    if (!access.ok) {
      return access.response;
    }

    const result = await knowledgeManagementService.deleteCustomQa({
      guildId,
      customQaId,
    });

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

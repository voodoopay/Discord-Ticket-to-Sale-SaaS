import {
  AiAccessService,
  AiConfigService,
  AiDiagnosticsService,
  AiKnowledgeManagementService,
} from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAiGuildAccess } from '@/lib/ai-guild-access';
import { jsonError } from '@/lib/http';

const accessService = new AiAccessService();
const configService = new AiConfigService();
const diagnosticsService = new AiDiagnosticsService();
const knowledgeManagementService = new AiKnowledgeManagementService();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> },
): Promise<NextResponse> {
  try {
    const { guildId } = await context.params;
    const access = await requireAiGuildAccess(request, guildId);
    if (!access.ok) {
      return access.response;
    }

    const [activation, settings, diagnostics, websiteSources, customQas] = await Promise.all([
      accessService.getGuildActivationState({ guildId }),
      configService.getGuildSettingsSnapshot({ guildId }),
      diagnosticsService.getGuildDiagnostics({ guildId }),
      knowledgeManagementService.listWebsiteSources({ guildId }),
      knowledgeManagementService.listCustomQas({ guildId }),
    ]);

    if (activation.isErr()) {
      return NextResponse.json(
        { error: activation.error.message, code: activation.error.code },
        { status: activation.error.statusCode },
      );
    }
    if (settings.isErr()) {
      return NextResponse.json(
        { error: settings.error.message, code: settings.error.code },
        { status: settings.error.statusCode },
      );
    }
    if (diagnostics.isErr()) {
      return NextResponse.json(
        { error: diagnostics.error.message, code: diagnostics.error.code },
        { status: diagnostics.error.statusCode },
      );
    }
    if (websiteSources.isErr()) {
      return NextResponse.json(
        { error: websiteSources.error.message, code: websiteSources.error.code },
        { status: websiteSources.error.statusCode },
      );
    }
    if (customQas.isErr()) {
      return NextResponse.json(
        { error: customQas.error.message, code: customQas.error.code },
        { status: customQas.error.statusCode },
      );
    }

    return NextResponse.json({
      guild: access.value.guild,
      activation: activation.value,
      settings: settings.value,
      diagnostics: diagnostics.value,
      websiteSources: websiteSources.value,
      customQas: customQas.value,
    });
  } catch (error) {
    return jsonError(error);
  }
}

import { AiAccessService, AiConfigService, type AiReplyMode, type AiRoleMode, type AiTonePreset } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAiGuildAccess } from '@/lib/ai-guild-access';
import { jsonError, readJson } from '@/lib/http';

const accessService = new AiAccessService();
const configService = new AiConfigService();

type SaveAiSettingsBody = {
  enabled?: boolean;
  tonePreset: AiTonePreset;
  toneInstructions: string;
  roleMode: AiRoleMode;
  defaultReplyMode: AiReplyMode;
  replyChannels: Array<{
    channelId: string;
    replyMode: AiReplyMode;
  }>;
  roleIds: string[];
};

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

    const [activation, settings] = await Promise.all([
      accessService.getGuildActivationState({ guildId }),
      configService.getGuildSettingsSnapshot({ guildId }),
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

    return NextResponse.json({
      guild: access.value.guild,
      activation: activation.value,
      settings: settings.value,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> },
): Promise<NextResponse> {
  try {
    const { guildId } = await context.params;
    const access = await requireAiGuildAccess(request, guildId);
    if (!access.ok) {
      return access.response;
    }

    const body = await readJson<SaveAiSettingsBody>(request);
    const result = await configService.saveGuildSettings({
      guildId,
      enabled: body.enabled,
      tonePreset: body.tonePreset,
      toneInstructions: body.toneInstructions ?? '',
      roleMode: body.roleMode,
      defaultReplyMode: body.defaultReplyMode,
      replyChannels: body.replyChannels ?? [],
      roleIds: body.roleIds ?? [],
      updatedByDiscordUserId: access.value.session.discordUserId,
    });

    if (result.isErr()) {
      return NextResponse.json(
        { error: result.error.message, code: result.error.code },
        { status: result.error.statusCode },
      );
    }

    return NextResponse.json({ settings: result.value });
  } catch (error) {
    return jsonError(error);
  }
}

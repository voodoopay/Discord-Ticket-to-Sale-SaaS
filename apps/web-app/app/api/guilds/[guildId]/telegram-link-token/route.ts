import { getEnv, signTelegramLinkToken, TelegramLinkRepository, TenantRepository } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, readJson, requireSession } from '@/lib/http';

const tenantRepository = new TenantRepository();
const telegramLinkRepository = new TelegramLinkRepository();
const env = getEnv();
const TELEGRAM_LINK_TOKEN_TTL_SECONDS = 10 * 60;

function buildTelegramInviteUrl(botUsername: string | null): string | null {
  const normalized = botUsername?.trim().replace(/^@+/u, '') ?? '';
  if (!normalized) {
    return null;
  }

  return `https://t.me/${normalized}?startgroup=true`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const { guildId } = await context.params;
    const tenantId = request.nextUrl.searchParams.get('tenantId')?.trim() ?? '';
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    if (!auth.session.isSuperAdmin && !auth.session.tenantIds.includes(tenantId)) {
      return NextResponse.json({ error: 'You do not have access to this workspace.' }, { status: 403 });
    }

    const linkedGuild = await tenantRepository.getTenantGuild({
      tenantId,
      guildId,
    });
    if (!linkedGuild) {
      return NextResponse.json({ error: 'This Discord server is not linked to the selected workspace.' }, { status: 404 });
    }

    const config = await tenantRepository.getGuildConfig({
      tenantId,
      guildId,
    });
    const linkedChat = await telegramLinkRepository.getByGuild({
      tenantId,
      guildId,
    });
    const botUsername = env.TELEGRAM_BOT_USERNAME.trim() || null;

    return NextResponse.json({
      enabled: config?.telegramEnabled ?? false,
      botUsername,
      inviteUrl: buildTelegramInviteUrl(botUsername),
      linkedChat: linkedChat
        ? {
            chatId: linkedChat.chatId,
            chatTitle: linkedChat.chatTitle,
            linkedByDiscordUserId: linkedChat.linkedByDiscordUserId,
            updatedAt: linkedChat.updatedAt.toISOString(),
          }
        : null,
      guildName: linkedGuild.guildName,
    });
  } catch (error) {
    return jsonError(error);
  }
}

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
    const body = await readJson<{ tenantId?: string }>(request);
    const tenantId = body.tenantId?.trim() ?? '';

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    if (!auth.session.isSuperAdmin && !auth.session.tenantIds.includes(tenantId)) {
      return NextResponse.json({ error: 'You do not have access to this workspace.' }, { status: 403 });
    }

    const linkedGuild = await tenantRepository.getTenantGuild({
      tenantId,
      guildId,
    });
    if (!linkedGuild) {
      return NextResponse.json({ error: 'This Discord server is not linked to the selected workspace.' }, { status: 404 });
    }

    const config = await tenantRepository.getGuildConfig({
      tenantId,
      guildId,
    });
    if (!config?.telegramEnabled) {
      return NextResponse.json({ error: 'Telegram is currently disabled for this server.' }, { status: 409 });
    }

    const exp = Math.floor(Date.now() / 1000) + TELEGRAM_LINK_TOKEN_TTL_SECONDS;
    const token = signTelegramLinkToken(
      {
        tenantId,
        guildId,
        exp,
      },
      env.SESSION_SECRET,
    );

    return NextResponse.json({
      token,
      command: `/connect ${token}`,
      botUsername: env.TELEGRAM_BOT_USERNAME.trim() || null,
      inviteUrl: buildTelegramInviteUrl(env.TELEGRAM_BOT_USERNAME.trim() || null),
      expiresAt: new Date(exp * 1000).toISOString(),
      guildName: linkedGuild.guildName,
    });
  } catch (error) {
    return jsonError(error);
  }
}

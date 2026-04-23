import { AuthService, type OAuthDiscordGuild, type SessionPayload } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireSession } from '@/lib/http';

const authService = new AuthService();

const DISCORD_PERMISSION_ADMINISTRATOR = 1n << 3n;
const DISCORD_PERMISSION_MANAGE_GUILD = 1n << 5n;

function hasManageGuildPermissions(guild: OAuthDiscordGuild): boolean {
  if (guild.owner) {
    return true;
  }

  const rawPermissions = guild.permissions ?? '0';
  let permissions = 0n;
  try {
    permissions = BigInt(rawPermissions);
  } catch {
    return false;
  }

  return (
    (permissions & DISCORD_PERMISSION_ADMINISTRATOR) !== 0n ||
    (permissions & DISCORD_PERMISSION_MANAGE_GUILD) !== 0n
  );
}

export type AiPanelGuildAccess = {
  session: SessionPayload;
  oauthAccessToken: string;
  guild: {
    id: string;
    name: string;
    iconUrl: string | null;
    owner: boolean;
    permissions: string;
  };
};

export async function requireAiGuildAccess(
  request: NextRequest,
  guildId: string,
): Promise<{ ok: true; value: AiPanelGuildAccess } | { ok: false; response: NextResponse }> {
  const auth = await requireSession(request);
  if (!auth.ok) {
    return auth;
  }

  const oauthAccessToken = request.cookies.get('vd_discord_access_token')?.value ?? '';
  if (!oauthAccessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Discord session expired. Please log in again on this panel domain.' },
        { status: 401 },
      ),
    };
  }

  const guildsResult = await authService.listDiscordGuildsByAccessToken(oauthAccessToken);
  if (guildsResult.isErr()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: guildsResult.error.message, code: guildsResult.error.code },
        { status: guildsResult.error.statusCode },
      ),
    };
  }

  const selectedGuild = guildsResult.value.find((guild) => guild.id === guildId);
  if (!selectedGuild || !hasManageGuildPermissions(selectedGuild)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'You do not have owner or administrator access for this Discord server.' },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    value: {
      session: auth.session,
      oauthAccessToken,
      guild: {
        id: selectedGuild.id,
        name: selectedGuild.name,
        iconUrl: selectedGuild.icon
          ? `https://cdn.discordapp.com/icons/${selectedGuild.id}/${selectedGuild.icon}.png`
          : null,
        owner: Boolean(selectedGuild.owner),
        permissions: selectedGuild.permissions ?? '0',
      },
    },
  };
}

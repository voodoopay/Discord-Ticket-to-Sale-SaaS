import { getEnv } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAiGuildAccess } from '@/lib/ai-guild-access';
import { jsonError } from '@/lib/http';

const env = getEnv();
const DISCORD_TEXT_CHANNEL_TYPES = new Set([0, 5]);
const DISCORD_CATEGORY_CHANNEL_TYPE = 4;

function buildAiBotInviteUrl(): string {
  const query = new URLSearchParams({
    client_id: env.AI_DISCORD_CLIENT_ID,
    permissions: '534723950656',
    scope: 'bot applications.commands',
  });

  return `https://discord.com/oauth2/authorize?${query.toString()}`;
}

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

    const inviteUrl = buildAiBotInviteUrl();
    const botToken = env.AI_DISCORD_TOKEN.trim();
    if (!botToken) {
      return NextResponse.json(
        { error: 'AI bot token is not configured on the server.' },
        { status: 500 },
      );
    }

    const guildCheckResponse = await fetch(`${env.DISCORD_API_BASE_URL}/guilds/${guildId}`, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (guildCheckResponse.status === 403 || guildCheckResponse.status === 404) {
      return NextResponse.json({
        botInGuild: false,
        inviteUrl,
        guild: access.value.guild,
        channels: [],
        categoryChannels: [],
        roles: [],
      });
    }

    if (!guildCheckResponse.ok) {
      return NextResponse.json(
        { error: `Failed to inspect AI bot membership (${guildCheckResponse.status}).` },
        { status: 502 },
      );
    }

    const [channelsResponse, rolesResponse] = await Promise.all([
      fetch(`${env.DISCORD_API_BASE_URL}/guilds/${guildId}/channels`, {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      }),
      fetch(`${env.DISCORD_API_BASE_URL}/guilds/${guildId}/roles`, {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      }),
    ]);

    if (!channelsResponse.ok || !rolesResponse.ok) {
      return NextResponse.json(
        {
          error: `Failed to load server channels or roles (${channelsResponse.status}/${rolesResponse.status}).`,
        },
        { status: 502 },
      );
    }

    const rawChannels = (await channelsResponse.json()) as Array<{
      id: string;
      name: string;
      type: number;
      position?: number;
    }>;
    const rawRoles = (await rolesResponse.json()) as Array<{
      id: string;
      name: string;
      color: number;
      managed: boolean;
      position: number;
    }>;

    const channels = rawChannels
      .filter((channel) => DISCORD_TEXT_CHANNEL_TYPES.has(channel.type))
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      }));
    const categoryChannels = rawChannels
      .filter((channel) => channel.type === DISCORD_CATEGORY_CHANNEL_TYPE)
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      }));
    const roles = rawRoles
      .filter((role) => role.id !== guildId && !role.managed)
      .sort((left, right) => right.position - left.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
      }));

    return NextResponse.json({
      botInGuild: true,
      inviteUrl,
      guild: access.value.guild,
      channels,
      categoryChannels,
      roles,
    });
  } catch (error) {
    return jsonError(error);
  }
}

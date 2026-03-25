import { AdminService, TenantService, getEnv } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, requireSession } from '@/lib/http';

const adminService = new AdminService();
const tenantService = new TenantService();
const env = getEnv();

type DiscordMemberSearchRecord = {
  nick?: string | null;
  user?: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
    bot?: boolean;
  };
};

function buildAvatarUrl(user: DiscordMemberSearchRecord['user']): string | null {
  if (!user?.avatar) {
    return null;
  }

  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
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
    const query = request.nextUrl.searchParams.get('query')?.trim() ?? '';

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    if (query.length < 2) {
      return NextResponse.json({ candidates: [] });
    }

    const linkedTenant = await tenantService.getLinkedTenantForGuild(auth.session, { guildId });
    if (linkedTenant.isErr()) {
      return NextResponse.json({ error: linkedTenant.error.message }, { status: linkedTenant.error.statusCode });
    }

    if (!linkedTenant.value || linkedTenant.value.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'This Discord server is not linked to the selected workspace.' },
        { status: 404 },
      );
    }

    const access = await tenantService.listTenantMembers(auth.session, { tenantId });
    if (access.isErr()) {
      return NextResponse.json({ error: access.error.message }, { status: access.error.statusCode });
    }

    if (!access.value.canManageMembers) {
      return NextResponse.json(
        { error: 'Only the workspace owner or a super admin can invite members.' },
        { status: 403 },
      );
    }

    const botTokenResult = await adminService.getResolvedBotToken();
    if (botTokenResult.isErr()) {
      return NextResponse.json({ error: botTokenResult.error.message }, { status: botTokenResult.error.statusCode });
    }

    const searchParams = new URLSearchParams({
      query,
      limit: '8',
    });

    const response = await fetch(`${env.DISCORD_API_BASE_URL}/guilds/${guildId}/members/search?${searchParams.toString()}`, {
      headers: {
        Authorization: `Bot ${botTokenResult.value}`,
      },
    });

    if (response.status === 403 || response.status === 404) {
      return NextResponse.json(
        { error: 'Discord member lookup is unavailable until the bot is active in this server.' },
        { status: 409 },
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to search Discord members (${response.status}).` },
        { status: 502 },
      );
    }

    const existingRolesByDiscordId = new Map(
      access.value.members.map((member) => [member.discordUserId, member.role] as const),
    );
    const deduped = new Map<
      string,
      {
        discordUserId: string;
        username: string;
        displayName: string;
        avatarUrl: string | null;
        alreadyInWorkspace: boolean;
        currentRole: 'owner' | 'admin' | 'member' | null;
      }
    >();

    const rawMembers = (await response.json()) as DiscordMemberSearchRecord[];
    for (const member of rawMembers) {
      const user = member.user;
      if (!user || user.bot) {
        continue;
      }

      const currentRole = existingRolesByDiscordId.get(user.id) ?? null;
      deduped.set(user.id, {
        discordUserId: user.id,
        username: user.username,
        displayName: member.nick?.trim() || user.global_name?.trim() || user.username,
        avatarUrl: buildAvatarUrl(user),
        alreadyInWorkspace: currentRole !== null,
        currentRole,
      });
    }

    return NextResponse.json({
      candidates: [...deduped.values()],
    });
  } catch (error) {
    return jsonError(error);
  }
}

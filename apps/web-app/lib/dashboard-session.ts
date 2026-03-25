import { AuthService, TenantService, type OAuthDiscordGuild } from '@voodoo/core';
import { cookies } from 'next/headers';

import type { DiscordGuildSummary, TenantSummary } from './dashboard-types';

const authService = new AuthService();
const tenantService = new TenantService();

const DISCORD_PERMISSION_ADMINISTRATOR = 1n << 3n;
const DISCORD_PERMISSION_MANAGE_GUILD = 1n << 5n;

function hasManageGuildPermissions(guild: OAuthDiscordGuild): boolean {
  if (guild.owner) {
    return true;
  }

  const raw = guild.permissions ?? '0';
  let permissions = 0n;
  try {
    permissions = BigInt(raw);
  } catch {
    return false;
  }

  return (
    (permissions & DISCORD_PERMISSION_ADMINISTRATOR) !== 0n ||
    (permissions & DISCORD_PERMISSION_MANAGE_GUILD) !== 0n
  );
}

export type DashboardSessionData = {
  me: {
    userId: string;
    isSuperAdmin: boolean;
    tenantIds: string[];
  };
  tenants: TenantSummary[];
  tenantGuildsByTenantId: Record<string, Array<{ guildId: string; guildName: string }>>;
  discordGuilds: DiscordGuildSummary[];
  discordGuildsError: string;
};

export async function getDashboardSessionData(): Promise<DashboardSessionData | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('vd_session')?.value ?? '';
  if (!sessionToken) {
    return null;
  }

  const session = await authService.getSession(sessionToken);
  if (session.isErr()) {
    return null;
  }

  const [me, tenants] = await Promise.all([
    tenantService.getMe(session.value),
    tenantService.listTenants(session.value),
  ]);
  if (me.isErr() || tenants.isErr()) {
    return null;
  }

  const tenantGuildsByTenantId: Record<string, Array<{ guildId: string; guildName: string }>> = {};
  await Promise.all(
    tenants.value.map(async (tenant) => {
      const guilds = await tenantService.listTenantGuilds(session.value, {
        tenantId: tenant.id,
      });
      if (guilds.isOk()) {
        tenantGuildsByTenantId[tenant.id] = guilds.value;
      }
    }),
  );

  const oauthAccessToken = cookieStore.get('vd_discord_access_token')?.value ?? '';
  let discordGuilds: DiscordGuildSummary[] = [];
  let discordGuildsError = '';

  if (oauthAccessToken) {
    const guildsResult = await authService.listDiscordGuildsByAccessToken(oauthAccessToken);
    if (guildsResult.isErr()) {
      discordGuildsError = guildsResult.error.message;
    } else {
      discordGuilds = guildsResult.value
        .filter(hasManageGuildPermissions)
        .map((guild) => ({
          id: guild.id,
          name: guild.name,
          iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
          owner: Boolean(guild.owner),
          permissions: guild.permissions ?? '0',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  } else {
    discordGuildsError =
      'Discord server list unavailable. Please log in again. If this repeats, ensure you are logging in and using the dashboard on the exact same domain.';
  }

  return {
    me: me.value,
    tenants: tenants.value,
    tenantGuildsByTenantId,
    discordGuilds,
    discordGuildsError,
  };
}

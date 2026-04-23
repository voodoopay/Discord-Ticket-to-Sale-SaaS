import { AuthService, type OAuthDiscordGuild, type SessionPayload } from '../../../packages/core/dist/index.js';
import { cookies } from 'next/headers';

const authService = new AuthService();

const DISCORD_PERMISSION_ADMINISTRATOR = 1n << 3n;
const DISCORD_PERMISSION_MANAGE_GUILD = 1n << 5n;

export type AiDashboardGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  permissions: string;
};

export type AiDashboardSessionData = {
  me: SessionPayload;
  discordGuilds: AiDashboardGuild[];
  discordGuildsError: string;
};

function hasAdminPermissions(guild: OAuthDiscordGuild): boolean {
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

export async function getAiDashboardSessionData(): Promise<AiDashboardSessionData | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('vd_session')?.value ?? '';
  if (!sessionToken) {
    return null;
  }

  const session = await authService.getSession(sessionToken);
  if (session.isErr()) {
    return null;
  }

  const oauthAccessToken = cookieStore.get('vd_discord_access_token')?.value ?? '';
  if (!oauthAccessToken) {
    return {
      me: session.value,
      discordGuilds: [],
      discordGuildsError:
        'Discord server list unavailable. Log in again on this exact panel domain to refresh guild access.',
    };
  }

  const guildsResult = await authService.listDiscordGuildsByAccessToken(oauthAccessToken);
  if (guildsResult.isErr()) {
    return {
      me: session.value,
      discordGuilds: [],
      discordGuildsError: guildsResult.error.message,
    };
  }

  return {
    me: session.value,
    discordGuilds: guildsResult.value
      .filter(hasAdminPermissions)
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
        owner: Boolean(guild.owner),
        permissions: guild.permissions ?? '0',
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    discordGuildsError: '',
  };
}

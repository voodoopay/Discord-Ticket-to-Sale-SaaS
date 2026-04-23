import { err, ok, type Result } from 'neverthrow';

import { getEnv } from '../config/env.js';
import { AppError, fromUnknownError } from '../domain/errors.js';
import type { OAuthDiscordGuild, OAuthDiscordUser } from '../domain/types.js';
import { createSessionToken, verifySessionToken, type SessionPayload } from '../security/session-token.js';
import { logger } from '../infra/logger.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import { UserRepository } from '../repositories/user-repository.js';

export type AuthCallbackResult = {
  sessionToken: string;
  discordAccessToken: string;
  user: {
    id: string;
    discordUserId: string;
    username: string;
    avatarUrl: string | null;
  };
  isSuperAdmin: boolean;
  tenantIds: string[];
  guilds: OAuthDiscordGuild[];
};

type AuthServiceOptions = {
  discordClientId?: string;
  discordClientSecret?: string;
  discordRedirectUri?: string;
};

function avatarUrl(discordUser: OAuthDiscordUser): string | null {
  if (!discordUser.avatar) {
    return null;
  }

  return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`;
}

export class AuthService {
  private static readonly DISCORD_GUILDS_CACHE_FRESH_MS = 60 * 1000;
  private static readonly DISCORD_GUILDS_CACHE_STALE_MS = 5 * 60 * 1000;
  private static readonly DISCORD_GUILDS_CACHE_MAX_ITEMS = 500;
  private static readonly DISCORD_GUILDS_RATE_LIMIT_FALLBACK_MS = 30 * 1000;
  private static readonly discordGuildsCache = new Map<
    string,
    {
      guilds: OAuthDiscordGuild[];
      freshUntil: number;
      staleUntil: number;
      rateLimitedUntil: number;
    }
  >();
  private static readonly discordGuildsInFlight = new Map<string, Promise<Result<OAuthDiscordGuild[], AppError>>>();

  private readonly env = getEnv();
  private readonly userRepository = new UserRepository();
  private readonly tenantRepository = new TenantRepository();

  public constructor(private readonly options: AuthServiceOptions = {}) {}

  private static readGuildCache(accessToken: string):
    | {
        guilds: OAuthDiscordGuild[];
        freshUntil: number;
        staleUntil: number;
        rateLimitedUntil: number;
      }
    | null {
    const entry = AuthService.discordGuildsCache.get(accessToken);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.staleUntil) {
      AuthService.discordGuildsCache.delete(accessToken);
      return null;
    }

    return entry;
  }

  private static writeGuildCache(accessToken: string, guilds: OAuthDiscordGuild[]): void {
    const now = Date.now();
    AuthService.discordGuildsCache.set(accessToken, {
      guilds,
      freshUntil: now + AuthService.DISCORD_GUILDS_CACHE_FRESH_MS,
      staleUntil: now + AuthService.DISCORD_GUILDS_CACHE_STALE_MS,
      rateLimitedUntil: 0,
    });

    while (AuthService.discordGuildsCache.size > AuthService.DISCORD_GUILDS_CACHE_MAX_ITEMS) {
      const oldestKey = AuthService.discordGuildsCache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }

      AuthService.discordGuildsCache.delete(oldestKey);
    }
  }

  private static parseRetryAfterMs(retryAfterHeader: string | null): number {
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Math.ceil(retryAfterSeconds * 1000);
    }

    return AuthService.DISCORD_GUILDS_RATE_LIMIT_FALLBACK_MS;
  }

  public buildLoginUrl(state: string, redirectUri?: string): string {
    const resolvedRedirectUri = redirectUri ?? this.options.discordRedirectUri ?? this.env.DISCORD_REDIRECT_URI;
    const scopes = ['identify', 'guilds'];
    const query = new URLSearchParams({
      client_id: this.options.discordClientId ?? this.env.DISCORD_CLIENT_ID,
      response_type: 'code',
      redirect_uri: resolvedRedirectUri,
      scope: scopes.join(' '),
      state,
      prompt: 'consent',
    });

    return `https://discord.com/oauth2/authorize?${query.toString()}`;
  }

  public async exchangeCodeForSession(input: {
    code: string;
    state: string;
    expectedState: string;
    redirectUri?: string;
  }): Promise<Result<AuthCallbackResult, AppError>> {
    if (input.state !== input.expectedState) {
      return err(new AppError('OAUTH_STATE_MISMATCH', 'Invalid OAuth state', 400));
    }

    const clientSecret = this.options.discordClientSecret ?? this.env.DISCORD_CLIENT_SECRET;

    if (!clientSecret) {
      return err(
        new AppError('MISSING_DISCORD_CLIENT_SECRET', 'DISCORD_CLIENT_SECRET is not configured', 500),
      );
    }

    try {
      const resolvedRedirectUri =
        input.redirectUri ?? this.options.discordRedirectUri ?? this.env.DISCORD_REDIRECT_URI;
      const tokenRes = await fetch(`${this.env.DISCORD_API_BASE_URL}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.options.discordClientId ?? this.env.DISCORD_CLIENT_ID,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: resolvedRedirectUri,
        }),
      });

      if (!tokenRes.ok) {
        return err(new AppError('DISCORD_OAUTH_FAILED', 'Discord token exchange failed', 502));
      }

      const tokenBody = (await tokenRes.json()) as {
        access_token: string;
      };

      const accessToken = tokenBody.access_token;
      if (!accessToken) {
        return err(new AppError('DISCORD_OAUTH_FAILED', 'Missing access token from Discord', 502));
      }

      const userRes = await fetch(`${this.env.DISCORD_API_BASE_URL}/users/@me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!userRes.ok) {
        logger.warn(
          { status: userRes.status },
          'discord oauth could not fetch user profile during callback',
        );
        return err(new AppError('DISCORD_OAUTH_PROFILE_FAILED', 'Failed to fetch profile from Discord', 502));
      }

      const discordUser = (await userRes.json()) as OAuthDiscordUser;
      let discordGuilds: OAuthDiscordGuild[] = [];

      try {
        const guildsRes = await fetch(`${this.env.DISCORD_API_BASE_URL}/users/@me/guilds`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (guildsRes.ok) {
          const guildsBody = (await guildsRes.json()) as OAuthDiscordGuild[];
          discordGuilds = Array.isArray(guildsBody) ? guildsBody : [];
          AuthService.writeGuildCache(accessToken, discordGuilds);
        } else {
          logger.warn(
            { discordUserId: discordUser.id, status: guildsRes.status },
            'discord oauth could not fetch guild list during callback',
          );
        }
      } catch (guildsError) {
        logger.warn(
          { discordUserId: discordUser.id, err: guildsError },
          'discord oauth guild list fetch threw during callback',
        );
      }

      const user = await this.userRepository.upsertDiscordUser({
        discordUserId: discordUser.id,
        username: discordUser.username,
        avatarUrl: avatarUrl(discordUser),
      });

      if (this.env.superAdminDiscordIds.includes(discordUser.id)) {
        await this.userRepository.ensureSuperAdmin({ userId: user.id, discordUserId: discordUser.id });
      }

      const isSuperAdmin = await this.userRepository.isSuperAdmin(discordUser.id);
      const tenantIds = await this.userRepository.getTenantIdsForUser(user.id);

      const sessionPayload: SessionPayload = {
        userId: user.id,
        discordUserId: user.discordUserId,
        isSuperAdmin,
        tenantIds,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
      };

      const sessionToken = createSessionToken(sessionPayload, this.env.SESSION_SECRET);

      return ok({
        sessionToken,
        discordAccessToken: accessToken,
        user,
        isSuperAdmin,
        tenantIds,
        guilds: discordGuilds,
      });
    } catch (error) {
      return err(fromUnknownError(error, 'DISCORD_OAUTH_EXCEPTION'));
    }
  }

  public async getSession(token: string): Promise<Result<SessionPayload, AppError>> {
    try {
      const payload = verifySessionToken(token, this.env.SESSION_SECRET);
      const tenantIds = await this.userRepository.getTenantIdsForUser(payload.userId);
      return ok({
        ...payload,
        tenantIds,
      });
    } catch (error) {
      return err(fromUnknownError(error, 'INVALID_SESSION'));
    }
  }

  public async listManageableGuilds(token: string): Promise<Result<OAuthDiscordGuild[], AppError>> {
    try {
      const payload = verifySessionToken(token, this.env.SESSION_SECRET);
      const user = await this.userRepository.getByDiscordUserId(payload.discordUserId);

      if (!user) {
        return err(new AppError('USER_NOT_FOUND', 'User not found', 404));
      }

      const tenants = await this.tenantRepository.listTenantsForUser(user.id);
      const guilds: OAuthDiscordGuild[] = [];

      for (const tenant of tenants) {
        const tenantGuilds = await this.tenantRepository.listGuildsForTenant(tenant.id);
        for (const guild of tenantGuilds) {
          guilds.push({ id: guild.guildId, name: guild.guildName, owner: false });
        }
      }

      return ok(guilds);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async listDiscordGuildsByAccessToken(
    accessToken: string,
  ): Promise<Result<OAuthDiscordGuild[], AppError>> {
    const normalizedAccessToken = accessToken.trim();
    if (!normalizedAccessToken) {
      return err(new AppError('DISCORD_ACCESS_TOKEN_MISSING', 'Discord access token is missing', 401));
    }

    const cached = AuthService.readGuildCache(normalizedAccessToken);
    const now = Date.now();
    if (cached && now <= cached.freshUntil) {
      return ok(cached.guilds);
    }

    if (cached && now <= cached.rateLimitedUntil) {
      return ok(cached.guilds);
    }

    const inFlight = AuthService.discordGuildsInFlight.get(normalizedAccessToken);
    if (inFlight) {
      return inFlight;
    }

    const request = this.fetchDiscordGuildsByAccessToken(normalizedAccessToken, cached);
    AuthService.discordGuildsInFlight.set(normalizedAccessToken, request);
    try {
      return await request;
    } finally {
      const activeRequest = AuthService.discordGuildsInFlight.get(normalizedAccessToken);
      if (activeRequest === request) {
        AuthService.discordGuildsInFlight.delete(normalizedAccessToken);
      }
    }
  }

  private async fetchDiscordGuildsByAccessToken(
    normalizedAccessToken: string,
    cached: {
      guilds: OAuthDiscordGuild[];
      freshUntil: number;
      staleUntil: number;
      rateLimitedUntil: number;
    } | null,
  ): Promise<Result<OAuthDiscordGuild[], AppError>> {
    const currentCache = cached ?? AuthService.readGuildCache(normalizedAccessToken);

    try {
      const guildsRes = await fetch(`${this.env.DISCORD_API_BASE_URL}/users/@me/guilds`, {
        headers: {
          Authorization: `Bearer ${normalizedAccessToken}`,
        },
      });

      if (!guildsRes.ok) {
        if (guildsRes.status === 401) {
          AuthService.discordGuildsCache.delete(normalizedAccessToken);
          return err(new AppError('DISCORD_ACCESS_TOKEN_INVALID', 'Discord login has expired. Please log in again.', 401));
        }

        if (guildsRes.status === 429) {
          if (currentCache) {
            const retryAfterMs = AuthService.parseRetryAfterMs(guildsRes.headers.get('retry-after'));

            AuthService.discordGuildsCache.set(normalizedAccessToken, {
              ...currentCache,
              rateLimitedUntil: Date.now() + retryAfterMs,
            });

            return ok(currentCache.guilds);
          }

          return err(
            new AppError(
              'DISCORD_GUILDS_RATE_LIMITED',
              'Discord rate-limited server list loading. Wait a moment and reconnect Discord.',
              429,
            ),
          );
        }

        return err(
          new AppError(
            'DISCORD_GUILDS_FETCH_FAILED',
            `Failed to load Discord servers (${guildsRes.status}). Reconnect Discord and try again.`,
            502,
          ),
        );
      }

      const guilds = (await guildsRes.json()) as OAuthDiscordGuild[];
      const normalizedGuilds = Array.isArray(guilds) ? guilds : [];
      AuthService.writeGuildCache(normalizedAccessToken, normalizedGuilds);

      return ok(normalizedGuilds);
    } catch (error) {
      if (currentCache) {
        return ok(currentCache.guilds);
      }

      return err(fromUnknownError(error, 'DISCORD_GUILDS_FETCH_EXCEPTION'));
    }
  }
}

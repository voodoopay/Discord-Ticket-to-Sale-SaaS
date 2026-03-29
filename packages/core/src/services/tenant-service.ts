import { err, ok, type Result } from 'neverthrow';

import { AppError, fromUnknownError } from '../domain/errors.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import { TelegramLinkRepository } from '../repositories/telegram-link-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { validateJoinGateConfig } from './join-gate-service.js';
import {
  computeNextRunAtUtc,
  hasSameSalesHistoryAutoClearPattern,
  parseSalesHistoryAutoClearConfig,
  type SalesHistoryAutoClearFrequency,
} from './sales-history-schedule.js';
import type { SessionPayload } from '../security/session-token.js';
import type { TenantMemberRole } from '../domain/types.js';

export type ActorContext = SessionPayload;

export type GuildConfigSummary = {
  paidLogChannelId: string | null;
  staffRoleIds: string[];
  defaultCurrency: string;
  couponsEnabled: boolean;
  pointsEnabled: boolean;
  referralsEnabled: boolean;
  telegramEnabled: boolean;
  tipEnabled: boolean;
  pointsEarnCategoryKeys: string[];
  pointsRedeemCategoryKeys: string[];
  pointValueMinor: number;
  referralRewardMinor: number;
  referralRewardCategoryKeys: string[];
  referralLogChannelId: string | null;
  referralThankYouTemplate: string;
  referralSubmissionTemplate: string;
  ticketMetadataKey: string;
  joinGateEnabled: boolean;
  joinGateFallbackChannelId: string | null;
  joinGateVerifiedRoleId: string | null;
  joinGateTicketCategoryId: string | null;
  joinGateCurrentLookupChannelId: string | null;
  joinGateNewLookupChannelId: string | null;
  salesHistoryClearedAt: Date | null;
  salesHistoryAutoClearEnabled: boolean;
  salesHistoryAutoClearFrequency: SalesHistoryAutoClearFrequency;
  salesHistoryAutoClearLocalTimeHhMm: string;
  salesHistoryAutoClearTimezone: string;
  salesHistoryAutoClearDayOfWeek: number | null;
  salesHistoryAutoClearDayOfMonth: number | null;
  salesHistoryAutoClearNextRunAtUtc: Date | null;
  salesHistoryAutoClearLastRunAtUtc: Date | null;
  salesHistoryAutoClearLastLocalRunDate: string | null;
};

export class TenantService {
  private readonly tenantRepository = new TenantRepository();
  private readonly telegramLinkRepository = new TelegramLinkRepository();
  private readonly userRepository = new UserRepository();

  private mapGuildConfigSummary(config: {
    paidLogChannelId: string | null;
    staffRoleIds: string[];
    defaultCurrency: string;
    couponsEnabled: boolean;
    pointsEnabled: boolean;
    referralsEnabled: boolean;
    telegramEnabled: boolean;
    tipEnabled: boolean;
    pointsEarnCategoryKeys: string[];
    pointsRedeemCategoryKeys: string[];
    pointValueMinor: number;
    referralRewardMinor: number;
    referralRewardCategoryKeys: string[];
    referralLogChannelId: string | null;
    referralThankYouTemplate: string;
    referralSubmissionTemplate: string;
    ticketMetadataKey: string;
    joinGateEnabled?: boolean;
    joinGateFallbackChannelId?: string | null;
    joinGateVerifiedRoleId?: string | null;
    joinGateTicketCategoryId?: string | null;
    joinGateCurrentLookupChannelId?: string | null;
    joinGateNewLookupChannelId?: string | null;
    salesHistoryClearedAt: Date | null;
    salesHistoryAutoClearEnabled: boolean;
    salesHistoryAutoClearFrequency: SalesHistoryAutoClearFrequency;
    salesHistoryAutoClearLocalTimeHhMm: string;
    salesHistoryAutoClearTimezone: string;
    salesHistoryAutoClearDayOfWeek: number | null;
    salesHistoryAutoClearDayOfMonth: number | null;
    salesHistoryAutoClearNextRunAtUtc: Date | null;
    salesHistoryAutoClearLastRunAtUtc: Date | null;
    salesHistoryAutoClearLastLocalRunDate: string | null;
  }): GuildConfigSummary {
    return {
      paidLogChannelId: config.paidLogChannelId,
      staffRoleIds: config.staffRoleIds,
      defaultCurrency: config.defaultCurrency,
      couponsEnabled: config.couponsEnabled,
      pointsEnabled: config.pointsEnabled,
      referralsEnabled: config.referralsEnabled,
      telegramEnabled: config.telegramEnabled,
      tipEnabled: config.tipEnabled,
      pointsEarnCategoryKeys: config.pointsEarnCategoryKeys,
      pointsRedeemCategoryKeys: config.pointsRedeemCategoryKeys,
      pointValueMinor: config.pointValueMinor,
      referralRewardMinor: config.referralRewardMinor,
      referralRewardCategoryKeys: config.referralRewardCategoryKeys,
      referralLogChannelId: config.referralLogChannelId,
      referralThankYouTemplate: config.referralThankYouTemplate,
      referralSubmissionTemplate: config.referralSubmissionTemplate,
      ticketMetadataKey: config.ticketMetadataKey,
      joinGateEnabled: config.joinGateEnabled ?? false,
      joinGateFallbackChannelId: config.joinGateFallbackChannelId ?? null,
      joinGateVerifiedRoleId: config.joinGateVerifiedRoleId ?? null,
      joinGateTicketCategoryId: config.joinGateTicketCategoryId ?? null,
      joinGateCurrentLookupChannelId: config.joinGateCurrentLookupChannelId ?? null,
      joinGateNewLookupChannelId: config.joinGateNewLookupChannelId ?? null,
      salesHistoryClearedAt: config.salesHistoryClearedAt,
      salesHistoryAutoClearEnabled: config.salesHistoryAutoClearEnabled,
      salesHistoryAutoClearFrequency: config.salesHistoryAutoClearFrequency,
      salesHistoryAutoClearLocalTimeHhMm: config.salesHistoryAutoClearLocalTimeHhMm,
      salesHistoryAutoClearTimezone: config.salesHistoryAutoClearTimezone,
      salesHistoryAutoClearDayOfWeek: config.salesHistoryAutoClearDayOfWeek,
      salesHistoryAutoClearDayOfMonth: config.salesHistoryAutoClearDayOfMonth,
      salesHistoryAutoClearNextRunAtUtc: config.salesHistoryAutoClearNextRunAtUtc,
      salesHistoryAutoClearLastRunAtUtc: config.salesHistoryAutoClearLastRunAtUtc,
      salesHistoryAutoClearLastLocalRunDate: config.salesHistoryAutoClearLastLocalRunDate,
    };
  }

  private async getActorRole(
    actor: ActorContext,
    tenantId: string,
  ): Promise<Result<TenantMemberRole | null, AppError>> {
    if (actor.isSuperAdmin) {
      return ok(null);
    }

    try {
      const role = await this.userRepository.getMemberRole({ tenantId, userId: actor.userId });
      if (!role) {
        return err(new AppError('TENANT_ACCESS_DENIED', 'You do not have access to this tenant', 403));
      }

      return ok(role);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  private async assertTenantAccess(
    actor: ActorContext,
    tenantId: string,
    minimumRole: 'owner' | 'admin' | 'member',
  ): Promise<Result<void, AppError>> {
    if (actor.isSuperAdmin) {
      return ok(undefined);
    }

    const role = await this.userRepository.getMemberRole({ tenantId, userId: actor.userId });
    if (!role) {
      return err(new AppError('TENANT_ACCESS_DENIED', 'You do not have access to this tenant', 403));
    }

    const hierarchy: Record<'owner' | 'admin' | 'member', number> = {
      owner: 3,
      admin: 2,
      member: 1,
    };

    if (hierarchy[role] < hierarchy[minimumRole]) {
      return err(new AppError('TENANT_ROLE_DENIED', 'Insufficient tenant role', 403));
    }

    return ok(undefined);
  }

  public async getMe(actor: ActorContext): Promise<Result<{ userId: string; isSuperAdmin: boolean; tenantIds: string[] }, AppError>> {
    return ok({
      userId: actor.userId,
      isSuperAdmin: actor.isSuperAdmin,
      tenantIds: actor.tenantIds,
    });
  }

  public async getLinkedTenantForGuild(
    actor: ActorContext,
    input: { guildId: string },
  ): Promise<Result<{ tenantId: string; guildId: string } | null, AppError>> {
    try {
      const linked = await this.tenantRepository.getTenantByGuildId(input.guildId);
      if (!linked) {
        return ok(null);
      }

      const access = await this.assertTenantAccess(actor, linked.tenantId, 'member');
      if (access.isErr()) {
        return ok(null);
      }

      return ok(linked);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async listTenantGuilds(
    actor: ActorContext,
    input: { tenantId: string },
  ): Promise<Result<Array<{ guildId: string; guildName: string }>, AppError>> {
    try {
      const access = await this.assertTenantAccess(actor, input.tenantId, 'member');
      if (access.isErr()) {
        return err(access.error);
      }

      const guilds = await this.tenantRepository.listGuildsForTenant(input.tenantId);
      return ok(guilds);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async listTenantMembers(
    actor: ActorContext,
    input: { tenantId: string },
  ): Promise<
    Result<
      {
        currentRole: TenantMemberRole | null;
        members: Array<{
          userId: string;
          discordUserId: string;
          username: string;
          avatarUrl: string | null;
          role: TenantMemberRole;
          removable: boolean;
        }>;
        canManageMembers: boolean;
        canDisconnectGuild: boolean;
        canDisconnectTelegram: boolean;
      },
      AppError
    >
  > {
    try {
      const access = await this.assertTenantAccess(actor, input.tenantId, 'member');
      if (access.isErr()) {
        return err(access.error);
      }

      const actorRole = await this.getActorRole(actor, input.tenantId);
      if (actorRole.isErr()) {
        return err(actorRole.error);
      }

      const canManageMembers = actor.isSuperAdmin || actorRole.value === 'owner';
      const canDisconnectGuild = actor.isSuperAdmin || actorRole.value === 'owner';
      const canDisconnectTelegram = actor.isSuperAdmin || actorRole.value === 'owner' || actorRole.value === 'admin';

      const members = await this.tenantRepository.listTenantMembers(input.tenantId);
      return ok({
        currentRole: actorRole.value,
        members: members.map((member) => ({
          userId: member.userId,
          discordUserId: member.discordUserId,
          username: member.username,
          avatarUrl: member.avatarUrl,
          role: member.role,
          removable: canManageMembers && member.role !== 'owner' && member.userId !== actor.userId,
        })),
        canManageMembers,
        canDisconnectGuild,
        canDisconnectTelegram,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async addTenantMember(
    actor: ActorContext,
    input: {
      tenantId: string;
      discordUserId: string;
      username: string;
      avatarUrl: string | null;
      role: 'admin' | 'member';
    },
  ): Promise<
    Result<
      {
        userId: string;
        discordUserId: string;
        username: string;
        avatarUrl: string | null;
        role: 'admin' | 'member';
      },
      AppError
    >
  > {
    try {
      if (!actor.isSuperAdmin) {
        const access = await this.assertTenantAccess(actor, input.tenantId, 'owner');
        if (access.isErr()) {
          return err(access.error);
        }
      }

      const discordUserId = input.discordUserId.trim();
      const username = input.username.trim();
      const avatarUrl = input.avatarUrl?.trim() ? input.avatarUrl.trim() : null;

      if (!discordUserId) {
        return err(new AppError('TENANT_MEMBER_DISCORD_ID_REQUIRED', 'Select a Discord user to add.', 422));
      }

      if (!username) {
        return err(new AppError('TENANT_MEMBER_USERNAME_REQUIRED', 'Select a valid Discord user to add.', 422));
      }

      if (input.role !== 'admin' && input.role !== 'member') {
        return err(new AppError('TENANT_MEMBER_ROLE_INVALID', 'Select either admin or member access.', 422));
      }

      const user = await this.userRepository.upsertDiscordUser({
        discordUserId,
        username,
        avatarUrl,
      });

      const existingRole = await this.userRepository.getMemberRole({
        tenantId: input.tenantId,
        userId: user.id,
      });
      if (existingRole) {
        return err(
          new AppError(
            'TENANT_MEMBER_EXISTS',
            existingRole === 'owner'
              ? 'That Discord user already owns this workspace.'
              : 'That Discord user already has workspace access.',
            409,
          ),
        );
      }

      await this.tenantRepository.createTenantMember({
        tenantId: input.tenantId,
        userId: user.id,
        role: input.role,
      });

      return ok({
        userId: user.id,
        discordUserId: user.discordUserId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        role: input.role,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async listTenants(actor: ActorContext): Promise<Result<Array<{ id: string; name: string; status: string }>, AppError>> {
    try {
      if (actor.isSuperAdmin) {
        const all = await this.tenantRepository.listAllTenants();
        return ok(all.map((tenant) => ({ id: tenant.id, name: tenant.name, status: tenant.status })));
      }

      const rows = await this.tenantRepository.listTenantsForUser(actor.userId);
      return ok(rows.map((tenant) => ({ id: tenant.id, name: tenant.name, status: tenant.status })));
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async createTenant(
    actor: ActorContext,
    input: { name: string },
  ): Promise<Result<{ id: string; name: string; status: string }, AppError>> {
    try {
      const name = input.name.trim();
      if (!name) {
        return err(new AppError('TENANT_NAME_REQUIRED', 'Enter a workspace name before creating the workspace.', 422));
      }

      if (name.length > 120) {
        return err(new AppError('TENANT_NAME_TOO_LONG', 'Workspace name must be 120 characters or fewer.', 422));
      }

      const tenant = await this.tenantRepository.createTenant({
        name,
        ownerUserId: actor.userId,
      });

      return ok({
        id: tenant.id,
        name: tenant.name,
        status: tenant.status,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async updateTenant(
    actor: ActorContext,
    input: { tenantId: string; name?: string },
  ): Promise<Result<void, AppError>> {
    try {
      const access = await this.assertTenantAccess(actor, input.tenantId, 'admin');
      if (access.isErr()) {
        return err(access.error);
      }

      await this.tenantRepository.updateTenant({ tenantId: input.tenantId, name: input.name });
      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async deleteTenant(
    actor: ActorContext,
    input: { tenantId: string },
  ): Promise<Result<void, AppError>> {
    try {
      if (!actor.isSuperAdmin) {
        const access = await this.assertTenantAccess(actor, input.tenantId, 'owner');
        if (access.isErr()) {
          return err(access.error);
        }
      }

      await this.tenantRepository.deleteTenantCascade({ tenantId: input.tenantId });
      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async removeTenantMember(
    actor: ActorContext,
    input: { tenantId: string; userId: string },
  ): Promise<Result<void, AppError>> {
    try {
      if (!actor.isSuperAdmin) {
        const access = await this.assertTenantAccess(actor, input.tenantId, 'owner');
        if (access.isErr()) {
          return err(access.error);
        }
      }

      if (!input.userId.trim()) {
        return err(new AppError('TENANT_MEMBER_REQUIRED', 'Select a workspace member to remove.', 422));
      }

      const targetRole = await this.userRepository.getMemberRole({
        tenantId: input.tenantId,
        userId: input.userId,
      });
      if (!targetRole) {
        return err(new AppError('TENANT_MEMBER_NOT_FOUND', 'Workspace member not found.', 404));
      }

      if (targetRole === 'owner') {
        return err(new AppError('TENANT_OWNER_PROTECTED', 'The workspace owner cannot be removed.', 409));
      }

      if (input.userId === actor.userId) {
        return err(new AppError('TENANT_SELF_REMOVE_BLOCKED', 'Remove this account from a different admin session.', 409));
      }

      await this.tenantRepository.deleteTenantMember({
        tenantId: input.tenantId,
        userId: input.userId,
      });
      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async setTenantStatus(
    actor: ActorContext,
    input: { tenantId: string; status: 'active' | 'disabled' },
  ): Promise<Result<void, AppError>> {
    if (!actor.isSuperAdmin) {
      return err(new AppError('SUPER_ADMIN_REQUIRED', 'Super admin permission required', 403));
    }

    try {
      await this.tenantRepository.setTenantStatus(input);
      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async connectGuild(
    actor: ActorContext,
    input: {
      tenantId: string;
      guildId: string;
      guildName: string;
    },
  ): Promise<Result<void, AppError>> {
    try {
      const access = await this.assertTenantAccess(actor, input.tenantId, 'admin');
      if (access.isErr()) {
        return err(access.error);
      }

      await this.tenantRepository.connectGuild({
        tenantId: input.tenantId,
        guildId: input.guildId,
        guildName: input.guildName,
      });

      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async disconnectGuild(
    actor: ActorContext,
    input: { tenantId: string; guildId: string },
  ): Promise<Result<void, AppError>> {
    try {
      if (!actor.isSuperAdmin) {
        const access = await this.assertTenantAccess(actor, input.tenantId, 'owner');
        if (access.isErr()) {
          return err(access.error);
        }
      }

      const linkedGuild = await this.tenantRepository.getTenantGuild({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (!linkedGuild) {
        return err(new AppError('GUILD_NOT_CONNECTED', 'This Discord server is not linked to the selected workspace.', 404));
      }

      await this.tenantRepository.disconnectGuildCascade({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async disconnectTelegramLink(
    actor: ActorContext,
    input: { tenantId: string; guildId: string },
  ): Promise<Result<void, AppError>> {
    try {
      const access = await this.assertTenantAccess(actor, input.tenantId, 'admin');
      if (access.isErr()) {
        return err(access.error);
      }

      const linkedGuild = await this.tenantRepository.getTenantGuild({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (!linkedGuild) {
        return err(new AppError('GUILD_NOT_CONNECTED', 'This Discord server is not linked to the selected workspace.', 404));
      }

      const existingLink = await this.telegramLinkRepository.getByGuild({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (!existingLink) {
        return err(new AppError('TELEGRAM_LINK_NOT_FOUND', 'No Telegram chat is currently linked to this server.', 404));
      }

      await this.telegramLinkRepository.deleteByGuild({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async updateGuildConfig(
    actor: ActorContext,
    input: {
      tenantId: string;
      guildId: string;
      paidLogChannelId: string | null;
      staffRoleIds: string[];
      defaultCurrency: string;
      couponsEnabled: boolean;
      pointsEnabled: boolean;
      referralsEnabled: boolean;
      telegramEnabled: boolean;
      tipEnabled: boolean;
      pointsEarnCategoryKeys: string[];
      pointsRedeemCategoryKeys: string[];
      pointValueMinor: number;
      referralRewardMinor: number;
      referralRewardCategoryKeys: string[];
      referralLogChannelId: string | null;
      referralThankYouTemplate: string;
      referralSubmissionTemplate: string;
      ticketMetadataKey: string;
      joinGateEnabled?: boolean;
      joinGateFallbackChannelId?: string | null;
      joinGateVerifiedRoleId?: string | null;
      joinGateTicketCategoryId?: string | null;
      joinGateCurrentLookupChannelId?: string | null;
      joinGateNewLookupChannelId?: string | null;
      salesHistoryAutoClearEnabled?: boolean;
      salesHistoryAutoClearFrequency?: SalesHistoryAutoClearFrequency;
      salesHistoryAutoClearLocalTimeHhMm?: string;
      salesHistoryAutoClearTimezone?: string;
      salesHistoryAutoClearDayOfWeek?: number | null;
      salesHistoryAutoClearDayOfMonth?: number | null;
    },
  ): Promise<Result<GuildConfigSummary, AppError>> {
    try {
      const access = await this.assertTenantAccess(actor, input.tenantId, 'admin');
      if (access.isErr()) {
        return err(access.error);
      }

      const existingConfig = await this.tenantRepository.getGuildConfig({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      const resolvedJoinGateConfig = {
        joinGateEnabled:
          input.joinGateEnabled !== undefined ? input.joinGateEnabled : existingConfig?.joinGateEnabled ?? false,
        joinGateFallbackChannelId:
          input.joinGateFallbackChannelId !== undefined
            ? input.joinGateFallbackChannelId
            : existingConfig?.joinGateFallbackChannelId ?? null,
        joinGateVerifiedRoleId:
          input.joinGateVerifiedRoleId !== undefined
            ? input.joinGateVerifiedRoleId
            : existingConfig?.joinGateVerifiedRoleId ?? null,
        joinGateTicketCategoryId:
          input.joinGateTicketCategoryId !== undefined
            ? input.joinGateTicketCategoryId
            : existingConfig?.joinGateTicketCategoryId ?? null,
        joinGateCurrentLookupChannelId:
          input.joinGateCurrentLookupChannelId !== undefined
            ? input.joinGateCurrentLookupChannelId
            : existingConfig?.joinGateCurrentLookupChannelId ?? null,
        joinGateNewLookupChannelId:
          input.joinGateNewLookupChannelId !== undefined
            ? input.joinGateNewLookupChannelId
            : existingConfig?.joinGateNewLookupChannelId ?? null,
      };
      const resolvedSalesHistoryConfig = {
        salesHistoryClearedAt: existingConfig?.salesHistoryClearedAt ?? null,
        salesHistoryAutoClearEnabled: existingConfig?.salesHistoryAutoClearEnabled ?? false,
        salesHistoryAutoClearFrequency: existingConfig?.salesHistoryAutoClearFrequency ?? 'daily',
        salesHistoryAutoClearLocalTimeHhMm: existingConfig?.salesHistoryAutoClearLocalTimeHhMm ?? '00:00',
        salesHistoryAutoClearTimezone: existingConfig?.salesHistoryAutoClearTimezone ?? 'UTC',
        salesHistoryAutoClearDayOfWeek: existingConfig?.salesHistoryAutoClearDayOfWeek ?? null,
        salesHistoryAutoClearDayOfMonth: existingConfig?.salesHistoryAutoClearDayOfMonth ?? null,
        salesHistoryAutoClearNextRunAtUtc: existingConfig?.salesHistoryAutoClearNextRunAtUtc ?? null,
        salesHistoryAutoClearLastRunAtUtc: existingConfig?.salesHistoryAutoClearLastRunAtUtc ?? null,
        salesHistoryAutoClearLastLocalRunDate: existingConfig?.salesHistoryAutoClearLastLocalRunDate ?? null,
      };

      const joinGateValidation = validateJoinGateConfig(resolvedJoinGateConfig);
      if (joinGateValidation.isErr()) {
        return err(joinGateValidation.error);
      }

      const nextSalesHistoryConfig = parseSalesHistoryAutoClearConfig({
        enabled:
          input.salesHistoryAutoClearEnabled !== undefined
            ? input.salesHistoryAutoClearEnabled
            : resolvedSalesHistoryConfig.salesHistoryAutoClearEnabled,
        frequency:
          input.salesHistoryAutoClearFrequency ?? resolvedSalesHistoryConfig.salesHistoryAutoClearFrequency,
        localTimeHhMm:
          input.salesHistoryAutoClearLocalTimeHhMm ??
          resolvedSalesHistoryConfig.salesHistoryAutoClearLocalTimeHhMm,
        timezone:
          input.salesHistoryAutoClearTimezone ?? resolvedSalesHistoryConfig.salesHistoryAutoClearTimezone,
        dayOfWeek:
          input.salesHistoryAutoClearDayOfWeek !== undefined
            ? input.salesHistoryAutoClearDayOfWeek
            : resolvedSalesHistoryConfig.salesHistoryAutoClearDayOfWeek,
        dayOfMonth:
          input.salesHistoryAutoClearDayOfMonth !== undefined
            ? input.salesHistoryAutoClearDayOfMonth
            : resolvedSalesHistoryConfig.salesHistoryAutoClearDayOfMonth,
      });
      const currentSalesHistoryConfig = parseSalesHistoryAutoClearConfig({
        enabled: resolvedSalesHistoryConfig.salesHistoryAutoClearEnabled,
        frequency: resolvedSalesHistoryConfig.salesHistoryAutoClearFrequency,
        localTimeHhMm: resolvedSalesHistoryConfig.salesHistoryAutoClearLocalTimeHhMm,
        timezone: resolvedSalesHistoryConfig.salesHistoryAutoClearTimezone,
        dayOfWeek: resolvedSalesHistoryConfig.salesHistoryAutoClearDayOfWeek,
        dayOfMonth: resolvedSalesHistoryConfig.salesHistoryAutoClearDayOfMonth,
      });
      const salesHistoryPatternChanged = existingConfig
        ? !hasSameSalesHistoryAutoClearPattern(currentSalesHistoryConfig, nextSalesHistoryConfig)
        : true;
      const salesHistoryLastLocalRunDate = salesHistoryPatternChanged
        ? null
        : resolvedSalesHistoryConfig.salesHistoryAutoClearLastLocalRunDate;

      const config = await this.tenantRepository.upsertGuildConfig({
        ...input,
        ...resolvedJoinGateConfig,
        ...resolvedSalesHistoryConfig,
        salesHistoryAutoClearEnabled: nextSalesHistoryConfig.enabled,
        salesHistoryAutoClearFrequency: nextSalesHistoryConfig.frequency,
        salesHistoryAutoClearLocalTimeHhMm: nextSalesHistoryConfig.localTimeHhMm,
        salesHistoryAutoClearTimezone: nextSalesHistoryConfig.timezone,
        salesHistoryAutoClearDayOfWeek: nextSalesHistoryConfig.dayOfWeek,
        salesHistoryAutoClearDayOfMonth: nextSalesHistoryConfig.dayOfMonth,
        salesHistoryAutoClearNextRunAtUtc: nextSalesHistoryConfig.enabled
          ? computeNextRunAtUtc({
              frequency: nextSalesHistoryConfig.frequency,
              localTimeHhMm: nextSalesHistoryConfig.localTimeHhMm,
              timezone: nextSalesHistoryConfig.timezone,
              dayOfWeek: nextSalesHistoryConfig.dayOfWeek,
              dayOfMonth: nextSalesHistoryConfig.dayOfMonth,
              now: new Date(),
              lastLocalRunDate: salesHistoryLastLocalRunDate,
            })
          : null,
        salesHistoryAutoClearLastLocalRunDate: salesHistoryLastLocalRunDate,
      });
      return ok(this.mapGuildConfigSummary(config));
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async getGuildConfig(
    actor: ActorContext,
    input: { tenantId: string; guildId: string },
  ): Promise<Result<GuildConfigSummary, AppError>> {
    try {
      const access = await this.assertTenantAccess(actor, input.tenantId, 'member');
      if (access.isErr()) {
        return err(access.error);
      }

      const config = await this.tenantRepository.getGuildConfig(input);
      if (!config) {
        return err(new AppError('GUILD_CONFIG_NOT_FOUND', 'Guild configuration not found', 404));
      }

      return ok(this.mapGuildConfigSummary(config));
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }
}


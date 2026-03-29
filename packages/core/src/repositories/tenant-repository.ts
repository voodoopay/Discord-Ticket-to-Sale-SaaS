import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import {
  auditLogs,
  channelNukeAuthorizedUsers,
  channelNukeRuns,
  channelNukeSchedules,
  customerPointsAccounts,
  customerPointsLedger,
  customerFirstPaidOrders,
  discountCoupons,
  guildConfigs,
  joinGateAuthorizedUsers,
  orderNotesCache,
  orderSessions,
  ordersPaid,
  productFormFields,
  products,
  productVariants,
  joinGateEmailIndex,
  joinGateMembers,
  referralClaims,
  telegramChatLinks,
  tenantGuilds,
  tenantIntegrationsVoodooPay,
  tenantIntegrationsWoo,
  tenantMembers,
  tenants,
  ticketChannelMetadata,
  users,
  webhookEvents,
} from '../infra/db/schema/index.js';
import type { SalesHistoryAutoClearFrequency } from '../services/sales-history-schedule.js';

export type TenantRecord = {
  id: string;
  name: string;
  status: 'active' | 'disabled';
  ownerUserId: string;
  createdAt: Date;
};

export type TenantMemberRecord = {
  userId: string;
  discordUserId: string;
  username: string;
  avatarUrl: string | null;
  role: 'owner' | 'admin' | 'member';
  createdAt: Date;
};

export type GuildConfigRecord = {
  id: string;
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
  joinGateStaffRoleIds?: string[];
  joinGateFallbackChannelId?: string | null;
  joinGateVerifiedRoleId?: string | null;
  joinGateTicketCategoryId?: string | null;
  joinGateCurrentLookupChannelId?: string | null;
  joinGateNewLookupChannelId?: string | null;
  joinGatePanelTitle?: string | null;
  joinGatePanelMessage?: string | null;
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

function mapGuildConfigRow(row: typeof guildConfigs.$inferSelect): GuildConfigRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guildId: row.guildId,
    paidLogChannelId: row.paidLogChannelId,
    staffRoleIds: row.staffRoleIds,
    defaultCurrency: row.defaultCurrency,
    couponsEnabled: row.couponsEnabled,
    pointsEnabled: row.pointsEnabled,
    referralsEnabled: row.referralsEnabled,
    telegramEnabled: row.telegramEnabled,
    tipEnabled: row.tipEnabled,
    pointsEarnCategoryKeys: row.pointsEarnCategoryKeys,
    pointsRedeemCategoryKeys: row.pointsRedeemCategoryKeys,
    pointValueMinor: row.pointValueMinor,
    referralRewardMinor: row.referralRewardMinor,
    referralRewardCategoryKeys: row.referralRewardCategoryKeys,
    referralLogChannelId: row.referralLogChannelId,
    referralThankYouTemplate: row.referralThankYouTemplate,
    referralSubmissionTemplate: row.referralSubmissionTemplate,
    ticketMetadataKey: row.ticketMetadataKey,
    joinGateEnabled: row.joinGateEnabled ?? false,
    joinGateStaffRoleIds: row.joinGateStaffRoleIds ?? [],
    joinGateFallbackChannelId: row.joinGateFallbackChannelId ?? null,
    joinGateVerifiedRoleId: row.joinGateVerifiedRoleId ?? null,
    joinGateTicketCategoryId: row.joinGateTicketCategoryId ?? null,
    joinGateCurrentLookupChannelId: row.joinGateCurrentLookupChannelId ?? null,
    joinGateNewLookupChannelId: row.joinGateNewLookupChannelId ?? null,
    joinGatePanelTitle: row.joinGatePanelTitle ?? null,
    joinGatePanelMessage: row.joinGatePanelMessage ?? null,
    salesHistoryClearedAt: row.salesHistoryClearedAt ?? null,
    salesHistoryAutoClearEnabled: row.salesHistoryAutoClearEnabled,
    salesHistoryAutoClearFrequency: row.salesHistoryAutoClearFrequency,
    salesHistoryAutoClearLocalTimeHhMm: row.salesHistoryAutoClearLocalTimeHhMm,
    salesHistoryAutoClearTimezone: row.salesHistoryAutoClearTimezone,
    salesHistoryAutoClearDayOfWeek: row.salesHistoryAutoClearDayOfWeek ?? null,
    salesHistoryAutoClearDayOfMonth: row.salesHistoryAutoClearDayOfMonth ?? null,
    salesHistoryAutoClearNextRunAtUtc: row.salesHistoryAutoClearNextRunAtUtc ?? null,
    salesHistoryAutoClearLastRunAtUtc: row.salesHistoryAutoClearLastRunAtUtc ?? null,
    salesHistoryAutoClearLastLocalRunDate: row.salesHistoryAutoClearLastLocalRunDate ?? null,
  };
}

export class TenantRepository {
  private readonly db = getDb();

  public async createTenant(input: {
    name: string;
    ownerUserId: string;
  }): Promise<TenantRecord> {
    const tenantId = ulid();

    await this.db.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id: tenantId,
        name: input.name,
        ownerUserId: input.ownerUserId,
        status: 'active',
      });

      await tx.insert(tenantMembers).values({
        id: ulid(),
        tenantId,
        userId: input.ownerUserId,
        role: 'owner',
      });
    });

    const created = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!created) {
      throw new Error('Failed to create tenant');
    }

    return {
      id: created.id,
      name: created.name,
      status: created.status,
      ownerUserId: created.ownerUserId,
      createdAt: created.createdAt,
    };
  }

  public async listTenantsForUser(userId: string): Promise<TenantRecord[]> {
    const memberships = await this.db.query.tenantMembers.findMany({
      where: eq(tenantMembers.userId, userId),
      orderBy: [asc(tenantMembers.createdAt)],
    });

    if (memberships.length === 0) {
      return [];
    }

    const items: TenantRecord[] = [];
    for (const membership of memberships) {
      const tenant = await this.db.query.tenants.findFirst({
        where: eq(tenants.id, membership.tenantId),
      });

      if (tenant) {
        items.push({
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
          ownerUserId: tenant.ownerUserId,
          createdAt: tenant.createdAt,
        });
      }
    }

    return items;
  }

  public async listTenantMembers(tenantId: string): Promise<TenantMemberRecord[]> {
    const rows = await this.db
      .select({
        userId: tenantMembers.userId,
        discordUserId: users.discordUserId,
        username: users.username,
        avatarUrl: users.avatarUrl,
        role: tenantMembers.role,
        createdAt: tenantMembers.createdAt,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(eq(tenantMembers.tenantId, tenantId))
      .orderBy(asc(tenantMembers.createdAt), asc(users.username));

    const hierarchy: Record<'owner' | 'admin' | 'member', number> = {
      owner: 3,
      admin: 2,
      member: 1,
    };

    return rows
      .map((row) => ({
        userId: row.userId,
        discordUserId: row.discordUserId,
        username: row.username,
        avatarUrl: row.avatarUrl ?? null,
        role: row.role,
        createdAt: row.createdAt,
      }))
      .sort((left, right) => {
        const roleDelta = hierarchy[right.role] - hierarchy[left.role];
        if (roleDelta !== 0) {
          return roleDelta;
        }

        return left.username.localeCompare(right.username);
      });
  }

  public async createTenantMember(input: {
    tenantId: string;
    userId: string;
    role: 'admin' | 'member';
  }): Promise<void> {
    await this.db.insert(tenantMembers).values({
      id: ulid(),
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
    });
  }

  public async listAllTenants(): Promise<TenantRecord[]> {
    const rows = await this.db.query.tenants.findMany({
      orderBy: [desc(tenants.createdAt)],
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      ownerUserId: row.ownerUserId,
      createdAt: row.createdAt,
    }));
  }

  public async getTenantById(tenantId: string): Promise<TenantRecord | null> {
    const row = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      status: row.status,
      ownerUserId: row.ownerUserId,
      createdAt: row.createdAt,
    };
  }

  public async updateTenant(input: {
    tenantId: string;
    name?: string;
  }): Promise<void> {
    await this.db
      .update(tenants)
      .set({
        ...(input.name ? { name: input.name } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, input.tenantId));
  }

  public async setTenantStatus(input: {
    tenantId: string;
    status: 'active' | 'disabled';
  }): Promise<void> {
    await this.db
      .update(tenants)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(tenants.id, input.tenantId));
  }

  public async connectGuild(input: {
    tenantId: string;
    guildId: string;
    guildName: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Keep ownership deterministic: one Discord server maps to one workspace.
      await tx
        .delete(guildConfigs)
        .where(and(eq(guildConfigs.guildId, input.guildId), ne(guildConfigs.tenantId, input.tenantId)));
      await tx
        .delete(tenantGuilds)
        .where(and(eq(tenantGuilds.guildId, input.guildId), ne(tenantGuilds.tenantId, input.tenantId)));

      const existingTenantGuild = await tx
        .select({ id: tenantGuilds.id })
        .from(tenantGuilds)
        .where(and(eq(tenantGuilds.tenantId, input.tenantId), eq(tenantGuilds.guildId, input.guildId)))
        .limit(1);

      const existingTenantGuildRow = existingTenantGuild[0];
      if (existingTenantGuildRow) {
        await tx
          .update(tenantGuilds)
          .set({ guildName: input.guildName, updatedAt: new Date() })
          .where(eq(tenantGuilds.id, existingTenantGuildRow.id));
      } else {
        await tx.insert(tenantGuilds).values({
          id: ulid(),
          tenantId: input.tenantId,
          guildId: input.guildId,
          guildName: input.guildName,
        });
      }

      const existingConfig = await tx
        .select({ id: guildConfigs.id })
        .from(guildConfigs)
        .where(and(eq(guildConfigs.tenantId, input.tenantId), eq(guildConfigs.guildId, input.guildId)))
        .limit(1);

      if (existingConfig.length === 0) {
        await tx.insert(guildConfigs).values({
          id: ulid(),
          tenantId: input.tenantId,
          guildId: input.guildId,
          paidLogChannelId: null,
          staffRoleIds: [],
          defaultCurrency: 'GBP',
          couponsEnabled: true,
          pointsEnabled: true,
          referralsEnabled: true,
          telegramEnabled: false,
          tipEnabled: false,
          pointsEarnCategoryKeys: [],
          pointsRedeemCategoryKeys: [],
          pointValueMinor: 1,
          referralRewardMinor: 0,
          referralRewardCategoryKeys: [],
          referralLogChannelId: null,
          referralThankYouTemplate:
            'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.',
          referralSubmissionTemplate:
            'Referral submitted successfully. We will reward points automatically after the first paid order.',
          ticketMetadataKey: 'isTicket',
          joinGateEnabled: false,
          joinGateStaffRoleIds: [],
          joinGateFallbackChannelId: null,
          joinGateVerifiedRoleId: null,
          joinGateTicketCategoryId: null,
          joinGateCurrentLookupChannelId: null,
          joinGateNewLookupChannelId: null,
          joinGatePanelTitle: null,
          joinGatePanelMessage: null,
        });
      }
    });
  }

  public async listGuildsForTenant(tenantId: string): Promise<Array<{ guildId: string; guildName: string }>> {
    const rows = await this.db.query.tenantGuilds.findMany({
      where: eq(tenantGuilds.tenantId, tenantId),
      orderBy: [asc(tenantGuilds.guildName)],
    });

    return rows.map((row) => ({ guildId: row.guildId, guildName: row.guildName }));
  }

  public async getTenantByGuildId(guildId: string): Promise<{ tenantId: string; guildId: string } | null> {
    const rows = await this.db
      .select({
        tenantId: tenantGuilds.tenantId,
        guildId: tenantGuilds.guildId,
        tenantStatus: tenants.status,
      })
      .from(tenantGuilds)
      .innerJoin(tenants, eq(tenants.id, tenantGuilds.tenantId))
      .where(eq(tenantGuilds.guildId, guildId))
      .orderBy(desc(tenantGuilds.updatedAt), desc(tenantGuilds.createdAt));

    if (rows.length === 0) {
      return null;
    }

    const active = rows.find((row) => row.tenantStatus === 'active');
    const selected = active ?? rows[0];
    if (!selected) {
      return null;
    }

    return {
      tenantId: selected.tenantId,
      guildId: selected.guildId,
    };
  }

  public async getTenantGuild(input: {
    tenantId: string;
    guildId: string;
  }): Promise<{ tenantId: string; guildId: string; guildName: string } | null> {
    const row = await this.db.query.tenantGuilds.findFirst({
      where: and(eq(tenantGuilds.tenantId, input.tenantId), eq(tenantGuilds.guildId, input.guildId)),
    });

    if (!row) {
      return null;
    }

    return {
      tenantId: row.tenantId,
      guildId: row.guildId,
      guildName: row.guildName,
    };
  }

  public async getGuildConfig(input: {
    tenantId: string;
    guildId: string;
  }): Promise<GuildConfigRecord | null> {
    const row = await this.db.query.guildConfigs.findFirst({
      where: and(eq(guildConfigs.tenantId, input.tenantId), eq(guildConfigs.guildId, input.guildId)),
    });

    if (!row) {
      return null;
    }

    return mapGuildConfigRow(row);
  }

  public async deleteTenantMember(input: {
    tenantId: string;
    userId: string;
  }): Promise<void> {
    await this.db
      .delete(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, input.tenantId), eq(tenantMembers.userId, input.userId)));
  }

  public async upsertGuildConfig(input: {
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
    joinGateStaffRoleIds?: string[];
    joinGateFallbackChannelId?: string | null;
    joinGateVerifiedRoleId?: string | null;
    joinGateTicketCategoryId?: string | null;
    joinGateCurrentLookupChannelId?: string | null;
    joinGateNewLookupChannelId?: string | null;
    joinGatePanelTitle?: string | null;
    joinGatePanelMessage?: string | null;
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
  }): Promise<GuildConfigRecord> {
    const existing = await this.db.query.guildConfigs.findFirst({
      where: and(eq(guildConfigs.tenantId, input.tenantId), eq(guildConfigs.guildId, input.guildId)),
    });

    if (existing) {
      const joinGateEnabled =
        input.joinGateEnabled !== undefined ? input.joinGateEnabled : existing.joinGateEnabled;
      const joinGateStaffRoleIds =
        input.joinGateStaffRoleIds !== undefined ? input.joinGateStaffRoleIds : existing.joinGateStaffRoleIds;
      const joinGateFallbackChannelId =
        input.joinGateFallbackChannelId !== undefined
          ? input.joinGateFallbackChannelId
          : existing.joinGateFallbackChannelId;
      const joinGateVerifiedRoleId =
        input.joinGateVerifiedRoleId !== undefined ? input.joinGateVerifiedRoleId : existing.joinGateVerifiedRoleId;
      const joinGateTicketCategoryId =
        input.joinGateTicketCategoryId !== undefined
          ? input.joinGateTicketCategoryId
          : existing.joinGateTicketCategoryId;
      const joinGateCurrentLookupChannelId =
        input.joinGateCurrentLookupChannelId !== undefined
          ? input.joinGateCurrentLookupChannelId
          : existing.joinGateCurrentLookupChannelId;
      const joinGateNewLookupChannelId =
        input.joinGateNewLookupChannelId !== undefined
          ? input.joinGateNewLookupChannelId
          : existing.joinGateNewLookupChannelId;
      const joinGatePanelTitle =
        input.joinGatePanelTitle !== undefined ? input.joinGatePanelTitle : existing.joinGatePanelTitle;
      const joinGatePanelMessage =
        input.joinGatePanelMessage !== undefined ? input.joinGatePanelMessage : existing.joinGatePanelMessage;

      await this.db
        .update(guildConfigs)
        .set({
          paidLogChannelId: input.paidLogChannelId,
          staffRoleIds: input.staffRoleIds,
          defaultCurrency: input.defaultCurrency,
          couponsEnabled: input.couponsEnabled,
          pointsEnabled: input.pointsEnabled,
          referralsEnabled: input.referralsEnabled,
          telegramEnabled: input.telegramEnabled,
          tipEnabled: input.tipEnabled,
          pointsEarnCategoryKeys: input.pointsEarnCategoryKeys,
          pointsRedeemCategoryKeys: input.pointsRedeemCategoryKeys,
          pointValueMinor: input.pointValueMinor,
          referralRewardMinor: input.referralRewardMinor,
          referralRewardCategoryKeys: input.referralRewardCategoryKeys,
          referralLogChannelId: input.referralLogChannelId,
          referralThankYouTemplate: input.referralThankYouTemplate,
          referralSubmissionTemplate: input.referralSubmissionTemplate,
          ticketMetadataKey: input.ticketMetadataKey,
          joinGateEnabled,
          joinGateStaffRoleIds,
          joinGateFallbackChannelId,
          joinGateVerifiedRoleId,
          joinGateTicketCategoryId,
          joinGateCurrentLookupChannelId,
          joinGateNewLookupChannelId,
          joinGatePanelTitle,
          joinGatePanelMessage,
          salesHistoryClearedAt: input.salesHistoryClearedAt,
          salesHistoryAutoClearEnabled: input.salesHistoryAutoClearEnabled,
          salesHistoryAutoClearFrequency: input.salesHistoryAutoClearFrequency,
          salesHistoryAutoClearLocalTimeHhMm: input.salesHistoryAutoClearLocalTimeHhMm,
          salesHistoryAutoClearTimezone: input.salesHistoryAutoClearTimezone,
          salesHistoryAutoClearDayOfWeek: input.salesHistoryAutoClearDayOfWeek,
          salesHistoryAutoClearDayOfMonth: input.salesHistoryAutoClearDayOfMonth,
          salesHistoryAutoClearNextRunAtUtc: input.salesHistoryAutoClearNextRunAtUtc,
          salesHistoryAutoClearLastRunAtUtc: input.salesHistoryAutoClearLastRunAtUtc,
          salesHistoryAutoClearLastLocalRunDate: input.salesHistoryAutoClearLastLocalRunDate,
          updatedAt: new Date(),
        })
        .where(eq(guildConfigs.id, existing.id));
    } else {
      const joinGateEnabledValue = input.joinGateEnabled ?? false;
      const joinGateStaffRoleIdsValue = input.joinGateStaffRoleIds ?? [];
      const joinGateFallbackChannelIdValue = input.joinGateFallbackChannelId ?? null;
      const joinGateVerifiedRoleIdValue = input.joinGateVerifiedRoleId ?? null;
      const joinGateTicketCategoryIdValue = input.joinGateTicketCategoryId ?? null;
      const joinGateCurrentLookupChannelIdValue = input.joinGateCurrentLookupChannelId ?? null;
      const joinGateNewLookupChannelIdValue = input.joinGateNewLookupChannelId ?? null;
      const joinGatePanelTitleValue = input.joinGatePanelTitle ?? null;
      const joinGatePanelMessageValue = input.joinGatePanelMessage ?? null;
      const id = ulid();
      await this.db.insert(guildConfigs).values({
        id,
        tenantId: input.tenantId,
        guildId: input.guildId,
        paidLogChannelId: input.paidLogChannelId,
        staffRoleIds: input.staffRoleIds,
        defaultCurrency: input.defaultCurrency,
        couponsEnabled: input.couponsEnabled,
        pointsEnabled: input.pointsEnabled,
        referralsEnabled: input.referralsEnabled,
        telegramEnabled: input.telegramEnabled,
        tipEnabled: input.tipEnabled,
        pointsEarnCategoryKeys: input.pointsEarnCategoryKeys,
        pointsRedeemCategoryKeys: input.pointsRedeemCategoryKeys,
        pointValueMinor: input.pointValueMinor,
        referralRewardMinor: input.referralRewardMinor,
        referralRewardCategoryKeys: input.referralRewardCategoryKeys,
        referralLogChannelId: input.referralLogChannelId,
        referralThankYouTemplate: input.referralThankYouTemplate,
        referralSubmissionTemplate: input.referralSubmissionTemplate,
        ticketMetadataKey: input.ticketMetadataKey,
        joinGateEnabled: joinGateEnabledValue,
        joinGateStaffRoleIds: joinGateStaffRoleIdsValue,
        joinGateFallbackChannelId: joinGateFallbackChannelIdValue,
        joinGateVerifiedRoleId: joinGateVerifiedRoleIdValue,
        joinGateTicketCategoryId: joinGateTicketCategoryIdValue,
        joinGateCurrentLookupChannelId: joinGateCurrentLookupChannelIdValue,
        joinGateNewLookupChannelId: joinGateNewLookupChannelIdValue,
        joinGatePanelTitle: joinGatePanelTitleValue,
        joinGatePanelMessage: joinGatePanelMessageValue,
        salesHistoryClearedAt: input.salesHistoryClearedAt,
        salesHistoryAutoClearEnabled: input.salesHistoryAutoClearEnabled,
        salesHistoryAutoClearFrequency: input.salesHistoryAutoClearFrequency,
        salesHistoryAutoClearLocalTimeHhMm: input.salesHistoryAutoClearLocalTimeHhMm,
        salesHistoryAutoClearTimezone: input.salesHistoryAutoClearTimezone,
        salesHistoryAutoClearDayOfWeek: input.salesHistoryAutoClearDayOfWeek,
        salesHistoryAutoClearDayOfMonth: input.salesHistoryAutoClearDayOfMonth,
        salesHistoryAutoClearNextRunAtUtc: input.salesHistoryAutoClearNextRunAtUtc,
        salesHistoryAutoClearLastRunAtUtc: input.salesHistoryAutoClearLastRunAtUtc,
        salesHistoryAutoClearLastLocalRunDate: input.salesHistoryAutoClearLastLocalRunDate,
      });
    }

    const record = await this.getGuildConfig({
      tenantId: input.tenantId,
      guildId: input.guildId,
    });
    if (!record) {
      throw new Error('Failed to upsert guild config');
    }

    return record;
  }

  public async deleteTenantCascade(input: { tenantId: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(customerFirstPaidOrders).where(eq(customerFirstPaidOrders.tenantId, input.tenantId));
      await tx.delete(referralClaims).where(eq(referralClaims.tenantId, input.tenantId));
      await tx.delete(orderNotesCache).where(eq(orderNotesCache.tenantId, input.tenantId));
      await tx.delete(ordersPaid).where(eq(ordersPaid.tenantId, input.tenantId));
      await tx.delete(webhookEvents).where(eq(webhookEvents.tenantId, input.tenantId));
      await tx.delete(orderSessions).where(eq(orderSessions.tenantId, input.tenantId));
      await tx.delete(joinGateEmailIndex).where(eq(joinGateEmailIndex.tenantId, input.tenantId));
      await tx.delete(joinGateMembers).where(eq(joinGateMembers.tenantId, input.tenantId));
      await tx.delete(ticketChannelMetadata).where(eq(ticketChannelMetadata.tenantId, input.tenantId));

      await tx.delete(productFormFields).where(eq(productFormFields.tenantId, input.tenantId));
      await tx.delete(productVariants).where(eq(productVariants.tenantId, input.tenantId));
      await tx.delete(products).where(eq(products.tenantId, input.tenantId));
      await tx.delete(discountCoupons).where(eq(discountCoupons.tenantId, input.tenantId));

      await tx
        .delete(tenantIntegrationsVoodooPay)
        .where(eq(tenantIntegrationsVoodooPay.tenantId, input.tenantId));
      await tx.delete(tenantIntegrationsWoo).where(eq(tenantIntegrationsWoo.tenantId, input.tenantId));

      await tx.delete(guildConfigs).where(eq(guildConfigs.tenantId, input.tenantId));
      await tx.delete(telegramChatLinks).where(eq(telegramChatLinks.tenantId, input.tenantId));
      await tx.delete(tenantGuilds).where(eq(tenantGuilds.tenantId, input.tenantId));
      await tx.delete(tenantMembers).where(eq(tenantMembers.tenantId, input.tenantId));
      await tx.delete(auditLogs).where(eq(auditLogs.tenantId, input.tenantId));
      await tx.delete(tenants).where(eq(tenants.id, input.tenantId));
    });
  }

  public async disconnectGuildCascade(input: { tenantId: string; guildId: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(customerFirstPaidOrders)
        .where(and(eq(customerFirstPaidOrders.tenantId, input.tenantId), eq(customerFirstPaidOrders.guildId, input.guildId)));
      await tx
        .delete(referralClaims)
        .where(and(eq(referralClaims.tenantId, input.tenantId), eq(referralClaims.guildId, input.guildId)));
      await tx
        .delete(orderNotesCache)
        .where(and(eq(orderNotesCache.tenantId, input.tenantId), eq(orderNotesCache.guildId, input.guildId)));
      await tx
        .delete(ordersPaid)
        .where(and(eq(ordersPaid.tenantId, input.tenantId), eq(ordersPaid.guildId, input.guildId)));
      await tx
        .delete(webhookEvents)
        .where(and(eq(webhookEvents.tenantId, input.tenantId), eq(webhookEvents.guildId, input.guildId)));
      await tx
        .delete(customerPointsLedger)
        .where(and(eq(customerPointsLedger.tenantId, input.tenantId), eq(customerPointsLedger.guildId, input.guildId)));
      await tx
        .delete(customerPointsAccounts)
        .where(and(eq(customerPointsAccounts.tenantId, input.tenantId), eq(customerPointsAccounts.guildId, input.guildId)));
      await tx
        .delete(orderSessions)
        .where(and(eq(orderSessions.tenantId, input.tenantId), eq(orderSessions.guildId, input.guildId)));

      await tx
        .delete(channelNukeRuns)
        .where(and(eq(channelNukeRuns.tenantId, input.tenantId), eq(channelNukeRuns.guildId, input.guildId)));
      await tx
        .delete(channelNukeSchedules)
        .where(and(eq(channelNukeSchedules.tenantId, input.tenantId), eq(channelNukeSchedules.guildId, input.guildId)));
      await tx
        .delete(channelNukeAuthorizedUsers)
        .where(
          and(eq(channelNukeAuthorizedUsers.tenantId, input.tenantId), eq(channelNukeAuthorizedUsers.guildId, input.guildId)),
        );

      await tx
        .delete(joinGateEmailIndex)
        .where(and(eq(joinGateEmailIndex.tenantId, input.tenantId), eq(joinGateEmailIndex.guildId, input.guildId)));
      await tx
        .delete(joinGateMembers)
        .where(and(eq(joinGateMembers.tenantId, input.tenantId), eq(joinGateMembers.guildId, input.guildId)));
      await tx
        .delete(joinGateAuthorizedUsers)
        .where(and(eq(joinGateAuthorizedUsers.tenantId, input.tenantId), eq(joinGateAuthorizedUsers.guildId, input.guildId)));
      await tx
        .delete(ticketChannelMetadata)
        .where(and(eq(ticketChannelMetadata.tenantId, input.tenantId), eq(ticketChannelMetadata.guildId, input.guildId)));

      await tx
        .delete(productFormFields)
        .where(and(eq(productFormFields.tenantId, input.tenantId), eq(productFormFields.guildId, input.guildId)));
      await tx
        .delete(productVariants)
        .where(and(eq(productVariants.tenantId, input.tenantId), eq(productVariants.guildId, input.guildId)));
      await tx.delete(products).where(and(eq(products.tenantId, input.tenantId), eq(products.guildId, input.guildId)));
      await tx
        .delete(discountCoupons)
        .where(and(eq(discountCoupons.tenantId, input.tenantId), eq(discountCoupons.guildId, input.guildId)));

      await tx
        .delete(tenantIntegrationsVoodooPay)
        .where(
          and(eq(tenantIntegrationsVoodooPay.tenantId, input.tenantId), eq(tenantIntegrationsVoodooPay.guildId, input.guildId)),
        );
      await tx
        .delete(tenantIntegrationsWoo)
        .where(and(eq(tenantIntegrationsWoo.tenantId, input.tenantId), eq(tenantIntegrationsWoo.guildId, input.guildId)));

      await tx
        .delete(guildConfigs)
        .where(and(eq(guildConfigs.tenantId, input.tenantId), eq(guildConfigs.guildId, input.guildId)));
      await tx
        .delete(telegramChatLinks)
        .where(and(eq(telegramChatLinks.tenantId, input.tenantId), eq(telegramChatLinks.guildId, input.guildId)));
      await tx
        .delete(tenantGuilds)
        .where(and(eq(tenantGuilds.tenantId, input.tenantId), eq(tenantGuilds.guildId, input.guildId)));
    });
  }
}

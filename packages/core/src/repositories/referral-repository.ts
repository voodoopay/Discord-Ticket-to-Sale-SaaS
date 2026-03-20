import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import { customerFirstPaidOrders, referralClaims } from '../infra/db/schema/index.js';
import { isMysqlDuplicateEntryError } from '../utils/mysql-errors.js';

export type ReferralClaimStatus = 'active' | 'rewarded';

export type ReferralClaimRecord = {
  id: string;
  tenantId: string;
  guildId: string;
  referrerDiscordUserId: string;
  referrerEmailNormalized: string;
  referrerEmailDisplay: string;
  referredEmailNormalized: string;
  referredEmailDisplay: string;
  status: ReferralClaimStatus;
  rewardOrderSessionId: string | null;
  rewardPoints: number;
  rewardedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FirstPaidGateRecord = {
  id: string;
  tenantId: string;
  guildId: string;
  referredEmailNormalized: string;
  firstOrderSessionId: string;
  firstPaidAt: Date;
  claimId: string | null;
  rewardApplied: boolean;
  rewardPoints: number;
  referralRewardMinorSnapshot: number;
  pointValueMinorSnapshot: number;
  createdAt: Date;
};

function mapReferralClaimRow(row: typeof referralClaims.$inferSelect): ReferralClaimRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guildId: row.guildId,
    referrerDiscordUserId: row.referrerDiscordUserId,
    referrerEmailNormalized: row.referrerEmailNormalized,
    referrerEmailDisplay: row.referrerEmailDisplay,
    referredEmailNormalized: row.referredEmailNormalized,
    referredEmailDisplay: row.referredEmailDisplay,
    status: row.status,
    rewardOrderSessionId: row.rewardOrderSessionId,
    rewardPoints: row.rewardPoints,
    rewardedAt: row.rewardedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapFirstPaidGateRow(row: typeof customerFirstPaidOrders.$inferSelect): FirstPaidGateRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guildId: row.guildId,
    referredEmailNormalized: row.referredEmailNormalized,
    firstOrderSessionId: row.firstOrderSessionId,
    firstPaidAt: row.firstPaidAt,
    claimId: row.claimId,
    rewardApplied: row.rewardApplied,
    rewardPoints: row.rewardPoints,
    referralRewardMinorSnapshot: row.referralRewardMinorSnapshot,
    pointValueMinorSnapshot: row.pointValueMinorSnapshot,
    createdAt: row.createdAt,
  };
}

export class ReferralRepository {
  private readonly db = getDb();

  public async findClaimByReferredEmail(input: {
    tenantId: string;
    guildId: string;
    referredEmailNormalized: string;
  }): Promise<ReferralClaimRecord | null> {
    const row = await this.db.query.referralClaims.findFirst({
      where: and(
        eq(referralClaims.tenantId, input.tenantId),
        eq(referralClaims.guildId, input.guildId),
        eq(referralClaims.referredEmailNormalized, input.referredEmailNormalized),
      ),
    });

    if (!row) {
      return null;
    }

    return mapReferralClaimRow(row);
  }

  public async findActiveClaimByReferredEmail(input: {
    tenantId: string;
    guildId: string;
    referredEmailNormalized: string;
  }): Promise<ReferralClaimRecord | null> {
    const row = await this.db.query.referralClaims.findFirst({
      where: and(
        eq(referralClaims.tenantId, input.tenantId),
        eq(referralClaims.guildId, input.guildId),
        eq(referralClaims.referredEmailNormalized, input.referredEmailNormalized),
        eq(referralClaims.status, 'active'),
      ),
    });

    if (!row) {
      return null;
    }

    return mapReferralClaimRow(row);
  }

  public async createClaimFirstWins(input: {
    tenantId: string;
    guildId: string;
    referrerDiscordUserId: string;
    referrerEmailNormalized: string;
    referrerEmailDisplay: string;
    referredEmailNormalized: string;
    referredEmailDisplay: string;
  }): Promise<
    | { created: true; claim: ReferralClaimRecord }
    | { created: false; claim: ReferralClaimRecord | null }
  > {
    const id = ulid();

    try {
      await this.db.insert(referralClaims).values({
        id,
        tenantId: input.tenantId,
        guildId: input.guildId,
        referrerDiscordUserId: input.referrerDiscordUserId,
        referrerEmailNormalized: input.referrerEmailNormalized,
        referrerEmailDisplay: input.referrerEmailDisplay,
        referredEmailNormalized: input.referredEmailNormalized,
        referredEmailDisplay: input.referredEmailDisplay,
        status: 'active',
      });
    } catch (error) {
      if (isMysqlDuplicateEntryError(error)) {
        const existing = await this.findClaimByReferredEmail({
          tenantId: input.tenantId,
          guildId: input.guildId,
          referredEmailNormalized: input.referredEmailNormalized,
        });
        return { created: false, claim: existing };
      }

      throw error;
    }

    const claim = await this.findClaimByReferredEmail({
      tenantId: input.tenantId,
      guildId: input.guildId,
      referredEmailNormalized: input.referredEmailNormalized,
    });

    if (!claim) {
      throw new Error('Failed to load created referral claim');
    }

    return { created: true, claim };
  }

  public async markClaimRewarded(input: {
    claimId: string;
    rewardOrderSessionId: string;
    rewardPoints: number;
  }): Promise<void> {
    await this.db
      .update(referralClaims)
      .set({
        status: 'rewarded',
        rewardOrderSessionId: input.rewardOrderSessionId,
        rewardPoints: input.rewardPoints,
        rewardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(referralClaims.id, input.claimId));
  }

  public async insertFirstPaidGate(input: {
    tenantId: string;
    guildId: string;
    referredEmailNormalized: string;
    firstOrderSessionId: string;
    claimId: string | null;
    rewardApplied: boolean;
    rewardPoints: number;
    referralRewardMinorSnapshot: number;
    pointValueMinorSnapshot: number;
  }): Promise<{ created: true; row: FirstPaidGateRecord } | { created: false; row: FirstPaidGateRecord | null }> {
    const id = ulid();

    try {
      await this.db.insert(customerFirstPaidOrders).values({
        id,
        tenantId: input.tenantId,
        guildId: input.guildId,
        referredEmailNormalized: input.referredEmailNormalized,
        firstOrderSessionId: input.firstOrderSessionId,
        claimId: input.claimId,
        rewardApplied: input.rewardApplied,
        rewardPoints: input.rewardPoints,
        referralRewardMinorSnapshot: input.referralRewardMinorSnapshot,
        pointValueMinorSnapshot: input.pointValueMinorSnapshot,
      });
    } catch (error) {
      if (isMysqlDuplicateEntryError(error)) {
        const existing = await this.findFirstPaidGateByReferredEmail({
          tenantId: input.tenantId,
          guildId: input.guildId,
          referredEmailNormalized: input.referredEmailNormalized,
        });
        return { created: false, row: existing };
      }

      throw error;
    }

    const inserted = await this.getFirstPaidGateById(id);
    if (!inserted) {
      throw new Error('Failed to load inserted first paid gate row');
    }

    return { created: true, row: inserted };
  }

  public async updateFirstPaidGateOutcome(input: {
    gateId: string;
    claimId: string | null;
    rewardApplied: boolean;
    rewardPoints: number;
    referralRewardMinorSnapshot: number;
    pointValueMinorSnapshot: number;
  }): Promise<void> {
    await this.db
      .update(customerFirstPaidOrders)
      .set({
        claimId: input.claimId,
        rewardApplied: input.rewardApplied,
        rewardPoints: input.rewardPoints,
        referralRewardMinorSnapshot: input.referralRewardMinorSnapshot,
        pointValueMinorSnapshot: input.pointValueMinorSnapshot,
      })
      .where(eq(customerFirstPaidOrders.id, input.gateId));
  }

  private async getFirstPaidGateById(id: string): Promise<FirstPaidGateRecord | null> {
    const row = await this.db.query.customerFirstPaidOrders.findFirst({
      where: eq(customerFirstPaidOrders.id, id),
    });

    if (!row) {
      return null;
    }

    return mapFirstPaidGateRow(row);
  }

  public async findFirstPaidGateByReferredEmail(input: {
    tenantId: string;
    guildId: string;
    referredEmailNormalized: string;
  }): Promise<FirstPaidGateRecord | null> {
    const row = await this.db.query.customerFirstPaidOrders.findFirst({
      where: and(
        eq(customerFirstPaidOrders.tenantId, input.tenantId),
        eq(customerFirstPaidOrders.guildId, input.guildId),
        eq(customerFirstPaidOrders.referredEmailNormalized, input.referredEmailNormalized),
      ),
    });

    if (!row) {
      return null;
    }

    return mapFirstPaidGateRow(row);
  }
}

import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import type { AppError} from '../domain/errors.js';
import { fromUnknownError, validationError } from '../domain/errors.js';
import { PointsRepository } from '../repositories/points-repository.js';
import { type OrderSessionRecord } from '../repositories/order-repository.js';
import {
  ReferralRepository,
  type FirstPaidGateRecord,
  type ReferralClaimRecord,
} from '../repositories/referral-repository.js';
import { resolveOrderSessionCustomerEmail } from '../utils/customer-email.js';
import { formatUserReference } from '../utils/platform-ids.js';
import { GuildFeatureService } from './guild-feature-service.js';
import { PointsService } from './points-service.js';

const emailSchema = z.string().trim().min(3).max(320).email();
const claimInputSchema = z.object({
  tenantId: z.string().trim().min(1).max(26),
  guildId: z.string().trim().min(1).max(32),
  referrerDiscordUserId: z.string().trim().min(1).max(32),
  referrerEmail: emailSchema,
  referredEmail: emailSchema,
});

export type ReferralClaimCreateResult = {
  status: 'accepted' | 'duplicate' | 'self_blocked';
  claim: ReferralClaimRecord | null;
};

export type ReferralRewardResult =
  | {
      status: 'rewarded';
      claimId: string;
      referrerDiscordUserId: string;
      referrerEmailNormalized: string;
      referredEmailNormalized: string;
      rewardPoints: number;
      rewardMinor: number;
      pointValueMinor: number;
      thankYouMessage: string;
    }
  | {
      status: 'not_applicable';
      reason:
        | 'no_customer_email'
        | 'not_first_paid'
        | 'no_claim'
        | 'self_blocked'
        | 'reward_disabled'
        | 'reward_zero_points';
      referredEmailNormalized: string | null;
      claim: ReferralClaimRecord | null;
      rewardMinor: number;
      pointValueMinor: number;
      rewardPoints: number;
    };

const DEFAULT_THANK_YOU_TEMPLATE =
  'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.';

export class ReferralService {
  private readonly referralRepository = new ReferralRepository();
  private readonly pointsService = new PointsService();
  private readonly pointsRepository = new PointsRepository();
  private readonly guildFeatureService = new GuildFeatureService();

  public async createClaimFromCommand(input: {
    tenantId: string;
    guildId: string;
    referrerDiscordUserId: string;
    referrerEmail: string;
    referredEmail: string;
  }): Promise<Result<ReferralClaimCreateResult, AppError>> {
    try {
      const featureCheck = await this.guildFeatureService.ensureFeatureEnabled({
        tenantId: input.tenantId,
        guildId: input.guildId,
        feature: 'referrals',
      });
      if (featureCheck.isErr()) {
        return err(featureCheck.error);
      }

      const parsed = claimInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(validationError(parsed.error.issues));
      }

      const normalizedReferrer = this.pointsService.normalizeEmail(parsed.data.referrerEmail);
      if (normalizedReferrer.isErr()) {
        return err(normalizedReferrer.error);
      }

      const normalizedReferred = this.pointsService.normalizeEmail(parsed.data.referredEmail);
      if (normalizedReferred.isErr()) {
        return err(normalizedReferred.error);
      }

      if (normalizedReferrer.value.emailNormalized === normalizedReferred.value.emailNormalized) {
        return ok({
          status: 'self_blocked',
          claim: null,
        });
      }

      const created = await this.referralRepository.createClaimFirstWins({
        tenantId: parsed.data.tenantId,
        guildId: parsed.data.guildId,
        referrerDiscordUserId: parsed.data.referrerDiscordUserId,
        referrerEmailNormalized: normalizedReferrer.value.emailNormalized,
        referrerEmailDisplay: normalizedReferrer.value.emailDisplay,
        referredEmailNormalized: normalizedReferred.value.emailNormalized,
        referredEmailDisplay: normalizedReferred.value.emailDisplay,
      });

      if (!created.created) {
        return ok({
          status: 'duplicate',
          claim: created.claim,
        });
      }

      return ok({
        status: 'accepted',
        claim: created.claim,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async processPaidOrderReward(input: {
    orderSession: OrderSessionRecord;
    referralThankYouTemplate: string | null;
  }): Promise<Result<ReferralRewardResult, AppError>> {
    try {
      const config = await this.guildFeatureService.getGuildConfig({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
      });
      if (config.isErr()) {
        return err(config.error);
      }

      const referredEmail = resolveOrderSessionCustomerEmail(input.orderSession);
      if (!referredEmail) {
        return ok({
          status: 'not_applicable',
          reason: 'no_customer_email',
          referredEmailNormalized: null,
          claim: null,
          rewardMinor: 0,
          pointValueMinor: 1,
          rewardPoints: 0,
        });
      }

      if (!config.value.referralsEnabled || !config.value.pointsEnabled) {
        return ok({
          status: 'not_applicable',
          reason: 'reward_disabled',
          referredEmailNormalized: referredEmail,
          claim: null,
          rewardMinor: 0,
          pointValueMinor: Math.max(1, input.orderSession.pointsConfigSnapshot?.pointValueMinor ?? 1),
          rewardPoints: 0,
        });
      }

      const pointValueMinor = Math.max(
        1,
        input.orderSession.pointsConfigSnapshot?.pointValueMinor ?? 1,
      );
      const rewardMinor = Math.max(0, input.orderSession.referralRewardMinorSnapshot ?? 0);
      const claim = await this.referralRepository.findClaimByReferredEmail({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        referredEmailNormalized: referredEmail,
      });
      const activeClaim = claim?.status === 'active' ? claim : null;

      const gate = await this.referralRepository.insertFirstPaidGate({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        referredEmailNormalized: referredEmail,
        firstOrderSessionId: input.orderSession.id,
        claimId: activeClaim?.id ?? null,
        rewardApplied: false,
        rewardPoints: 0,
        referralRewardMinorSnapshot: rewardMinor,
        pointValueMinorSnapshot: pointValueMinor,
      });

      if (!gate.created) {
        return ok(
          this.resolveExistingFirstPaidOutcome({
            orderSession: input.orderSession,
            referredEmail,
            claim,
            gate: gate.row,
            fallbackRewardMinor: rewardMinor,
            fallbackPointValueMinor: pointValueMinor,
            referralThankYouTemplate: input.referralThankYouTemplate,
          }),
        );
      }

      if (!activeClaim) {
        return ok({
          status: 'not_applicable',
          reason: 'no_claim',
          referredEmailNormalized: referredEmail,
          claim: null,
          rewardMinor,
          pointValueMinor,
          rewardPoints: 0,
        });
      }

      if (activeClaim.referrerEmailNormalized === referredEmail) {
        return ok({
          status: 'not_applicable',
          reason: 'self_blocked',
          referredEmailNormalized: referredEmail,
          claim: activeClaim,
          rewardMinor,
          pointValueMinor,
          rewardPoints: 0,
        });
      }

      if (rewardMinor <= 0) {
        return ok({
          status: 'not_applicable',
          reason: 'reward_disabled',
          referredEmailNormalized: referredEmail,
          claim: activeClaim,
          rewardMinor,
          pointValueMinor,
          rewardPoints: 0,
        });
      }

      const rewardPoints = Math.floor(rewardMinor / pointValueMinor);
      if (rewardPoints <= 0) {
        return ok({
          status: 'not_applicable',
          reason: 'reward_zero_points',
          referredEmailNormalized: referredEmail,
          claim: activeClaim,
          rewardMinor,
          pointValueMinor,
          rewardPoints,
        });
      }

      await this.pointsRepository.addPoints({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        emailNormalized: activeClaim.referrerEmailNormalized,
        emailDisplay: activeClaim.referrerEmailDisplay,
        points: rewardPoints,
      });

      await this.pointsRepository.insertLedgerEvent({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        emailNormalized: activeClaim.referrerEmailNormalized,
        deltaPoints: rewardPoints,
        eventType: 'referral_reward_first_paid_order',
        orderSessionId: input.orderSession.id,
        metadata: {
          claimId: activeClaim.id,
          referredEmailNormalized: referredEmail,
          referralRewardMinorSnapshot: rewardMinor,
          pointValueMinorSnapshot: pointValueMinor,
          rewardPoints,
        },
      });

      await this.referralRepository.markClaimRewarded({
        claimId: activeClaim.id,
        rewardOrderSessionId: input.orderSession.id,
        rewardPoints,
      });

      await this.referralRepository.updateFirstPaidGateOutcome({
        gateId: gate.row.id,
        claimId: activeClaim.id,
        rewardApplied: true,
        rewardPoints,
        referralRewardMinorSnapshot: rewardMinor,
        pointValueMinorSnapshot: pointValueMinor,
      });

      const thankYouMessage = this.renderThankYouTemplate({
        template: input.referralThankYouTemplate,
        rewardPoints,
        rewardMinor,
        referredEmail,
        referrerEmail: activeClaim.referrerEmailDisplay,
        referrerDiscordUserId: activeClaim.referrerDiscordUserId,
        orderSessionId: input.orderSession.id,
      });

      return ok({
        status: 'rewarded',
        claimId: activeClaim.id,
        referrerDiscordUserId: activeClaim.referrerDiscordUserId,
        referrerEmailNormalized: activeClaim.referrerEmailNormalized,
        referredEmailNormalized: referredEmail,
        rewardPoints,
        rewardMinor,
        pointValueMinor,
        thankYouMessage,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  private resolveExistingFirstPaidOutcome(input: {
    orderSession: OrderSessionRecord;
    referredEmail: string;
    claim: ReferralClaimRecord | null;
    gate: FirstPaidGateRecord | null;
    fallbackRewardMinor: number;
    fallbackPointValueMinor: number;
    referralThankYouTemplate: string | null;
  }): ReferralRewardResult {
    if (!input.gate || input.gate.firstOrderSessionId !== input.orderSession.id) {
      return {
        status: 'not_applicable',
        reason: 'not_first_paid',
        referredEmailNormalized: input.referredEmail,
        claim: input.claim,
        rewardMinor: input.fallbackRewardMinor,
        pointValueMinor: input.fallbackPointValueMinor,
        rewardPoints: 0,
      };
    }

    const rewardMinor = Math.max(0, input.gate.referralRewardMinorSnapshot);
    const pointValueMinor = Math.max(1, input.gate.pointValueMinorSnapshot);
    const rewardPoints = Math.max(
      0,
      input.gate.rewardPoints > 0 ? input.gate.rewardPoints : Math.floor(rewardMinor / pointValueMinor),
    );

    if (
      input.gate.rewardApplied &&
      input.claim &&
      input.claim.rewardOrderSessionId === input.orderSession.id
    ) {
      return {
        status: 'rewarded',
        claimId: input.claim.id,
        referrerDiscordUserId: input.claim.referrerDiscordUserId,
        referrerEmailNormalized: input.claim.referrerEmailNormalized,
        referredEmailNormalized: input.referredEmail,
        rewardPoints,
        rewardMinor,
        pointValueMinor,
        thankYouMessage: this.renderThankYouTemplate({
          template: input.referralThankYouTemplate,
          rewardPoints,
          rewardMinor,
          referredEmail: input.referredEmail,
          referrerEmail: input.claim.referrerEmailDisplay,
          referrerDiscordUserId: input.claim.referrerDiscordUserId,
          orderSessionId: input.orderSession.id,
        }),
      };
    }

    if (!input.claim) {
      return {
        status: 'not_applicable',
        reason: 'no_claim',
        referredEmailNormalized: input.referredEmail,
        claim: null,
        rewardMinor,
        pointValueMinor,
        rewardPoints: 0,
      };
    }

    if (input.claim.referrerEmailNormalized === input.referredEmail) {
      return {
        status: 'not_applicable',
        reason: 'self_blocked',
        referredEmailNormalized: input.referredEmail,
        claim: input.claim,
        rewardMinor,
        pointValueMinor,
        rewardPoints: 0,
      };
    }

    if (rewardMinor <= 0) {
      return {
        status: 'not_applicable',
        reason: 'reward_disabled',
        referredEmailNormalized: input.referredEmail,
        claim: input.claim,
        rewardMinor,
        pointValueMinor,
        rewardPoints: 0,
      };
    }

    if (rewardPoints <= 0) {
      return {
        status: 'not_applicable',
        reason: 'reward_zero_points',
        referredEmailNormalized: input.referredEmail,
        claim: input.claim,
        rewardMinor,
        pointValueMinor,
        rewardPoints,
      };
    }

    return {
      status: 'not_applicable',
      reason: 'not_first_paid',
      referredEmailNormalized: input.referredEmail,
      claim: input.claim,
      rewardMinor,
      pointValueMinor,
      rewardPoints: 0,
    };
  }

  public renderThankYouTemplate(input: {
    template: string | null;
    rewardPoints: number;
    rewardMinor: number;
    referredEmail: string;
    referrerEmail: string;
    referrerDiscordUserId: string;
    orderSessionId: string;
  }): string {
    const template =
      typeof input.template === 'string' && input.template.trim().length > 0
        ? input.template
        : DEFAULT_THANK_YOU_TEMPLATE;
    const templateContainsMention = /\{referrer_mention\}/i.test(template);

    const values: Record<string, string> = {
      points: String(input.rewardPoints),
      amount_gbp: (input.rewardMinor / 100).toFixed(2),
      referred_email: input.referredEmail,
      referrer_email: input.referrerEmail,
      referrer_mention: formatUserReference(input.referrerDiscordUserId),
      order_session_id: input.orderSessionId,
    };

    const rendered = template.replace(/\{([a-z_]+)\}/gi, (token, key: string) => {
      const normalizedKey = key.toLowerCase();
      return values[normalizedKey] ?? token;
    });

    if (templateContainsMention) {
      return rendered;
    }

    return `${values.referrer_mention} ${rendered}`.trim();
  }
}

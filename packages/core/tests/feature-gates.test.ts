import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from 'neverthrow';

import { AppError } from '../src/domain/errors.js';
import type { GuildConfigRecord } from '../src/repositories/tenant-repository.js';
import type { SessionPayload } from '../src/security/session-token.js';
import { CouponService } from '../src/services/coupon-service.js';
import { GuildFeatureService } from '../src/services/guild-feature-service.js';
import { PointsService } from '../src/services/points-service.js';
import { ReferralService } from '../src/services/referral-service.js';

function makeSession(): SessionPayload {
  return {
    userId: 'user-1',
    discordUserId: 'discord-user-1',
    isSuperAdmin: false,
    tenantIds: ['tenant-1'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

function makeGuildConfig(overrides: Partial<GuildConfigRecord> = {}): GuildConfigRecord {
  return {
    id: 'config-1',
    tenantId: 'tenant-1',
    guildId: 'guild-1',
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
    referralThankYouTemplate: 'Thanks',
    referralSubmissionTemplate: 'Submitted',
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
    salesHistoryClearedAt: null,
    salesHistoryAutoClearEnabled: false,
    salesHistoryAutoClearFrequency: 'daily',
    salesHistoryAutoClearLocalTimeHhMm: '00:00',
    salesHistoryAutoClearTimezone: 'UTC',
    salesHistoryAutoClearDayOfWeek: null,
    salesHistoryAutoClearDayOfMonth: null,
    salesHistoryAutoClearNextRunAtUtc: null,
    salesHistoryAutoClearLastRunAtUtc: null,
    salesHistoryAutoClearLastLocalRunDate: null,
    ...overrides,
  };
}

describe('feature gate enforcement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks coupon creation when coupons are disabled', async () => {
    const service = new CouponService();
    const actor = makeSession();

    vi.spyOn((service as any).authorizationService, 'ensureTenantRole').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).authorizationService, 'ensureGuildBoundToTenant').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).guildFeatureService, 'ensureFeatureEnabled').mockResolvedValue(
      err(new AppError('COUPONS_DISABLED', 'Coupons are currently disabled for this server.', 409)),
    );

    const result = await service.createCoupon(actor, {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      coupon: {
        code: 'WELCOME10',
        discountMinor: 500,
        active: true,
        allowedCategories: [],
        allowedProductIds: [],
        allowedVariantIds: [],
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }
    expect(result.error.code).toBe('COUPONS_DISABLED');
    expect(result.error.statusCode).toBe(409);
  });

  it('blocks manual points adjustments when points are disabled', async () => {
    const service = new PointsService();
    const actor = makeSession();

    vi.spyOn((service as any).authorizationService, 'ensureTenantRole').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).authorizationService, 'ensureGuildBoundToTenant').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).guildFeatureService, 'ensureFeatureEnabled').mockResolvedValue(
      err(new AppError('POINTS_DISABLED', 'Points are currently disabled for this server.', 409)),
    );

    const result = await service.manualAdjust(actor, {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      email: 'customer@example.com',
      action: 'add',
      points: 25,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }
    expect(result.error.code).toBe('POINTS_DISABLED');
    expect(result.error.statusCode).toBe(409);
  });

  it('blocks referral claims when referrals are disabled', async () => {
    const service = new ReferralService();

    vi.spyOn((service as any).guildFeatureService, 'ensureFeatureEnabled').mockResolvedValue(
      err(new AppError('REFERRALS_DISABLED', 'Referrals are currently disabled for this server.', 409)),
    );

    const result = await service.createClaimFromCommand({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      referrerDiscordUserId: 'discord-user-1',
      referrerEmail: 'referrer@example.com',
      referredEmail: 'new@example.com',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }
    expect(result.error.code).toBe('REFERRALS_DISABLED');
    expect(result.error.statusCode).toBe(409);
  });

  it('returns reward_disabled when referral rewards are gated off', async () => {
    const service = new ReferralService();

    vi.spyOn((service as any).guildFeatureService, 'getGuildConfig').mockResolvedValue(
      ok(
        makeGuildConfig({
          pointsEnabled: false,
          referralsEnabled: true,
        }),
      ),
    );

    const result = await service.processPaidOrderReward({
      orderSession: {
        id: 'order-session-1',
        tenantId: 'tenant-1',
        guildId: 'guild-1',
        ticketChannelId: 'ticket-1',
        staffUserId: 'staff-1',
        customerDiscordId: 'customer-1',
        productId: 'product-1',
        variantId: 'variant-1',
        basketItems: [],
        couponCode: null,
        couponDiscountMinor: 0,
        customerEmailNormalized: 'customer@example.com',
        pointsReserved: 0,
        pointsDiscountMinor: 0,
        pointsReservationState: 'none',
        pointsConfigSnapshot: {
          pointValueMinor: 100,
          earnCategoryKeys: [],
          redeemCategoryKeys: [],
        },
        referralRewardMinorSnapshot: 500,
        tipMinor: 0,
        subtotalMinor: 0,
        totalMinor: 0,
        status: 'paid',
        answers: {},
        checkoutUrl: null,
        checkoutUrlCrypto: null,
        checkoutTokenExpiresAt: new Date(),
      },
      referralThankYouTemplate: null,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }
    expect(result.value.status).toBe('not_applicable');
    if (result.value.status !== 'not_applicable') {
      return;
    }
    expect(result.value.reason).toBe('reward_disabled');
  });

  it('reports telegram as disabled when the guild config toggle is off', async () => {
    const service = new GuildFeatureService();

    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue(
      makeGuildConfig({
        telegramEnabled: false,
      }),
    );

    const result = await service.ensureFeatureEnabled({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      feature: 'telegram',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }
    expect(result.error.code).toBe('TELEGRAM_DISABLED');
    expect(result.error.statusCode).toBe(409);
  });
});

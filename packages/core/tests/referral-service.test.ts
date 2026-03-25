import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from 'neverthrow';

import type { OrderSessionRecord } from '../src/repositories/order-repository.js';
import { ReferralService } from '../src/services/referral-service.js';

function makeOrderSession(overrides: Partial<OrderSessionRecord> = {}): OrderSessionRecord {
  return {
    id: '01HKTESORDERSESSION0000000001',
    tenantId: '01HKTENANT0000000000000001',
    guildId: '123456789012345678',
    ticketChannelId: '223456789012345678',
    staffUserId: '323456789012345678',
    customerDiscordId: '423456789012345678',
    productId: '01HKPRODUCT000000000000001',
    variantId: '01HKVARIANT000000000000001',
    basketItems: [],
    couponCode: null,
    couponDiscountMinor: 0,
    customerEmailNormalized: null,
    pointsReserved: 0,
    pointsDiscountMinor: 0,
    pointsReservationState: 'none',
    pointsConfigSnapshot: {
      pointValueMinor: 100,
      earnCategoryKeys: [],
      redeemCategoryKeys: [],
    },
    referralRewardMinorSnapshot: 0,
    tipMinor: 0,
    subtotalMinor: 0,
    totalMinor: 0,
    status: 'paid',
    answers: {},
    checkoutUrl: null,
    checkoutTokenExpiresAt: new Date(),
    ...overrides,
  };
}

describe('referral service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFeatureFlagsEnabled(service: ReferralService) {
    vi.spyOn((service as any).guildFeatureService, 'ensureFeatureEnabled').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).guildFeatureService, 'getGuildConfig').mockResolvedValue(
      ok({
        pointsEnabled: true,
        referralsEnabled: true,
      }),
    );
  }

  it('renders thank-you template placeholders', () => {
    const service = new ReferralService();

    const rendered = service.renderThankYouTemplate({
      template:
        'Congrats {referrer_mention} {referrer_email}! +{points} points ({amount_gbp} GBP) for {referred_email} on {order_session_id}.',
      rewardPoints: 10,
      rewardMinor: 1000,
      referredEmail: 'new@example.com',
      referrerEmail: 'ref@example.com',
      referrerDiscordUserId: '523456789012345678',
      orderSessionId: '01HKTESORDERSESSION0000000001',
    });

    expect(rendered).toContain('<@523456789012345678>');
    expect(rendered).toContain('ref@example.com');
    expect(rendered).toContain('+10 points');
    expect(rendered).toContain('10.00 GBP');
    expect(rendered).toContain('new@example.com');
    expect(rendered).toContain('01HKTESORDERSESSION0000000001');
  });

  it('blocks self-referral when creating claim', async () => {
    const service = new ReferralService();
    mockFeatureFlagsEnabled(service);

    const created = await service.createClaimFromCommand({
      tenantId: '01HKTENANT0000000000000001',
      guildId: '123456789012345678',
      referrerDiscordUserId: '523456789012345678',
      referrerEmail: 'same@example.com',
      referredEmail: 'same@example.com',
    });

    expect(created.isOk()).toBe(true);
    if (created.isErr()) {
      return;
    }
    expect(created.value.status).toBe('self_blocked');
  });

  it('returns no_customer_email outcome without DB side effects', async () => {
    const service = new ReferralService();
    mockFeatureFlagsEnabled(service);

    const result = await service.processPaidOrderReward({
      orderSession: makeOrderSession({
        customerEmailNormalized: null,
      }),
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
    expect(result.value.reason).toBe('no_customer_email');
  });

  it('ignores Telegram placeholder emails when processing referral rewards', async () => {
    const service = new ReferralService();
    mockFeatureFlagsEnabled(service);

    const result = await service.processPaidOrderReward({
      orderSession: makeOrderSession({
        customerDiscordId: 'tg:7694095003',
        ticketChannelId: 'tg:-1003848597553',
        customerEmailNormalized: 'discord@voodoo-services.com',
      }),
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
    expect(result.value.reason).toBe('no_customer_email');
  });

  it('returns the rewarded outcome again when the same paid order is retried', async () => {
    const service = new ReferralService();
    mockFeatureFlagsEnabled(service);
    const orderSession = makeOrderSession({
      customerEmailNormalized: 'new@example.com',
      referralRewardMinorSnapshot: 500,
      pointsConfigSnapshot: {
        pointValueMinor: 100,
        earnCategoryKeys: [],
        redeemCategoryKeys: [],
      },
    });
    const claim = {
      id: 'claim-1',
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      referrerDiscordUserId: '523456789012345678',
      referrerEmailNormalized: 'ref@example.com',
      referrerEmailDisplay: 'ref@example.com',
      referredEmailNormalized: 'new@example.com',
      referredEmailDisplay: 'new@example.com',
      status: 'rewarded' as const,
      rewardOrderSessionId: orderSession.id,
      rewardPoints: 5,
      rewardedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn((service as any).referralRepository, 'findClaimByReferredEmail').mockResolvedValue(claim);
    vi.spyOn((service as any).referralRepository, 'insertFirstPaidGate').mockResolvedValue({
      created: false,
      row: {
        id: 'gate-1',
        tenantId: orderSession.tenantId,
        guildId: orderSession.guildId,
        referredEmailNormalized: 'new@example.com',
        firstOrderSessionId: orderSession.id,
        firstPaidAt: new Date(),
        claimId: claim.id,
        rewardApplied: true,
        rewardPoints: 5,
        referralRewardMinorSnapshot: 500,
        pointValueMinorSnapshot: 100,
        createdAt: new Date(),
      },
    });

    const result = await service.processPaidOrderReward({
      orderSession,
      referralThankYouTemplate: null,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.status).toBe('rewarded');
    if (result.value.status !== 'rewarded') {
      return;
    }

    expect(result.value.claimId).toBe('claim-1');
    expect(result.value.rewardPoints).toBe(5);
    expect(result.value.referredEmailNormalized).toBe('new@example.com');
  });
});

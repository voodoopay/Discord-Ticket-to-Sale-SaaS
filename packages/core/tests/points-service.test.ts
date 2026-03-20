import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OrderSessionRecord } from '../src/repositories/order-repository.js';
import { PointsService } from '../src/services/points-service.js';

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
    customerEmailNormalized: 'customer@example.com',
    pointsReserved: 25,
    pointsDiscountMinor: 0,
    pointsReservationState: 'reserved',
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
    checkoutUrlCrypto: null,
    checkoutTokenExpiresAt: new Date(),
    ...overrides,
  };
}

describe('points service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not consume reserved points twice when a prior ledger event already exists', async () => {
    const service = new PointsService();
    const orderSession = makeOrderSession();

    vi.spyOn((service as any).pointsRepository, 'findLedgerEventByOrderSessionAndType').mockResolvedValue({
      id: 'ledger-1',
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      emailNormalized: orderSession.customerEmailNormalized!,
      deltaPoints: -25,
      eventType: 'reservation_consumed',
      orderSessionId: orderSession.id,
      actorUserId: null,
      metadata: { points: 25 },
      createdAt: new Date(),
    });
    const consumeReservedPoints = vi
      .spyOn((service as any).pointsRepository, 'consumeReservedPoints')
      .mockResolvedValue(null);
    const setReservationState = vi
      .spyOn((service as any).orderRepository, 'setOrderSessionPointsReservationState')
      .mockResolvedValue(undefined);

    const result = await service.consumeReservationForPaidOrder({ orderSession });

    expect(result.isOk()).toBe(true);
    expect(consumeReservedPoints).not.toHaveBeenCalled();
    expect(setReservationState).toHaveBeenCalledWith({
      tenantId: orderSession.tenantId,
      orderSessionId: orderSession.id,
      state: 'consumed',
    });
  });

  it('does not add earned points twice when a prior ledger event already exists', async () => {
    const service = new PointsService();
    const orderSession = makeOrderSession({
      pointsReservationState: 'consumed',
      pointsReserved: 0,
    });

    vi.spyOn((service as any).pointsRepository, 'findLedgerEventByOrderSessionAndType').mockResolvedValue({
      id: 'ledger-2',
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      emailNormalized: orderSession.customerEmailNormalized!,
      deltaPoints: 12,
      eventType: 'earned_from_paid_order',
      orderSessionId: orderSession.id,
      actorUserId: null,
      metadata: { points: 12 },
      createdAt: new Date(),
    });
    const addPoints = vi.spyOn((service as any).pointsRepository, 'addPoints').mockResolvedValue({
      id: 'acct-1',
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      emailNormalized: orderSession.customerEmailNormalized!,
      emailDisplay: orderSession.customerEmailNormalized!,
      balancePoints: 42,
      reservedPoints: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.spyOn((service as any).pointsRepository, 'getAccount').mockResolvedValue({
      id: 'acct-1',
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      emailNormalized: orderSession.customerEmailNormalized!,
      emailDisplay: orderSession.customerEmailNormalized!,
      balancePoints: 42,
      reservedPoints: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.addEarnedPointsForPaidOrder({
      orderSession,
      points: 12,
    });

    expect(result.isOk()).toBe(true);
    expect(addPoints).not.toHaveBeenCalled();
    if (result.isErr()) {
      return;
    }
    expect(result.value?.balancePoints).toBe(42);
  });

  it('does not add earned points for Telegram placeholder emails', async () => {
    const service = new PointsService();
    const orderSession = makeOrderSession({
      customerDiscordId: 'tg:7694095003',
      ticketChannelId: 'tg:-1003848597553',
      customerEmailNormalized: 'discord@voodoo-services.com',
      pointsReservationState: 'consumed',
      pointsReserved: 0,
    });

    const addPoints = vi.spyOn((service as any).pointsRepository, 'addPoints').mockResolvedValue({
      id: 'acct-1',
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      emailNormalized: 'discord@voodoo-services.com',
      emailDisplay: 'discord@voodoo-services.com',
      balancePoints: 42,
      reservedPoints: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.addEarnedPointsForPaidOrder({
      orderSession,
      points: 12,
    });

    expect(result.isOk()).toBe(true);
    expect(addPoints).not.toHaveBeenCalled();
    if (result.isErr()) {
      return;
    }
    expect(result.value).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from 'neverthrow';

import type { PaidOrderRecord, PaidOrderWithSessionRecord } from '../src/repositories/order-repository.js';
import type { GuildConfigRecord } from '../src/repositories/tenant-repository.js';
import type { SessionPayload } from '../src/security/session-token.js';
import { DashboardService } from '../src/services/dashboard-service.js';

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
    telegramEnabled: true,
    tipEnabled: false,
    pointsEarnCategoryKeys: [],
    pointsRedeemCategoryKeys: [],
    pointValueMinor: 100,
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

function makePaidOrder(overrides: Partial<PaidOrderRecord> = {}): PaidOrderRecord {
  return {
    id: 'paid-order-1',
    tenantId: 'tenant-1',
    guildId: 'guild-1',
    orderSessionId: 'session-1',
    wooOrderId: 'provider-1',
    status: 'paid',
    priceMinor: 1200,
    currency: 'GBP',
    paymentReference: 'payment-ref-1',
    fulfillmentStatus: 'needs_action',
    fulfilledAt: null,
    fulfilledByDiscordUserId: null,
    paidAt: new Date('2026-03-25T00:30:00.000Z'),
    createdAt: new Date('2026-03-25T00:35:00.000Z'),
    updatedAt: new Date('2026-03-25T00:35:00.000Z'),
    ...overrides,
  };
}

function makePaidOrderWithSession(
  overrides: Partial<PaidOrderWithSessionRecord> = {},
): PaidOrderWithSessionRecord {
  return {
    ...makePaidOrder(overrides),
    ticketChannelId: 'discord:channel:ticket-1',
    customerDiscordId: 'discord:user:customer-1',
    productId: 'product-1',
    variantId: 'variant-1',
    customerEmailNormalized: 'customer@example.com',
    answers: {
      email: 'customer@example.com',
    },
    basketItems: [
      {
        productId: 'product-1',
        productName: 'Starter Package',
        category: 'Boosting',
        variantId: 'variant-1',
        variantLabel: 'Gold Plan',
        priceMinor: 1200,
        currency: 'GBP',
      },
    ],
    ...overrides,
  };
}

describe('dashboard service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('aggregates todays sales using the requested timezone and enriches recent sales', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00.000Z'));

    const service = new DashboardService();

    vi.spyOn((service as any).authorizationService, 'ensureTenantRole').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).authorizationService, 'ensureGuildBoundToTenant').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue(
      makeGuildConfig({
        couponsEnabled: true,
        pointsEnabled: true,
        referralsEnabled: false,
        telegramEnabled: true,
      }),
    );
    vi.spyOn((service as any).integrationRepository, 'getVoodooPayIntegrationByGuild').mockResolvedValue({
      id: 'integration-1',
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      merchantWalletAddress: '0xabc',
      callbackSecret: 'secret',
      tenantWebhookKey: 'webhook',
      checkoutDomain: 'checkout.voodoo-pay.uk',
      cryptoGatewayEnabled: true,
      cryptoAddFees: false,
      cryptoWallets: {
        evm: '0xabc',
        btc: '',
        bitcoincash: '',
        ltc: '',
        doge: '',
        trc20: '',
        solana: '',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.spyOn((service as any).telegramLinkRepository, 'getByGuild').mockResolvedValue({
      id: 'telegram-link-1',
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      chatId: '-100123',
      chatTitle: 'Ops Chat',
      linkedByDiscordUserId: 'discord-user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.spyOn((service as any).orderRepository, 'listPaidOrdersByGuild')
      .mockResolvedValueOnce([
        makePaidOrder({
          id: 'paid-order-1',
          orderSessionId: 'session-1',
          priceMinor: 1200,
          paidAt: new Date('2026-03-25T00:30:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([
        makePaidOrder({
          id: 'paid-order-1',
          orderSessionId: 'session-1',
          priceMinor: 1200,
          paidAt: new Date('2026-03-25T00:30:00.000Z'),
        }),
        makePaidOrder({
          id: 'paid-order-2',
          orderSessionId: 'session-2',
          priceMinor: 1800,
          paidAt: new Date('2026-03-24T23:30:00.000Z'),
        }),
      ]);
    vi.spyOn((service as any).orderRepository, 'getOrderSessionById').mockResolvedValue({
      id: 'session-1',
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
      referralRewardMinorSnapshot: 0,
      tipMinor: 0,
      subtotalMinor: 0,
      totalMinor: 0,
      status: 'paid',
      answers: {
        email: 'customer@example.com',
      },
      checkoutUrl: null,
      checkoutUrlCrypto: null,
      checkoutTokenExpiresAt: new Date('2026-03-25T01:30:00.000Z'),
    });

    const result = await service.getGuildOverview(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      timeZone: 'Europe/Berlin',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.timezone).toBe('Europe/Berlin');
    expect(result.value.todayKey).toBe('2026-03-25');
    expect(result.value.todaySalesMinor).toBe(3000);
    expect(result.value.todaySalesCount).toBe(2);
    expect(result.value.paymentsConfigured).toBe(true);
    expect(result.value.cryptoEnabled).toBe(true);
    expect(result.value.couponsEnabled).toBe(true);
    expect(result.value.pointsEnabled).toBe(true);
    expect(result.value.referralsEnabled).toBe(false);
    expect(result.value.telegramEnabled).toBe(true);
    expect(result.value.telegramLinked).toBe(true);
    expect(result.value.recentSales).toHaveLength(1);
    expect(result.value.recentSales[0]).toMatchObject({
      customerEmail: 'customer@example.com',
      ticketChannelId: 'ticket-1',
      productId: 'product-1',
      variantId: 'variant-1',
      priceMinor: 1200,
    });
  });

  it('falls back to UTC for invalid timezones and returns empty recent sales when no orders exist', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00.000Z'));

    const service = new DashboardService();

    vi.spyOn((service as any).authorizationService, 'ensureTenantRole').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).authorizationService, 'ensureGuildBoundToTenant').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue(
      makeGuildConfig({
        couponsEnabled: false,
        pointsEnabled: false,
        referralsEnabled: false,
        telegramEnabled: false,
      }),
    );
    vi.spyOn((service as any).integrationRepository, 'getVoodooPayIntegrationByGuild').mockResolvedValue(null);
    vi.spyOn((service as any).telegramLinkRepository, 'getByGuild').mockResolvedValue(null);
    vi.spyOn((service as any).orderRepository, 'listPaidOrdersByGuild')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getGuildOverview(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      timeZone: 'Mars/Base',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.timezone).toBe('UTC');
    expect(result.value.todayKey).toBe('2026-03-25');
    expect(result.value.todaySalesMinor).toBe(0);
    expect(result.value.todaySalesCount).toBe(0);
    expect(result.value.paymentsConfigured).toBe(false);
    expect(result.value.cryptoEnabled).toBe(false);
    expect(result.value.couponsEnabled).toBe(false);
    expect(result.value.pointsEnabled).toBe(false);
    expect(result.value.referralsEnabled).toBe(false);
    expect(result.value.telegramEnabled).toBe(false);
    expect(result.value.telegramLinked).toBe(false);
    expect(result.value.recentSales).toEqual([]);
  });

  it('lists filtered sales and supports txid, email, and local-date search terms', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T12:00:00.000Z'));

    const service = new DashboardService();

    vi.spyOn((service as any).authorizationService, 'ensureTenantRole').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).authorizationService, 'ensureGuildBoundToTenant').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue(makeGuildConfig());
    vi.spyOn((service as any).orderRepository, 'listPaidOrdersWithSessionsByGuild').mockResolvedValue([
      makePaidOrderWithSession({
        id: 'paid-order-1',
        orderSessionId: 'session-1',
        priceMinor: 1200,
        currency: 'USD',
        paymentReference: 'tx-123',
        paidAt: new Date('2026-03-26T09:15:00.000Z'),
      }),
      makePaidOrderWithSession({
        id: 'paid-order-2',
        orderSessionId: 'session-2',
        paymentReference: 'tx-999',
        customerEmailNormalized: 'other@example.com',
        answers: {
          email: 'other@example.com',
        },
        paidAt: new Date('2026-03-18T09:15:00.000Z'),
      }),
    ]);

    const txidResult = await service.listGuildSales(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      timeZone: 'Europe/Berlin',
      range: 'week',
      search: 'tx-123',
    });

    expect(txidResult.isOk()).toBe(true);
    if (txidResult.isErr()) {
      return;
    }

    expect(txidResult.value.totalSalesCount).toBe(1);
    expect(txidResult.value.totalSalesMinor).toBe(1200);
    expect(txidResult.value.sales[0]).toMatchObject({
      paymentReference: 'tx-123',
      customerEmail: 'customer@example.com',
      productName: 'Starter Package',
      variantLabel: 'Gold Plan',
      paidDateKey: '2026-03-26',
    });

    const emailResult = await service.listGuildSales(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      timeZone: 'Europe/Berlin',
      range: 'all',
      search: 'customer@example.com',
    });

    expect(emailResult.isOk()).toBe(true);
    if (emailResult.isErr()) {
      return;
    }

    expect(emailResult.value.totalSalesCount).toBe(1);
    expect(emailResult.value.sales[0]?.orderSessionId).toBe('session-1');

    const dateResult = await service.listGuildSales(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      timeZone: 'Europe/Berlin',
      range: 'all',
      search: '2026-03-26',
    });

    expect(dateResult.isOk()).toBe(true);
    if (dateResult.isErr()) {
      return;
    }

    expect(dateResult.value.totalSalesCount).toBe(1);
    expect(dateResult.value.sales[0]?.paidDateKey).toBe('2026-03-26');
  });

  it('rejects invalid custom sales ranges', async () => {
    const service = new DashboardService();

    vi.spyOn((service as any).authorizationService, 'ensureTenantRole').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).authorizationService, 'ensureGuildBoundToTenant').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue(makeGuildConfig());

    const result = await service.listGuildSales(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      range: 'custom',
      fromDate: '2026-03-28',
      toDate: '2026-03-20',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.code).toBe('INVALID_SALES_FILTER');
    expect(result.error.statusCode).toBe(400);
  });

  it('filters dashboard sales using the saved sales-history cutoff', async () => {
    const service = new DashboardService();
    const cutoff = new Date('2026-03-20T12:00:00.000Z');
    const listPaidOrdersWithSessionsByGuild = vi
      .spyOn((service as any).orderRepository, 'listPaidOrdersWithSessionsByGuild')
      .mockResolvedValue([
        makePaidOrderWithSession({
          id: 'paid-order-1',
          orderSessionId: 'session-1',
          paidAt: new Date('2026-03-22T09:15:00.000Z'),
        }),
      ]);

    vi.spyOn((service as any).authorizationService, 'ensureTenantRole').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).authorizationService, 'ensureGuildBoundToTenant').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue(
      makeGuildConfig({
        salesHistoryClearedAt: cutoff,
      }),
    );

    const result = await service.listGuildSales(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      range: 'all',
    });

    expect(result.isOk()).toBe(true);
    expect(listPaidOrdersWithSessionsByGuild).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      since: cutoff,
    });
  });
});

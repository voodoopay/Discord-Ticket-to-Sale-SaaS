import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import { orderNotesCache, orderSessions, ordersPaid, webhookEvents } from '../infra/db/schema/index.js';
import { isMysqlDuplicateEntryError } from '../utils/mysql-errors.js';

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? (error as { code?: unknown }).code : null;
  const message =
    'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';

  if (code !== 'ER_BAD_FIELD_ERROR') {
    return false;
  }

  return message.includes(`Unknown column '${columnName}'`);
}

export type OrderSessionBasketItem = {
  productId: string;
  productName: string;
  category: string;
  variantId: string;
  variantLabel: string;
  priceMinor: number;
  currency: string;
};

export type OrderSessionPointsReservationState =
  | 'none'
  | 'reserved'
  | 'released_expired'
  | 'released_cancelled'
  | 'consumed';

export type OrderSessionPointsConfigSnapshot = {
  pointValueMinor: number;
  earnCategoryKeys: string[];
  redeemCategoryKeys: string[];
};

export type PaidOrderFulfillmentStatus = 'needs_action' | 'fulfilled';

export type OrderSessionRecord = {
  id: string;
  tenantId: string;
  guildId: string;
  ticketChannelId: string;
  staffUserId: string;
  customerDiscordId: string;
  productId: string;
  variantId: string;
  basketItems: OrderSessionBasketItem[];
  couponCode: string | null;
  couponDiscountMinor: number;
  customerEmailNormalized: string | null;
  pointsReserved: number;
  pointsDiscountMinor: number;
  pointsReservationState: OrderSessionPointsReservationState;
  pointsConfigSnapshot: OrderSessionPointsConfigSnapshot;
  referralRewardMinorSnapshot: number;
  tipMinor: number;
  subtotalMinor: number;
  totalMinor: number;
  status: 'pending_payment' | 'cancelled' | 'paid';
  answers: Record<string, string>;
  checkoutUrl: string | null;
  checkoutUrlCrypto: string | null;
  checkoutTokenExpiresAt: Date;
};

export type PaidOrderRecord = {
  id: string;
  tenantId: string;
  guildId: string;
  orderSessionId: string;
  wooOrderId: string;
  status: string;
  priceMinor: number;
  currency: string;
  paymentReference: string | null;
  fulfillmentStatus: PaidOrderFulfillmentStatus;
  fulfilledAt: Date | null;
  fulfilledByDiscordUserId: string | null;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function mapOrderSessionRow(row: typeof orderSessions.$inferSelect): OrderSessionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guildId: row.guildId,
    ticketChannelId: row.ticketChannelId,
    staffUserId: row.staffUserId,
    customerDiscordId: row.customerDiscordId,
    productId: row.productId,
    variantId: row.variantId,
    basketItems: row.basketItems,
    couponCode: row.couponCode,
    couponDiscountMinor: row.couponDiscountMinor,
    customerEmailNormalized: row.customerEmailNormalized,
    pointsReserved: row.pointsReserved,
    pointsDiscountMinor: row.pointsDiscountMinor,
    pointsReservationState: row.pointsReservationState,
    pointsConfigSnapshot: row.pointsConfigSnapshot,
    referralRewardMinorSnapshot: row.referralRewardMinorSnapshot,
    tipMinor: row.tipMinor,
    subtotalMinor: row.subtotalMinor,
    totalMinor: row.totalMinor,
    status: row.status,
    answers: row.answers,
    checkoutUrl: row.checkoutUrl,
    checkoutUrlCrypto: row.checkoutUrlCrypto,
    checkoutTokenExpiresAt: row.checkoutTokenExpiresAt,
  };
}

function mapPaidOrderRow(row: typeof ordersPaid.$inferSelect): PaidOrderRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guildId: row.guildId,
    orderSessionId: row.orderSessionId,
    wooOrderId: row.wooOrderId,
    status: row.status,
    priceMinor: row.priceMinor,
    currency: row.currency,
    paymentReference: row.paymentReference ?? null,
    fulfillmentStatus: row.fulfillmentStatus,
    fulfilledAt: row.fulfilledAt ?? null,
    fulfilledByDiscordUserId: row.fulfilledByDiscordUserId ?? null,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class OrderRepository {
  private readonly db = getDb();

  public async createOrderSession(input: {
    tenantId: string;
    guildId: string;
    ticketChannelId: string;
    staffUserId: string;
    customerDiscordId: string;
    productId: string;
    variantId: string;
    basketItems: OrderSessionBasketItem[];
    couponCode: string | null;
    couponDiscountMinor: number;
    customerEmailNormalized: string | null;
    pointsReserved: number;
    pointsDiscountMinor: number;
    pointsReservationState: OrderSessionPointsReservationState;
    pointsConfigSnapshot: OrderSessionPointsConfigSnapshot;
    referralRewardMinorSnapshot: number;
    tipMinor: number;
    subtotalMinor: number;
    totalMinor: number;
    answers: Record<string, string>;
    checkoutTokenExpiresAt: Date;
    id?: string;
  }): Promise<OrderSessionRecord> {
    const id = input.id ?? ulid();

    await this.db.insert(orderSessions).values({
      id,
      tenantId: input.tenantId,
      guildId: input.guildId,
      ticketChannelId: input.ticketChannelId,
      staffUserId: input.staffUserId,
      customerDiscordId: input.customerDiscordId,
      productId: input.productId,
      variantId: input.variantId,
      basketItems: input.basketItems,
      couponCode: input.couponCode,
      couponDiscountMinor: input.couponDiscountMinor,
      customerEmailNormalized: input.customerEmailNormalized,
      pointsReserved: input.pointsReserved,
      pointsDiscountMinor: input.pointsDiscountMinor,
      pointsReservationState: input.pointsReservationState,
      pointsConfigSnapshot: input.pointsConfigSnapshot,
      referralRewardMinorSnapshot: input.referralRewardMinorSnapshot,
      tipMinor: input.tipMinor,
      subtotalMinor: input.subtotalMinor,
      totalMinor: input.totalMinor,
      answers: input.answers,
      checkoutTokenExpiresAt: input.checkoutTokenExpiresAt,
      status: 'pending_payment',
    });

    return {
      id,
      tenantId: input.tenantId,
      guildId: input.guildId,
      ticketChannelId: input.ticketChannelId,
      staffUserId: input.staffUserId,
      customerDiscordId: input.customerDiscordId,
      productId: input.productId,
      variantId: input.variantId,
      basketItems: input.basketItems,
      couponCode: input.couponCode,
      couponDiscountMinor: input.couponDiscountMinor,
      customerEmailNormalized: input.customerEmailNormalized,
      pointsReserved: input.pointsReserved,
      pointsDiscountMinor: input.pointsDiscountMinor,
      pointsReservationState: input.pointsReservationState,
      pointsConfigSnapshot: input.pointsConfigSnapshot,
      referralRewardMinorSnapshot: input.referralRewardMinorSnapshot,
      tipMinor: input.tipMinor,
      subtotalMinor: input.subtotalMinor,
      totalMinor: input.totalMinor,
      status: 'pending_payment',
      answers: input.answers,
      checkoutUrl: null,
      checkoutUrlCrypto: null,
      checkoutTokenExpiresAt: input.checkoutTokenExpiresAt,
    };
  }

  public async getOrderSession(input: {
    tenantId: string;
    orderSessionId: string;
  }): Promise<OrderSessionRecord | null> {
    const row = await this.db.query.orderSessions.findFirst({
      where: and(eq(orderSessions.id, input.orderSessionId), eq(orderSessions.tenantId, input.tenantId)),
    });

    if (!row) {
      return null;
    }

    return mapOrderSessionRow(row);
  }

  public async getOrderSessionById(orderSessionId: string): Promise<OrderSessionRecord | null> {
    const row = await this.db.query.orderSessions.findFirst({
      where: eq(orderSessions.id, orderSessionId),
    });

    if (!row) {
      return null;
    }

    return mapOrderSessionRow(row);
  }

  public async getLatestPendingSessionByChannel(input: {
    tenantId: string;
    guildId: string;
    ticketChannelId: string;
  }): Promise<OrderSessionRecord | null> {
    const rows = await this.db.query.orderSessions.findMany({
      where: and(
        eq(orderSessions.tenantId, input.tenantId),
        eq(orderSessions.guildId, input.guildId),
        eq(orderSessions.ticketChannelId, input.ticketChannelId),
      ),
      limit: 20,
    });

    const pending = rows
      .filter((row) => row.status === 'pending_payment')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (!pending) {
      return null;
    }

    return mapOrderSessionRow(pending);
  }

  public async setCheckoutUrl(input: {
    tenantId: string;
    orderSessionId: string;
    checkoutUrl: string;
    checkoutUrlCrypto?: string | null;
  }): Promise<void> {
    try {
      await this.db
        .update(orderSessions)
        .set({
          checkoutUrl: input.checkoutUrl,
          checkoutUrlCrypto: input.checkoutUrlCrypto ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(orderSessions.id, input.orderSessionId), eq(orderSessions.tenantId, input.tenantId)));
    } catch (error) {
      if (!input.checkoutUrlCrypto || !isMissingColumnError(error, 'checkout_url_crypto')) {
        throw error;
      }

      await this.db
        .update(orderSessions)
        .set({
          checkoutUrl: input.checkoutUrl,
          updatedAt: new Date(),
        })
        .where(and(eq(orderSessions.id, input.orderSessionId), eq(orderSessions.tenantId, input.tenantId)));
    }
  }

  public async cancelOrderSession(input: {
    tenantId: string;
    orderSessionId: string;
  }): Promise<boolean> {
    const current = await this.getOrderSession({
      tenantId: input.tenantId,
      orderSessionId: input.orderSessionId,
    });

    if (!current || current.status !== 'pending_payment') {
      return false;
    }

    await this.db
      .update(orderSessions)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(orderSessions.id, input.orderSessionId));

    return true;
  }

  public async markOrderSessionPaid(input: {
    tenantId: string;
    orderSessionId: string;
  }): Promise<void> {
    await this.db
      .update(orderSessions)
      .set({ status: 'paid', updatedAt: new Date() })
      .where(and(eq(orderSessions.id, input.orderSessionId), eq(orderSessions.tenantId, input.tenantId)));
  }

  public async setOrderSessionPointsReservationState(input: {
    tenantId: string;
    orderSessionId: string;
    state: OrderSessionPointsReservationState;
  }): Promise<void> {
    await this.db
      .update(orderSessions)
      .set({ pointsReservationState: input.state, updatedAt: new Date() })
      .where(and(eq(orderSessions.id, input.orderSessionId), eq(orderSessions.tenantId, input.tenantId)));
  }

  public async listExpiredReservedSessions(input: {
    tenantId: string;
    guildId: string;
  }): Promise<OrderSessionRecord[]> {
    const rows = await this.db.query.orderSessions.findMany({
      where: and(
        eq(orderSessions.tenantId, input.tenantId),
        eq(orderSessions.guildId, input.guildId),
        eq(orderSessions.status, 'pending_payment'),
        eq(orderSessions.pointsReservationState, 'reserved'),
        lt(orderSessions.checkoutTokenExpiresAt, new Date()),
      ),
      limit: 500,
    });

    return rows.map(mapOrderSessionRow);
  }

  public async createPaidOrder(input: {
    tenantId: string;
    guildId: string;
    orderSessionId: string;
    providerOrderId: string;
    status: string;
    priceMinor: number;
    currency: string;
    paymentReference: string | null;
  }): Promise<{ paidOrderId: string; created: boolean }> {
    const paidOrderId = ulid();
    try {
      await this.db.insert(ordersPaid).values({
        id: paidOrderId,
        tenantId: input.tenantId,
        guildId: input.guildId,
        orderSessionId: input.orderSessionId,
        wooOrderId: input.providerOrderId,
        status: input.status,
        priceMinor: input.priceMinor,
        currency: input.currency,
        paymentReference: input.paymentReference,
        updatedAt: new Date(),
      });
      return {
        paidOrderId,
        created: true,
      };
    } catch (error) {
      if (isMysqlDuplicateEntryError(error)) {
        const existing = await this.getPaidOrderByOrderSessionId(input.orderSessionId);
        if (!existing) {
          throw new Error('Paid order exists but could not be loaded by order session');
        }

        return {
          paidOrderId: existing.id,
          created: false,
        };
      }

      throw error;
    }
  }

  public async getPaidOrderById(paidOrderId: string): Promise<PaidOrderRecord | null> {
    const row = await this.db.query.ordersPaid.findFirst({
      where: eq(ordersPaid.id, paidOrderId),
    });

    if (!row) {
      return null;
    }

    return mapPaidOrderRow(row);
  }

  public async getPaidOrderByOrderSessionId(orderSessionId: string): Promise<PaidOrderRecord | null> {
    const row = await this.db.query.ordersPaid.findFirst({
      where: eq(ordersPaid.orderSessionId, orderSessionId),
    });

    if (!row) {
      return null;
    }

    return mapPaidOrderRow(row);
  }

  public async listPaidOrdersByGuild(input: {
    tenantId: string;
    guildId: string;
    limit?: number;
    since?: Date;
  }): Promise<PaidOrderRecord[]> {
    const rows = await this.db.query.ordersPaid.findMany({
      where: input.since
        ? and(
            eq(ordersPaid.tenantId, input.tenantId),
            eq(ordersPaid.guildId, input.guildId),
            gte(ordersPaid.paidAt, input.since),
          )
        : and(eq(ordersPaid.tenantId, input.tenantId), eq(ordersPaid.guildId, input.guildId)),
      orderBy: [desc(ordersPaid.paidAt)],
      limit: Math.max(1, Math.min(500, input.limit ?? 50)),
    });

    return rows.map(mapPaidOrderRow);
  }

  public async markPaidOrderFulfilled(input: {
    paidOrderId: string;
    actorDiscordUserId: string;
  }): Promise<void> {
    await this.db
      .update(ordersPaid)
      .set({
        fulfillmentStatus: 'fulfilled',
        fulfilledAt: new Date(),
        fulfilledByDiscordUserId: input.actorDiscordUserId,
        updatedAt: new Date(),
      })
      .where(eq(ordersPaid.id, input.paidOrderId));
  }

  public async cacheOrderNotes(input: {
    tenantId: string;
    guildId: string;
    orderSessionId: string;
    wooOrderId: string;
    latestInternalNote: string | null;
    latestCustomerNote: string | null;
  }): Promise<void> {
    const existing = await this.db.query.orderNotesCache.findFirst({
      where: eq(orderNotesCache.orderSessionId, input.orderSessionId),
    });

    if (existing) {
      await this.db
        .update(orderNotesCache)
        .set({
          latestInternalNote: input.latestInternalNote,
          latestCustomerNote: input.latestCustomerNote,
          fetchedAt: new Date(),
        })
        .where(eq(orderNotesCache.id, existing.id));
      return;
    }

    await this.db.insert(orderNotesCache).values({
      id: ulid(),
      tenantId: input.tenantId,
      guildId: input.guildId,
      orderSessionId: input.orderSessionId,
      wooOrderId: input.wooOrderId,
      latestInternalNote: input.latestInternalNote,
      latestCustomerNote: input.latestCustomerNote,
    });
  }

  public async createWebhookEvent(input: {
    tenantId: string;
    guildId: string | null;
    provider: 'woocommerce' | 'voodoopay';
    deliveryId: string;
    topic: string;
    signatureValid: boolean;
    payload: Record<string, unknown>;
  }): Promise<{ created: boolean; webhookEventId: string }> {
    const existing = await this.db.query.webhookEvents.findFirst({
      where: and(
        eq(webhookEvents.tenantId, input.tenantId),
        eq(webhookEvents.provider, input.provider),
        eq(webhookEvents.providerDeliveryId, input.deliveryId),
      ),
    });

    if (existing) {
      return { created: false, webhookEventId: existing.id };
    }

    const webhookEventId = ulid();
    await this.db.insert(webhookEvents).values({
      id: webhookEventId,
      tenantId: input.tenantId,
      guildId: input.guildId,
      provider: input.provider,
      providerDeliveryId: input.deliveryId,
      topic: input.topic,
      signatureValid: input.signatureValid,
      payload: input.payload,
      status: 'received',
      attemptCount: 0,
    });

    return { created: true, webhookEventId };
  }

  public async markWebhookProcessed(webhookEventId: string): Promise<void> {
    await this.db
      .update(webhookEvents)
      .set({
        status: 'processed',
        processedAt: new Date(),
      })
      .where(eq(webhookEvents.id, webhookEventId));
  }

  public async markWebhookFailed(input: {
    webhookEventId: string;
    failureReason: string;
    attemptCount: number;
    nextRetryAt: Date | null;
  }): Promise<void> {
    await this.db
      .update(webhookEvents)
      .set({
        status: 'failed',
        failureReason: input.failureReason,
        attemptCount: input.attemptCount,
        nextRetryAt: input.nextRetryAt,
      })
      .where(eq(webhookEvents.id, input.webhookEventId));
  }

  public async markWebhookDuplicate(webhookEventId: string): Promise<void> {
    await this.db
      .update(webhookEvents)
      .set({
        status: 'duplicate',
        processedAt: new Date(),
      })
      .where(eq(webhookEvents.id, webhookEventId));
  }

  public async getWebhookEventStatus(
    webhookEventId: string,
  ): Promise<'received' | 'processed' | 'failed' | 'duplicate' | null> {
    const row = await this.db.query.webhookEvents.findFirst({
      where: eq(webhookEvents.id, webhookEventId),
      columns: {
        status: true,
      },
    });

    return row?.status ?? null;
  }

  public async resetWebhookForRetry(webhookEventId: string): Promise<void> {
    await this.db
      .update(webhookEvents)
      .set({
        status: 'received',
        failureReason: null,
        nextRetryAt: null,
        processedAt: null,
      })
      .where(eq(webhookEvents.id, webhookEventId));
  }
}

import crypto from 'node:crypto';

import pRetry, { AbortError } from 'p-retry';
import { err, ok, type Result } from 'neverthrow';

import { getEnv } from '../config/env.js';
import { AppError, fromUnknownError } from '../domain/errors.js';
import type { WooOrderNote, WooOrderPayload } from '../domain/types.js';
import { logger } from '../infra/logger.js';
import { postMessageToDiscordChannel, sendDirectMessageToDiscordUser } from '../integrations/discord-rest.js';
import { postMessageToTelegramChat, sendDirectMessageToTelegramUser } from '../integrations/telegram-rest.js';
import { OrderRepository, type OrderSessionRecord } from '../repositories/order-repository.js';
import { ProductRepository } from '../repositories/product-repository.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import { verifyVoodooCallbackToken } from '../security/voodoo-callback-token.js';
import { isPaidWooStatus, verifyWooWebhookSignature } from '../security/webhook-signature.js';
import { resolveOrderSessionCustomerEmail } from '../utils/customer-email.js';
import { maskAnswers } from '../utils/mask.js';
import { formatUserReference, parsePlatformScopedId } from '../utils/platform-ids.js';
import { enqueueWebhookTask } from '../workers/webhook-queue.js';
import { AdminService } from './admin-service.js';
import { IntegrationService } from './integration-service.js';
import { getOrderSourceLabel } from './order-source.js';
import {
  buildPaidOrderFulfillmentComponents,
  buildPaidOrderFulfillmentTelegramReplyMarkup,
} from './paid-order-service.js';
import { calculateEarnFromAppliedDiscounts } from './points-calculator.js';
import { PointsService } from './points-service.js';
import { type ReferralRewardResult, ReferralService } from './referral-service.js';

function extractWooOrder(rawPayload: Record<string, unknown>): WooOrderPayload | null {
  const maybeOrder = (rawPayload.order ?? rawPayload) as Partial<WooOrderPayload>;

  if (!maybeOrder || typeof maybeOrder.id !== 'number' || typeof maybeOrder.status !== 'string') {
    return null;
  }

  return {
    id: maybeOrder.id,
    status: maybeOrder.status,
    number: maybeOrder.number,
    total: maybeOrder.total,
    currency: maybeOrder.currency,
    meta_data: Array.isArray(maybeOrder.meta_data)
      ? maybeOrder.meta_data.filter(
          (item): item is { id?: number; key: string; value: string | number | boolean | null } =>
            typeof item === 'object' &&
            item !== null &&
            'key' in item &&
            typeof item.key === 'string' &&
            'value' in item,
        )
      : [],
  };
}

function findOrderSessionId(order: WooOrderPayload): string | null {
  const record = order.meta_data?.find((meta) => meta.key === 'vd_order_session_id');
  if (!record) {
    return null;
  }

  if (typeof record.value === 'string') {
    return record.value;
  }

  if (typeof record.value === 'number') {
    return String(record.value);
  }

  return null;
}

function toMinor(total: string | undefined): number {
  if (!total) {
    return 0;
  }

  const numeric = Number(total);
  if (Number.isNaN(numeric)) {
    return 0;
  }

  return Math.round(numeric * 100);
}

function truncate(text: string | null, maxLength = 500): string | null {
  if (!text) {
    return null;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function firstNonEmpty(query: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = query[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function hasTruthySignal(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y') {
    return true;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0;
}

function hasPositiveAmount(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const numeric = Number(value.trim());
  return Number.isFinite(numeric) && numeric > 0;
}

function normalizeStatus(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

const VOODOO_PAID_STATUSES = new Set([
  'paid',
  'complete',
  'completed',
  'confirmed',
  'success',
  'successful',
  'done',
  'finished',
  'ok',
]);

const VOODOO_FAILED_STATUSES = new Set([
  'failed',
  'error',
  'cancelled',
  'canceled',
  'expired',
  'rejected',
  'invalid',
  'refunded',
]);

const VOODOO_UNPAID_STATUSES = new Set([
  'unpaid',
  'pending',
  'waiting',
  'awaiting',
  'processing',
  ...VOODOO_FAILED_STATUSES,
]);

type VoodooPaymentState = {
  paid: boolean;
  status: string | null;
  txidIn: string | null;
  txidOut: string | null;
  transactionId: string | null;
};

export function resolveVoodooPaymentState(query: Record<string, string>): VoodooPaymentState {
  const txidIn = firstNonEmpty(query, ['txid_in', 'tx_in', 'incoming_txid', 'txidin']);
  const txidOut = firstNonEmpty(query, ['txid_out', 'tx_out', 'outgoing_txid', 'txidout']);
  const transactionId = firstNonEmpty(query, [
    'txid',
    'transaction_id',
    'transaction_hash',
    'hash',
    'payment_id',
    'payment_hash',
  ]);

  const status = normalizeStatus(firstNonEmpty(query, ['status', 'payment_status', 'state', 'result']));
  const confirmed = hasTruthySignal(
    firstNonEmpty(query, ['confirmed', 'is_confirmed', 'paid', 'success', 'confirmations']),
  );
  const positiveAmount = hasPositiveAmount(
    firstNonEmpty(query, ['value_forwarded_coin', 'value_coin', 'amount', 'value']),
  );

  if (status && VOODOO_FAILED_STATUSES.has(status)) {
    return {
      paid: false,
      status,
      txidIn,
      txidOut,
      transactionId,
    };
  }

  if (txidIn || txidOut || transactionId || confirmed || positiveAmount) {
    return {
      paid: true,
      status,
      txidIn,
      txidOut,
      transactionId,
    };
  }

  if (status && VOODOO_PAID_STATUSES.has(status)) {
    return {
      paid: true,
      status,
      txidIn,
      txidOut,
      transactionId,
    };
  }

  return {
    paid: false,
    status,
    txidIn,
    txidOut,
    transactionId,
  };
}

export function buildVoodooDeliveryId(orderSessionId: string, query: Record<string, string>): string {
  const fingerprint = {
    orderSessionId,
    ipnToken: firstNonEmpty(query, ['ipn_token', 'callback_id']),
    txidIn: firstNonEmpty(query, ['txid_in', 'tx_in', 'incoming_txid', 'txidin']),
    txidOut: firstNonEmpty(query, ['txid_out', 'tx_out', 'outgoing_txid', 'txidout']),
    txid: firstNonEmpty(query, ['txid', 'transaction_id', 'transaction_hash', 'hash']),
    status: normalizeStatus(firstNonEmpty(query, ['status', 'payment_status', 'state', 'result'])),
    value: firstNonEmpty(query, ['value_forwarded_coin', 'value_coin', 'amount', 'value']),
  };

  const hash = crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex').slice(0, 60);
  return `vp-${hash}`;
}

function fitDiscordMessage(content: string, maxLength = 1900): string {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength - 20)}\n\n[message truncated]`;
}

function formatMinorAmount(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function formatBasketLines(
  basketItems: Array<{
    category: string;
    productName: string;
    variantLabel: string;
    priceMinor: number;
    currency: string;
  }>,
  fallback: {
    category: string;
    productName: string;
    variantLabel: string;
    priceMinor: number;
    currency: string;
  },
): string {
  if (basketItems.length === 0) {
    return `- \`${fallback.category} / ${fallback.productName} / ${fallback.variantLabel}\` - \`${formatMinorAmount(
      fallback.priceMinor,
      fallback.currency,
    )}\``;
  }

  return basketItems
    .map(
      (item, index) =>
        `${index + 1}. \`${item.category} / ${item.productName} / ${item.variantLabel}\` - \`${formatMinorAmount(
          item.priceMinor,
          item.currency,
        )}\``,
    )
    .join('\n');
}

export class WebhookService {
  private readonly env = getEnv();
  private readonly integrationService = new IntegrationService();
  private readonly orderRepository = new OrderRepository();
  private readonly productRepository = new ProductRepository();
  private readonly tenantRepository = new TenantRepository();
  private readonly adminService = new AdminService();
  private readonly pointsService = new PointsService();
  private readonly referralService = new ReferralService();

  private async checkVoodooPaymentStatus(
    ipnToken: string | null,
  ): Promise<{ paid: boolean; status: string | null }> {
    if (!ipnToken) {
      return { paid: false, status: null };
    }

    try {
      const statusUrl = new URL('/control/payment-status.php', this.env.VOODOO_PAY_API_BASE_URL);
      statusUrl.searchParams.set('ipn_token', ipnToken);

      const response = await fetch(statusUrl.toString());
      if (!response.ok) {
        return { paid: false, status: null };
      }

      const raw = (await response.text()).trim();
      if (!raw) {
        return { paid: false, status: null };
      }

      let statusCandidate: string | null = null;
      const maybeJson = raw.startsWith('{') || raw.startsWith('[');

      if (maybeJson) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown> | string | null;
          if (typeof parsed === 'string') {
            statusCandidate = parsed;
          } else if (parsed && typeof parsed === 'object') {
            statusCandidate = firstNonEmpty(
              Object.fromEntries(
                Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]),
              ),
              ['status', 'payment_status', 'result', 'state'],
            );
          }
        } catch {
          statusCandidate = raw;
        }
      } else {
        statusCandidate = raw;
      }

      const normalized = normalizeStatus(statusCandidate);
      if (!normalized) {
        return { paid: false, status: null };
      }

      if (VOODOO_PAID_STATUSES.has(normalized)) {
        return { paid: true, status: normalized };
      }

      if (VOODOO_UNPAID_STATUSES.has(normalized)) {
        return { paid: false, status: normalized };
      }

      return { paid: false, status: normalized };
    } catch {
      return { paid: false, status: null };
    }
  }

  public async handleWooWebhook(input: {
    tenantWebhookKey: string;
    rawBody: string;
    signatureHeader: string | null;
    topicHeader: string | null;
    deliveryIdHeader: string | null;
  }): Promise<Result<{ status: 'accepted' | 'duplicate' }, AppError>> {
    try {
      const integrationResult = await this.integrationService.getResolvedWooIntegrationByWebhookKey(
        input.tenantWebhookKey,
      );

      if (integrationResult.isErr()) {
        return err(integrationResult.error);
      }

      const integration = integrationResult.value;
      const payload = JSON.parse(input.rawBody) as Record<string, unknown>;
      const deliveryId = input.deliveryIdHeader ?? `missing-${Date.now()}`;
      const topic = input.topicHeader ?? 'unknown';

      const signatureValid = verifyWooWebhookSignature({
        rawBody: input.rawBody,
        secret: integration.webhookSecret,
        providedSignature: input.signatureHeader,
      });

      const created = await this.orderRepository.createWebhookEvent({
        tenantId: integration.tenantId,
        guildId: integration.guildId,
        provider: 'woocommerce',
        deliveryId,
        topic,
        signatureValid,
        payload,
      });

      if (!created.created) {
        const existingStatus = await this.orderRepository.getWebhookEventStatus(created.webhookEventId);
        if (existingStatus === 'failed') {
          logger.warn(
            {
              provider: 'woocommerce',
              tenantId: integration.tenantId,
              guildId: integration.guildId,
              webhookEventId: created.webhookEventId,
            },
            'duplicate webhook received for failed event; scheduling retry',
          );
          await this.orderRepository.resetWebhookForRetry(created.webhookEventId);
          this.enqueueWooProcessing({
            integration,
            payload,
            webhookEventId: created.webhookEventId,
          });
          return ok({ status: 'accepted' });
        }

        return ok({ status: 'duplicate' });
      }

      if (!signatureValid) {
        logger.warn(
          {
            provider: 'woocommerce',
            tenantId: integration.tenantId,
            guildId: integration.guildId,
            deliveryId,
            topic,
          },
          'woo webhook rejected: invalid signature',
        );
        await this.orderRepository.markWebhookFailed({
          webhookEventId: created.webhookEventId,
          failureReason: 'Invalid webhook signature',
          attemptCount: 1,
          nextRetryAt: null,
        });

        return err(new AppError('INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature', 401));
      }

      this.enqueueWooProcessing({
        integration,
        payload,
        webhookEventId: created.webhookEventId,
      });

      return ok({ status: 'accepted' });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async handleVoodooPayCallback(input: {
    tenantWebhookKey: string;
    query: Record<string, string>;
  }): Promise<Result<{ status: 'accepted' | 'duplicate' }, AppError>> {
    try {
      const integrationResult = await this.integrationService.getResolvedVoodooPayIntegrationByWebhookKey(
        input.tenantWebhookKey,
      );
      if (integrationResult.isErr()) {
        return err(integrationResult.error);
      }

      const integration = integrationResult.value;
      const orderSessionId = input.query.order_session_id;
      if (!orderSessionId) {
        return err(new AppError('MISSING_ORDER_SESSION_ID', 'Missing order_session_id in callback', 400));
      }

      const signatureValid = verifyVoodooCallbackToken({
        payload: {
          tenantId: integration.tenantId,
          guildId: integration.guildId,
          orderSessionId,
        },
        secret: integration.callbackSecret,
        providedToken: input.query.cb_token,
      });

      const deliveryId = buildVoodooDeliveryId(orderSessionId, input.query);

      const created = await this.orderRepository.createWebhookEvent({
        tenantId: integration.tenantId,
        guildId: integration.guildId,
        provider: 'voodoopay',
        deliveryId,
        topic: 'callback',
        signatureValid,
        payload: input.query,
      });

      if (!created.created) {
        const existingStatus = await this.orderRepository.getWebhookEventStatus(created.webhookEventId);
        if (existingStatus === 'failed') {
          logger.warn(
            {
              provider: 'voodoopay',
              tenantId: integration.tenantId,
              guildId: integration.guildId,
              webhookEventId: created.webhookEventId,
              orderSessionId,
            },
            'duplicate callback received for failed event; scheduling retry',
          );
          await this.orderRepository.resetWebhookForRetry(created.webhookEventId);
          this.enqueueVoodooProcessing({
            tenantId: integration.tenantId,
            guildId: integration.guildId,
            orderSessionId,
            query: input.query,
            webhookEventId: created.webhookEventId,
          });
          return ok({ status: 'accepted' });
        }

        return ok({ status: 'duplicate' });
      }

      if (!signatureValid) {
        logger.warn(
          {
            provider: 'voodoopay',
            tenantId: integration.tenantId,
            guildId: integration.guildId,
            orderSessionId,
            deliveryId,
            queryKeys: Object.keys(input.query),
          },
          'voodoo callback rejected: invalid callback token',
        );
        await this.orderRepository.markWebhookFailed({
          webhookEventId: created.webhookEventId,
          failureReason: 'Invalid callback token',
          attemptCount: 1,
          nextRetryAt: null,
        });

        return err(new AppError('INVALID_CALLBACK_SIGNATURE', 'Invalid callback token', 401));
      }

      this.enqueueVoodooProcessing({
        tenantId: integration.tenantId,
        guildId: integration.guildId,
        orderSessionId,
        query: input.query,
        webhookEventId: created.webhookEventId,
      });

      return ok({ status: 'accepted' });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  private enqueueWooProcessing(input: {
    integration: {
      tenantId: string;
      guildId: string;
      wpBaseUrl: string;
      consumerKey: string;
      consumerSecret: string;
    };
    payload: Record<string, unknown>;
    webhookEventId: string;
  }): void {
    void enqueueWebhookTask(async () => {
      await pRetry(
        async () => {
          await this.processWooPaidEvent({
            integration: input.integration,
            payload: input.payload,
            webhookEventId: input.webhookEventId,
          });
        },
        {
          retries: 3,
          minTimeout: 1_000,
          factor: 2,
          onFailedAttempt: async (error) => {
            const failureReason =
              error.error instanceof Error ? error.error.message : 'Webhook retry failure';
            const nextRetryAt = new Date(Date.now() + error.attemptNumber * 1000);
            logger.warn(
              {
                provider: 'woocommerce',
                webhookEventId: input.webhookEventId,
                attemptNumber: error.attemptNumber,
                retriesLeft: error.retriesLeft,
                failureReason,
              },
              'webhook processing retry scheduled',
            );
            await this.orderRepository.markWebhookFailed({
              webhookEventId: input.webhookEventId,
              failureReason,
              attemptCount: error.attemptNumber,
              nextRetryAt,
            });
          },
        },
      ).catch(async (error) => {
        const failureReason =
          error instanceof Error ? error.message : 'Unknown webhook processing failure';
        logger.error(
          {
            provider: 'woocommerce',
            webhookEventId: input.webhookEventId,
            failureReason,
          },
          'webhook processing failed permanently',
        );
        await this.orderRepository.markWebhookFailed({
          webhookEventId: input.webhookEventId,
          failureReason,
          attemptCount: 4,
          nextRetryAt: null,
        });
      });
    });
  }

  private enqueueVoodooProcessing(input: {
    tenantId: string;
    guildId: string;
    orderSessionId: string;
    query: Record<string, string>;
    webhookEventId: string;
  }): void {
    void enqueueWebhookTask(async () => {
      await pRetry(
        async () => {
          await this.processVoodooPayPaidEvent({
            tenantId: input.tenantId,
            guildId: input.guildId,
            orderSessionId: input.orderSessionId,
            query: input.query,
            webhookEventId: input.webhookEventId,
          });
        },
        {
          retries: 3,
          minTimeout: 1_000,
          factor: 2,
          onFailedAttempt: async (error) => {
            const failureReason =
              error.error instanceof Error ? error.error.message : 'Webhook retry failure';
            const nextRetryAt = new Date(Date.now() + error.attemptNumber * 1000);
            logger.warn(
              {
                provider: 'voodoopay',
                webhookEventId: input.webhookEventId,
                orderSessionId: input.orderSessionId,
                attemptNumber: error.attemptNumber,
                retriesLeft: error.retriesLeft,
                failureReason,
              },
              'webhook processing retry scheduled',
            );
            await this.orderRepository.markWebhookFailed({
              webhookEventId: input.webhookEventId,
              failureReason,
              attemptCount: error.attemptNumber,
              nextRetryAt,
            });
          },
        },
      ).catch(async (error) => {
        const failureReason =
          error instanceof Error ? error.message : 'Unknown webhook processing failure';
        logger.error(
          {
            provider: 'voodoopay',
            webhookEventId: input.webhookEventId,
            orderSessionId: input.orderSessionId,
            failureReason,
          },
          'webhook processing failed permanently',
        );
        await this.orderRepository.markWebhookFailed({
          webhookEventId: input.webhookEventId,
          failureReason,
          attemptCount: 4,
          nextRetryAt: null,
        });
      });
    });
  }

  private async processWooPaidEvent(input: {
    integration: {
      tenantId: string;
      guildId: string;
      wpBaseUrl: string;
      consumerKey: string;
      consumerSecret: string;
    };
    payload: Record<string, unknown>;
    webhookEventId: string;
  }): Promise<void> {
    const order = extractWooOrder(input.payload);
    if (!order) {
      throw new AbortError('Webhook payload does not contain a valid Woo order');
    }

    if (!isPaidWooStatus(order.status)) {
      await this.orderRepository.markWebhookProcessed(input.webhookEventId);
      return;
    }

    const orderSessionId = findOrderSessionId(order);
    if (!orderSessionId) {
      throw new AbortError('Missing vd_order_session_id in Woo order meta');
    }

    const orderSession = await this.orderRepository.getOrderSession({
      tenantId: input.integration.tenantId,
      orderSessionId,
    });

    if (!orderSession) {
      throw new AbortError('Order session not found for webhook');
    }

    const product = await this.productRepository.getById({
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      productId: orderSession.productId,
    });

    if (!product) {
      throw new AbortError('Product not found for paid order');
    }

    const variant = product.variants.find((item) => item.id === orderSession.variantId);
    if (!variant) {
      throw new AbortError('Variant not found for paid order');
    }

    const basketItems = orderSession.basketItems;
    const paidCurrency = basketItems[0]?.currency ?? variant.currency ?? order.currency ?? 'USD';
    const totalMinor =
      orderSession.totalMinor > 0
        ? orderSession.totalMinor
        : variant.priceMinor > 0
          ? variant.priceMinor
          : toMinor(order.total);
    const subtotalMinor = orderSession.subtotalMinor > 0 ? orderSession.subtotalMinor : totalMinor;
    const basketContent = formatBasketLines(basketItems, {
      category: product.category,
      productName: product.name,
      variantLabel: variant.label,
      priceMinor: variant.priceMinor,
      currency: variant.currency,
    });
    const couponLine =
      orderSession.couponCode && orderSession.couponDiscountMinor > 0
        ? `Coupon (${orderSession.couponCode}): -${formatMinorAmount(
            orderSession.couponDiscountMinor,
            paidCurrency,
          )}`
        : 'Coupon: (none)';
    const tipLine =
      orderSession.tipMinor > 0
        ? `Tip Added: +\`${formatMinorAmount(orderSession.tipMinor, paidCurrency)}\``
        : 'Tip Added: (none)';

    const paidOrder = await this.orderRepository.createPaidOrder({
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      orderSessionId: orderSession.id,
      providerOrderId: String(order.id),
      status: order.status,
      priceMinor: totalMinor,
      currency: paidCurrency,
      paymentReference: order.number ?? null,
    });

    if (!paidOrder.created) {
      logger.info(
        {
          provider: 'woocommerce',
          tenantId: orderSession.tenantId,
          guildId: orderSession.guildId,
          orderSessionId: orderSession.id,
          webhookEventId: input.webhookEventId,
        },
        'paid order record already existed; continuing webhook recovery flow',
      );
    }

    await this.orderRepository.markOrderSessionPaid({
      tenantId: orderSession.tenantId,
      orderSessionId: orderSession.id,
    });

    const config = await this.tenantRepository.getGuildConfig({
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
    });

    const finalized = await this.finalizePointsForPaidOrder({
      provider: 'woocommerce',
      webhookEventId: input.webhookEventId,
      orderSession,
      referralThankYouTemplate: config?.referralThankYouTemplate ?? null,
    });
    const updatedPointsBalance = finalized.updatedPointsBalance;

    const notes = await this.fetchWooNotes({
      wpBaseUrl: input.integration.wpBaseUrl,
      consumerKey: input.integration.consumerKey,
      consumerSecret: input.integration.consumerSecret,
      wooOrderId: order.id,
    });

    await this.orderRepository.cacheOrderNotes({
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      orderSessionId: orderSession.id,
      wooOrderId: String(order.id),
      latestInternalNote: truncate(notes.latestInternal),
      latestCustomerNote: truncate(notes.latestCustomer),
    });

    const sensitiveKeys = await this.productRepository.getSensitiveFieldKeys(orderSession.productId);
    const maskedAnswers = maskAnswers(orderSession.answers, sensitiveKeys);
    const answersContent = Object.entries(maskedAnswers)
      .map(([key, value]) => `- ${key}: \`${value.replace(/`/g, "'")}\``)
      .join('\n');

    const botTokensResult = await this.getBotTokenCandidates();
    if (botTokensResult.isErr()) {
      throw new AbortError(botTokensResult.error.message);
    }

    const message = [
      '**Order Paid**',
      `Provider: WooCommerce`,
      `Source: ${getOrderSourceLabel(orderSession.ticketChannelId)}`,
      `Order Session: \`${orderSession.id}\``,
      `Woo Order: ${order.id}`,
      '',
      '**Order Details**',
      `Subtotal: ${formatMinorAmount(subtotalMinor, paidCurrency)}`,
      couponLine,
      tipLine,
      `Total: ${formatMinorAmount(totalMinor, paidCurrency)}`,
      '',
      '**Basket**',
      basketContent,
      '',
      '**Answers**',
      answersContent || '- (none)',
      '',
      '**Order Notes**',
      `Internal: ${truncate(notes.latestInternal, 240) ?? '(none)'}`,
      `Customer: ${truncate(notes.latestCustomer, 240) ?? '(none)'}`,
      '',
      '**Referral**',
      this.describeReferralOutcome(finalized.referralResult),
    ].join('\n');

    if (parsePlatformScopedId(orderSession.ticketChannelId).platform === 'telegram') {
      if (config?.paidLogChannelId) {
        await this.postPaidLogMessage({
          botTokens: botTokensResult.value,
          preferredChannelId: config.paidLogChannelId,
          fallbackChannelId: config.paidLogChannelId,
          content: message,
          components: buildPaidOrderFulfillmentComponents({
            paidOrderId: paidOrder.paidOrderId,
            fulfillmentStatus: 'needs_action',
          }),
          telegramReplyMarkup: buildPaidOrderFulfillmentTelegramReplyMarkup({
            paidOrderId: paidOrder.paidOrderId,
            fulfillmentStatus: 'needs_action',
          }),
        });
      } else {
        logger.warn(
          {
            provider: 'woocommerce',
            tenantId: orderSession.tenantId,
            guildId: orderSession.guildId,
            orderSessionId: orderSession.id,
            webhookEventId: input.webhookEventId,
          },
          'skipping Telegram paid log because no Discord paid-log channel is configured',
        );
      }
    } else {
      await this.postPaidLogMessage({
        botTokens: botTokensResult.value,
        preferredChannelId: config?.paidLogChannelId ?? null,
        fallbackChannelId: orderSession.ticketChannelId,
        content: message,
        components: buildPaidOrderFulfillmentComponents({
          paidOrderId: paidOrder.paidOrderId,
          fulfillmentStatus: 'needs_action',
        }),
        telegramReplyMarkup: buildPaidOrderFulfillmentTelegramReplyMarkup({
          paidOrderId: paidOrder.paidOrderId,
          fulfillmentStatus: 'needs_action',
        }),
      });
    }
    await this.postTicketPaidConfirmation({
      botTokens: botTokensResult.value,
      ticketChannelId: orderSession.ticketChannelId,
      customerDiscordId: orderSession.customerDiscordId,
      orderSessionId: orderSession.id,
      productName: product.name,
      variantLabel: variant.label,
      currency: paidCurrency,
      priceMinor: totalMinor,
      updatedPointsBalance,
    });
    await this.postReferralOutcome({
      provider: 'woocommerce',
      botTokens: botTokensResult.value,
      referralLogChannelId: config?.referralLogChannelId ?? null,
      referralResult: finalized.referralResult,
      orderSessionId: orderSession.id,
    });

    logger.info(
      {
        provider: 'woocommerce',
        tenantId: orderSession.tenantId,
        guildId: orderSession.guildId,
        orderSessionId: orderSession.id,
        webhookEventId: input.webhookEventId,
        paidLogChannelId: config?.paidLogChannelId ?? null,
        fallbackChannelId: orderSession.ticketChannelId,
      },
      'paid log posted',
    );

    await this.orderRepository.markWebhookProcessed(input.webhookEventId);
  }

  private async processVoodooPayPaidEvent(input: {
    tenantId: string;
    guildId: string;
    orderSessionId: string;
    query: Record<string, string>;
    webhookEventId: string;
  }): Promise<void> {
    let paymentState = resolveVoodooPaymentState(input.query);
    if (!paymentState.paid) {
      const ipnToken = firstNonEmpty(input.query, ['ipn_token', 'callback_id']);
      const polledStatus = await this.checkVoodooPaymentStatus(ipnToken);
      if (polledStatus.paid) {
        paymentState = {
          ...paymentState,
          paid: true,
          status: polledStatus.status ?? paymentState.status ?? 'paid',
        };
      } else {
        logger.info(
          {
            provider: 'voodoopay',
            tenantId: input.tenantId,
            guildId: input.guildId,
            orderSessionId: input.orderSessionId,
            webhookEventId: input.webhookEventId,
            callbackStatus: paymentState.status,
            polledStatus: polledStatus.status,
            queryKeys: Object.keys(input.query),
          },
          'voodoo callback received but payment is not settled',
        );
        await this.orderRepository.markWebhookProcessed(input.webhookEventId);
        return;
      }
    }

    const orderSession = await this.orderRepository.getOrderSession({
      tenantId: input.tenantId,
      orderSessionId: input.orderSessionId,
    });

    if (!orderSession) {
      throw new AbortError('Order session not found for callback');
    }

    const product = await this.productRepository.getById({
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      productId: orderSession.productId,
    });

    if (!product) {
      throw new AbortError('Product not found for paid order');
    }

    const variant = product.variants.find((item) => item.id === orderSession.variantId);
    if (!variant) {
      throw new AbortError('Variant not found for paid order');
    }

    const basketItems = orderSession.basketItems;
    const paidCurrency = basketItems[0]?.currency ?? variant.currency ?? input.query.currency ?? 'USD';
    const totalMinor =
      orderSession.totalMinor > 0
        ? orderSession.totalMinor
        : variant.priceMinor > 0
          ? variant.priceMinor
          : toMinor(input.query.value_forwarded_coin ?? input.query.value_coin ?? input.query.amount);
    const subtotalMinor = orderSession.subtotalMinor > 0 ? orderSession.subtotalMinor : totalMinor;
    const basketContent = formatBasketLines(basketItems, {
      category: product.category,
      productName: product.name,
      variantLabel: variant.label,
      priceMinor: variant.priceMinor,
      currency: variant.currency,
    });
    const couponLine =
      orderSession.couponCode && orderSession.couponDiscountMinor > 0
        ? `Coupon (${orderSession.couponCode}): -${formatMinorAmount(
            orderSession.couponDiscountMinor,
            paidCurrency,
          )}`
        : 'Coupon: (none)';
    const tipLine =
      orderSession.tipMinor > 0
        ? `Tip Added: +\`${formatMinorAmount(orderSession.tipMinor, paidCurrency)}\``
        : 'Tip Added: (none)';

    const providerOrderId =
      paymentState.txidIn ??
      paymentState.txidOut ??
      paymentState.transactionId ??
      firstNonEmpty(input.query, ['ipn_token', 'callback_id']) ??
      input.orderSessionId;
    const paymentReference =
      paymentState.txidOut ?? paymentState.txidIn ?? paymentState.transactionId ?? null;
    const txidHash =
      paymentState.txidIn ?? paymentState.txidOut ?? paymentState.transactionId ?? '(none)';

    const paidOrder = await this.orderRepository.createPaidOrder({
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      orderSessionId: orderSession.id,
      providerOrderId,
      status: paymentState.status ?? 'paid',
      priceMinor: totalMinor,
      currency: paidCurrency,
      paymentReference,
    });

    if (!paidOrder.created) {
      logger.info(
        {
          provider: 'voodoopay',
          tenantId: orderSession.tenantId,
          guildId: orderSession.guildId,
          orderSessionId: orderSession.id,
          webhookEventId: input.webhookEventId,
        },
        'paid order record already existed; continuing webhook recovery flow',
      );
    }

    await this.orderRepository.markOrderSessionPaid({
      tenantId: orderSession.tenantId,
      orderSessionId: orderSession.id,
    });

    const config = await this.tenantRepository.getGuildConfig({
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
    });

    const finalized = await this.finalizePointsForPaidOrder({
      provider: 'voodoopay',
      webhookEventId: input.webhookEventId,
      orderSession,
      referralThankYouTemplate: config?.referralThankYouTemplate ?? null,
    });
    const updatedPointsBalance = finalized.updatedPointsBalance;

    const sensitiveKeys = await this.productRepository.getSensitiveFieldKeys(orderSession.productId);
    const maskedAnswers = maskAnswers(orderSession.answers, sensitiveKeys);
    const answersContent = Object.entries(maskedAnswers)
      .map(([key, value]) => `- ${key}: \`${value.replace(/`/g, "'")}\``)
      .join('\n');

    const botTokensResult = await this.getBotTokenCandidates();
    if (botTokensResult.isErr()) {
      throw new AbortError(botTokensResult.error.message);
    }

    const message = [
      '**Order Paid**',
      `Provider: Voodoo Pay`,
      `Source: ${getOrderSourceLabel(orderSession.ticketChannelId)}`,
      `Order Session: \`${orderSession.id}\``,
      `Status: ${paymentState.status ?? 'paid'}`,
      `TXID Hash: \`${String(txidHash).replace(/`/g, "'")}\``,
      `Coin: ${input.query.coin ?? '(unknown)'}`,
      `Forwarded Value: ${input.query.value_forwarded_coin ?? input.query.value_coin ?? '(unknown)'}`,
      '',
      '**Order Details**',
      `Subtotal: ${formatMinorAmount(subtotalMinor, paidCurrency)}`,
      couponLine,
      tipLine,
      `Total: ${formatMinorAmount(totalMinor, paidCurrency)}`,
      '',
      '**Basket**',
      basketContent,
      '',
      '**Answers**',
      answersContent || '- (none)',
      '',
      '**Referral**',
      this.describeReferralOutcome(finalized.referralResult),
    ].join('\n');

    if (parsePlatformScopedId(orderSession.ticketChannelId).platform === 'telegram') {
      if (config?.paidLogChannelId) {
        await this.postPaidLogMessage({
          botTokens: botTokensResult.value,
          preferredChannelId: config.paidLogChannelId,
          fallbackChannelId: config.paidLogChannelId,
          content: message,
          components: buildPaidOrderFulfillmentComponents({
            paidOrderId: paidOrder.paidOrderId,
            fulfillmentStatus: 'needs_action',
          }),
          telegramReplyMarkup: buildPaidOrderFulfillmentTelegramReplyMarkup({
            paidOrderId: paidOrder.paidOrderId,
            fulfillmentStatus: 'needs_action',
          }),
        });
      } else {
        logger.warn(
          {
            provider: 'voodoopay',
            tenantId: orderSession.tenantId,
            guildId: orderSession.guildId,
            orderSessionId: orderSession.id,
            webhookEventId: input.webhookEventId,
          },
          'skipping Telegram paid log because no Discord paid-log channel is configured',
        );
      }
    } else {
      await this.postPaidLogMessage({
        botTokens: botTokensResult.value,
        preferredChannelId: config?.paidLogChannelId ?? null,
        fallbackChannelId: orderSession.ticketChannelId,
        content: message,
        components: buildPaidOrderFulfillmentComponents({
          paidOrderId: paidOrder.paidOrderId,
          fulfillmentStatus: 'needs_action',
        }),
        telegramReplyMarkup: buildPaidOrderFulfillmentTelegramReplyMarkup({
          paidOrderId: paidOrder.paidOrderId,
          fulfillmentStatus: 'needs_action',
        }),
      });
    }
    await this.postTicketPaidConfirmation({
      botTokens: botTokensResult.value,
      ticketChannelId: orderSession.ticketChannelId,
      customerDiscordId: orderSession.customerDiscordId,
      orderSessionId: orderSession.id,
      productName: product.name,
      variantLabel: variant.label,
      currency: paidCurrency,
      priceMinor: totalMinor,
      updatedPointsBalance,
    });
    await this.postReferralOutcome({
      provider: 'voodoopay',
      botTokens: botTokensResult.value,
      referralLogChannelId: config?.referralLogChannelId ?? null,
      referralResult: finalized.referralResult,
      orderSessionId: orderSession.id,
    });

    logger.info(
      {
        provider: 'voodoopay',
        tenantId: orderSession.tenantId,
        guildId: orderSession.guildId,
        orderSessionId: orderSession.id,
        webhookEventId: input.webhookEventId,
        paidLogChannelId: config?.paidLogChannelId ?? null,
        fallbackChannelId: orderSession.ticketChannelId,
      },
      'paid log posted',
    );

    await this.orderRepository.markWebhookProcessed(input.webhookEventId);
  }

  private async finalizePointsForPaidOrder(input: {
    provider: 'woocommerce' | 'voodoopay';
    webhookEventId: string;
    orderSession: OrderSessionRecord;
    referralThankYouTemplate: string | null;
  }): Promise<{ updatedPointsBalance: number | null; referralResult: ReferralRewardResult }> {
    if (
      input.orderSession.pointsReservationState === 'released_expired' &&
      input.orderSession.pointsReserved > 0
    ) {
      logger.warn(
        {
          provider: input.provider,
          webhookEventId: input.webhookEventId,
          orderSessionId: input.orderSession.id,
          pointsReserved: input.orderSession.pointsReserved,
        },
        'payment confirmed after points reservation was released on expiry; skipping re-deduction',
      );
    }

    const consume = await this.pointsService.consumeReservationForPaidOrder({
      orderSession: input.orderSession,
    });
    if (consume.isErr()) {
      throw new AbortError(consume.error.message);
    }

    const snapshot = input.orderSession.pointsConfigSnapshot ?? {
      pointValueMinor: 1,
      earnCategoryKeys: [],
      redeemCategoryKeys: [],
    };
    const earned = calculateEarnFromAppliedDiscounts({
      lines: input.orderSession.basketItems.map((item) => ({
        category: item.category,
        priceMinor: item.priceMinor,
      })),
      couponDiscountMinor: input.orderSession.couponDiscountMinor,
      pointsDiscountMinor: input.orderSession.pointsDiscountMinor,
      earnCategoryKeys: snapshot.earnCategoryKeys,
      redeemCategoryKeys: snapshot.redeemCategoryKeys,
    });

    const addEarn = await this.pointsService.addEarnedPointsForPaidOrder({
      orderSession: input.orderSession,
      points: earned.pointsEarned,
    });
    if (addEarn.isErr()) {
      throw new AbortError(addEarn.error.message);
    }

    let updatedPointsBalance: number | null = null;
    const customerEmail = resolveOrderSessionCustomerEmail(input.orderSession);

    if (customerEmail) {
      if (addEarn.value) {
        updatedPointsBalance = addEarn.value.balancePoints;
      } else {
        const balance = await this.pointsService.getBalanceByNormalizedEmail({
          tenantId: input.orderSession.tenantId,
          guildId: input.orderSession.guildId,
          emailNormalized: customerEmail,
          emailDisplay: customerEmail,
          releaseExpiredReservations: false,
        });
        if (balance.isErr()) {
          throw new AbortError(balance.error.message);
        }

        updatedPointsBalance = balance.value.balancePoints;
      }
    }

    const referralResult = await this.referralService.processPaidOrderReward({
      orderSession: input.orderSession,
      referralThankYouTemplate: input.referralThankYouTemplate,
    });
    if (referralResult.isErr()) {
      throw new AbortError(referralResult.error.message);
    }

    return {
      updatedPointsBalance,
      referralResult: referralResult.value,
    };
  }

  private describeReferralOutcome(result: ReferralRewardResult): string {
    if (result.status === 'rewarded') {
      return `Rewarded ${result.rewardPoints} point(s) to referrer for ${result.referredEmailNormalized}.`;
    }

    const reasonMap: Record<NonNullable<Extract<ReferralRewardResult, { status: 'not_applicable' }>['reason']>, string> = {
      no_customer_email: 'No customer email captured on this order session.',
      not_first_paid: 'Not first paid order for this customer; referral reward skipped.',
      no_claim: 'No referral claim exists for this customer email.',
      self_blocked: 'Referral claim was blocked because referrer and referred emails match.',
      reward_disabled: 'Referral reward is disabled for this server.',
      reward_zero_points: 'Referral reward converts to 0 points with current snapshots.',
    };

    return reasonMap[result.reason];
  }

  private async postReferralOutcome(input: {
    provider: 'woocommerce' | 'voodoopay';
    botTokens: string[];
    referralLogChannelId: string | null;
    referralResult: ReferralRewardResult;
    orderSessionId: string;
  }): Promise<void> {
    // Referral log channel should contain actual referral payouts only.
    // Non-reward outcomes are already included in the paid-order log message.
    if (input.referralResult.status !== 'rewarded') {
      return;
    }

    let dmStatusLine = 'Thank-you DM: not sent';
    const dm = await this.sendReferralThankYouDm({
      botTokens: input.botTokens,
      userId: input.referralResult.referrerDiscordUserId,
      content: input.referralResult.thankYouMessage,
    });
    dmStatusLine = dm.sent
      ? `Thank-you DM: sent to ${formatUserReference(input.referralResult.referrerDiscordUserId)}`
      : `Thank-you DM: failed (${dm.errorMessage ?? 'unknown'})`;

    if (!input.referralLogChannelId) {
      if (dmStatusLine.includes('failed')) {
        logger.warn(
          {
            provider: input.provider,
            orderSessionId: input.orderSessionId,
            referralClaimId: input.referralResult.claimId,
          },
          dmStatusLine,
        );
      }
      return;
    }

    const message = [
      '**Referral Event**',
      `Provider: ${input.provider}`,
      `Order Session: \`${input.orderSessionId}\``,
      `Outcome: ${this.describeReferralOutcome(input.referralResult)}`,
      dmStatusLine,
    ].join('\n');

    try {
      await this.postPaidLogMessage({
        botTokens: input.botTokens,
        preferredChannelId: input.referralLogChannelId,
        fallbackChannelId: input.referralLogChannelId,
        content: message,
      });
    } catch (error) {
      logger.warn(
        {
          provider: input.provider,
          orderSessionId: input.orderSessionId,
          referralLogChannelId: input.referralLogChannelId,
          errorMessage: error instanceof Error ? error.message : 'unknown',
        },
        'failed to post referral outcome log message',
      );
    }
  }

  private async sendReferralThankYouDm(input: {
    botTokens: string[];
    userId: string;
    content: string;
  }): Promise<{ sent: boolean; errorMessage: string | null }> {
    const scopedUserId = parsePlatformScopedId(input.userId);
    if (scopedUserId.platform === 'telegram') {
      const telegramBotToken = this.getTelegramBotToken();
      if (!telegramBotToken) {
        return { sent: false, errorMessage: 'no Telegram bot token available' };
      }

      try {
        await sendDirectMessageToTelegramUser({
          botToken: telegramBotToken,
          userId: scopedUserId.rawId,
          content: input.content,
        });
        return { sent: true, errorMessage: null };
      } catch (error) {
        return {
          sent: false,
          errorMessage: error instanceof Error ? error.message : 'dm send failed',
        };
      }
    }

    const uniqueTokens = [...new Set(input.botTokens.map((token) => token.trim()).filter(Boolean))];
    if (uniqueTokens.length === 0) {
      return { sent: false, errorMessage: 'no bot token available' };
    }

    let lastError: unknown = null;
    for (const botToken of uniqueTokens) {
      try {
        await sendDirectMessageToDiscordUser({
          botToken,
          userId: input.userId,
          content: fitDiscordMessage(input.content),
        });
        return { sent: true, errorMessage: null };
      } catch (error) {
        lastError = error;
        if (this.isDiscordUnauthorized(error)) {
          continue;
        }
      }
    }

    return {
      sent: false,
      errorMessage: lastError instanceof Error ? lastError.message : 'dm send failed',
    };
  }

  private async getBotTokenCandidates(): Promise<Result<string[], AppError>> {
    const candidates: string[] = [];

    const resolved = await this.adminService.getResolvedBotToken();
    if (resolved.isOk()) {
      candidates.push(resolved.value.trim());
    }

    const envToken = this.env.DISCORD_TOKEN.trim();
    if (envToken && envToken !== 'MISSING_DISCORD_TOKEN' && !candidates.includes(envToken)) {
      candidates.push(envToken);
    }

    return ok(candidates.filter(Boolean));
  }

  private getTelegramBotToken(): string | null {
    const token = this.env.TELEGRAM_BOT_TOKEN.trim();
    return token.length > 0 ? token : null;
  }

  private isDiscordUnauthorized(error: unknown): boolean {
    if (!(error instanceof AppError)) {
      return false;
    }

    if (
      typeof error.details === 'object' &&
      error.details !== null &&
      'discordStatus' in error.details &&
      (error.details as { discordStatus?: unknown }).discordStatus === 401
    ) {
      return true;
    }

    return error.message.includes('(401)');
  }

  private async postPaidLogMessage(input: {
    botTokens: string[];
    preferredChannelId: string | null;
    fallbackChannelId: string;
    content: string;
    components?: Array<Record<string, unknown>>;
    telegramReplyMarkup?: Record<string, unknown>;
  }): Promise<void> {
    const targetChannels = [input.preferredChannelId, input.fallbackChannelId].filter(
      (channelId): channelId is string => Boolean(channelId),
    );
    const uniqueChannels = [...new Set(targetChannels)];

    if (uniqueChannels.length === 0) {
      throw new AbortError('No channel available for paid-order log message');
    }

    const uniqueTokens = [...new Set(input.botTokens.map((token) => token.trim()).filter(Boolean))];
    const telegramBotToken = this.getTelegramBotToken();

    let lastError: unknown = null;
    const deliveredChannels = new Set<string>();
    for (const channelId of uniqueChannels) {
      const scopedChannelId = parsePlatformScopedId(channelId);

      if (scopedChannelId.platform === 'telegram') {
        try {
          await this.postPaidLogToSingleChannel({
            channelId,
            botTokens: uniqueTokens,
            telegramBotToken,
            content: input.content,
            components: input.components,
            telegramReplyMarkup: input.telegramReplyMarkup,
          });
          deliveredChannels.add(channelId);
          break;
        } catch (error) {
          lastError = error;
          logger.warn(
            {
              provider: 'webhook-paid-log',
              channelId: scopedChannelId.rawId,
              platform: scopedChannelId.platform,
              unauthorized: false,
              errorMessage: error instanceof Error ? error.message : 'unknown',
            },
            'failed to post paid log to channel',
          );
        }

        continue;
      }

      if (uniqueTokens.length === 0) {
        lastError = new AbortError('No bot token available for paid-order log message');
        continue;
      }

      try {
        await this.postPaidLogToSingleChannel({
          channelId,
          botTokens: uniqueTokens,
          telegramBotToken,
          content: input.content,
          components: input.components,
          telegramReplyMarkup: input.telegramReplyMarkup,
        });
        deliveredChannels.add(channelId);
        break;
      } catch (error) {
        lastError = error;
        logger.warn(
          {
            provider: 'webhook-paid-log',
            channelId: scopedChannelId.rawId,
            platform: scopedChannelId.platform,
            unauthorized: this.isDiscordUnauthorized(error),
            errorMessage: error instanceof Error ? error.message : 'unknown',
          },
          'failed to post paid log to channel',
        );
      }
    }

    if (deliveredChannels.size === 0) {
      if (lastError instanceof Error) {
        throw lastError;
      }

      throw new AbortError('Failed to post paid-order log message');
    }

  }

  private async postPaidLogToSingleChannel(input: {
    channelId: string;
    botTokens: string[];
    telegramBotToken: string | null;
    content: string;
    components?: Array<Record<string, unknown>>;
    telegramReplyMarkup?: Record<string, unknown>;
  }): Promise<void> {
    const scopedChannelId = parsePlatformScopedId(input.channelId);

    if (scopedChannelId.platform === 'telegram') {
      if (!input.telegramBotToken) {
        throw new AbortError('No Telegram bot token available for paid-order log message');
      }

      await postMessageToTelegramChat({
        botToken: input.telegramBotToken,
        chatId: scopedChannelId.rawId,
        content: input.content,
        replyMarkup: input.telegramReplyMarkup,
      });
      return;
    }

    if (input.botTokens.length === 0) {
      throw new AbortError('No bot token available for paid-order log message');
    }

    let lastError: unknown = null;
    for (const botToken of input.botTokens) {
      try {
        await postMessageToDiscordChannel({
          botToken,
          channelId: scopedChannelId.rawId,
          content: fitDiscordMessage(input.content),
          components: input.components,
        });
        return;
      } catch (error) {
        lastError = error;
        if (this.isDiscordUnauthorized(error)) {
          continue;
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new AbortError('Failed to post paid-order log message');
  }

  private async postTicketPaidConfirmation(input: {
    botTokens: string[];
    ticketChannelId: string;
    customerDiscordId: string;
    orderSessionId: string;
    productName: string;
    variantLabel: string;
    currency: string;
    priceMinor: number;
    updatedPointsBalance: number | null;
  }): Promise<void> {
    const message = [
      `Payment received for <@${input.customerDiscordId}>. Thank you.`,
      `Order Session: ${input.orderSessionId}`,
      `Product: ${input.productName}`,
      `Variant: ${input.variantLabel}`,
      `Amount: ${(input.priceMinor / 100).toFixed(2)} ${input.currency}`,
      input.updatedPointsBalance === null
        ? 'Updated Points Balance: unavailable'
        : `Updated Points Balance: ${input.updatedPointsBalance} point(s)`,
    ].join('\n');

    const scopedChannelId = parsePlatformScopedId(input.ticketChannelId);
    if (scopedChannelId.platform === 'telegram') {
      const telegramBotToken = this.getTelegramBotToken();
      if (!telegramBotToken) {
        logger.warn(
          {
            ticketChannelId: input.ticketChannelId,
            customerDiscordId: input.customerDiscordId,
          },
          'skipping Telegram paid confirmation DM because no Telegram bot token is available',
        );
        return;
      }

      const scopedCustomerId = parsePlatformScopedId(input.customerDiscordId);
      if (scopedCustomerId.platform !== 'telegram') {
        logger.warn(
          {
            ticketChannelId: input.ticketChannelId,
            customerDiscordId: input.customerDiscordId,
          },
          'skipping Telegram paid confirmation DM because the customer ID is not a Telegram user',
        );
        return;
      }

      const directMessage = [
        'Payment received. Thank you.',
        `Order Session: ${input.orderSessionId}`,
        `Product: ${input.productName}`,
        `Variant: ${input.variantLabel}`,
        `Amount: ${(input.priceMinor / 100).toFixed(2)} ${input.currency}`,
        input.updatedPointsBalance === null
          ? 'Updated Points Balance: unavailable'
          : `Updated Points Balance: ${input.updatedPointsBalance} point(s)`,
      ].join('\n');

      try {
        await sendDirectMessageToTelegramUser({
          botToken: telegramBotToken,
          userId: scopedCustomerId.rawId,
          content: directMessage,
        });
      } catch (error) {
        logger.warn(
          {
            err: error,
            ticketChannelId: input.ticketChannelId,
            customerDiscordId: input.customerDiscordId,
          },
          'failed to DM Telegram paid confirmation to customer',
        );
      }
      return;
    }

    const uniqueTokens = [...new Set(input.botTokens.map((token) => token.trim()).filter(Boolean))];
    if (uniqueTokens.length === 0) {
      throw new AbortError('No bot token available for ticket paid confirmation');
    }

    let lastError: unknown = null;
    for (const botToken of uniqueTokens) {
      try {
        await postMessageToDiscordChannel({
          botToken,
          channelId: scopedChannelId.rawId,
          content: fitDiscordMessage(message),
        });
        return;
      } catch (error) {
        lastError = error;
        if (this.isDiscordUnauthorized(error)) {
          continue;
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new AbortError('Failed to post ticket paid confirmation');
  }

  private async fetchWooNotes(input: {
    wpBaseUrl: string;
    consumerKey: string;
    consumerSecret: string;
    wooOrderId: number;
  }): Promise<{ latestInternal: string | null; latestCustomer: string | null }> {
    const notesUrl = new URL(`/wp-json/wc/v3/orders/${input.wooOrderId}/notes`, input.wpBaseUrl).toString();
    const auth = Buffer.from(`${input.consumerKey}:${input.consumerSecret}`).toString('base64');

    const response = await fetch(notesUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      return {
        latestInternal: null,
        latestCustomer: null,
      };
    }

    const notes = (await response.json()) as WooOrderNote[];
    const latestInternal = [...notes].reverse().find((note) => note.customer_note === false)?.note ?? null;
    const latestCustomer = [...notes].reverse().find((note) => note.customer_note === true)?.note ?? null;

    return {
      latestInternal,
      latestCustomer,
    };
  }
}

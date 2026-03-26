import { err, ok, type Result } from 'neverthrow';
import { ulid } from 'ulid';
import { z } from 'zod';

import { getEnv } from '../config/env.js';
import { AppError, fromUnknownError, validationError } from '../domain/errors.js';
import { OrderRepository } from '../repositories/order-repository.js';
import { CouponRepository } from '../repositories/coupon-repository.js';
import { ProductRepository } from '../repositories/product-repository.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import { TicketMetadataRepository } from '../repositories/ticket-metadata-repository.js';
import { signCheckoutToken } from '../security/checkout-token.js';
import type { SessionPayload } from '../security/session-token.js';
import { signVoodooCallbackToken } from '../security/voodoo-callback-token.js';
import { resolveOrderSessionCustomerEmail } from '../utils/customer-email.js';
import { AuthorizationService } from './authorization-service.js';
import { computeCouponEligibleSubtotalMinor } from './coupon-scope.js';
import { GuildFeatureService } from './guild-feature-service.js';
import { IntegrationService, normalizeCheckoutDomain } from './integration-service.js';
import {
  calculatePointsOrderTotals,
  normalizeCategoryKey,
  normalizeCategoryKeyList,
} from './points-calculator.js';
import { PointsService } from './points-service.js';

const answerSchema = z.record(z.string(), z.string().max(2000));
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FALLBACK_EMAIL_DOMAIN = 'voodoopaybot.online';

type SaleSessionInput = {
  tenantId: string;
  guildId: string;
  ticketChannelId: string;
  staffDiscordUserId: string;
  customerDiscordUserId: string;
  defaultCurrency?: string;
  productId: string;
  variantId: string;
  items?: Array<{
    productId: string;
    variantId: string;
  }>;
  couponCode?: string | null;
  tipMinor?: number;
  usePoints?: boolean;
  answers: Record<string, string>;
};

type ResolvedSaleItem = {
  productId: string;
  productName: string;
  category: string;
  variantId: string;
  variantLabel: string;
  referralRewardMinor: number;
  priceMinor: number;
  currency: string;
};

type ResolvedPointsConfig = {
  pointValueMinor: number;
  earnCategoryKeys: string[];
  redeemCategoryKeys: string[];
  referralRewardMinor: number;
  referralRewardCategoryKeys: string[];
};

export type SaleCheckoutOption = {
  method: 'pay' | 'crypto';
  label: string;
  url: string;
};

type HostedCheckoutQueryParam = {
  key: string;
  value: string;
  preserveProviderEncoding?: boolean;
};

function buildHostedCheckoutUrl(input: {
  checkoutBaseUrl: string;
  path: string;
  params: HostedCheckoutQueryParam[];
}): string {
  const checkoutUrl = new URL(input.path, input.checkoutBaseUrl);
  const query = input.params
    .map((param) => {
      const trimmedValue = param.value.trim();
      const encodedValue = param.preserveProviderEncoding ? trimmedValue : encodeURIComponent(trimmedValue);
      return `${param.key}=${encodedValue}`;
    })
    .join('&');

  return query.length > 0 ? `${checkoutUrl.origin}${checkoutUrl.pathname}?${query}` : `${checkoutUrl.origin}${checkoutUrl.pathname}`;
}

export function buildVoodooPayHostedCheckoutUrl(input: {
  checkoutBaseUrl: string;
  address: string;
  amount: string;
  currency: string;
  checkoutDomain: string;
  vdToken: string;
  orderSessionId: string;
  email: string;
  ipnToken?: string | null;
}): string {
  return buildHostedCheckoutUrl({
    checkoutBaseUrl: input.checkoutBaseUrl,
    path: '/pay.php',
    params: [
      {
        key: 'address',
        value: input.address,
        preserveProviderEncoding: true,
      },
      {
        key: 'amount',
        value: input.amount,
      },
      {
        key: 'currency',
        value: input.currency,
      },
      {
        key: 'domain',
        value: input.checkoutDomain,
      },
      {
        key: 'vd_token',
        value: input.vdToken,
      },
      {
        key: 'vd_order_session_id',
        value: input.orderSessionId,
      },
      {
        key: 'email',
        value: input.email,
      },
      ...(input.ipnToken && input.ipnToken.trim().length > 0
        ? [
            {
              key: 'ipn_token',
              value: input.ipnToken,
              preserveProviderEncoding: true,
            },
          ]
        : []),
    ],
  });
}

export function buildVoodooPayHostedCryptoCheckoutUrl(input: {
  checkoutDomain: string;
  paymentToken: string;
  addFees: boolean;
}): string {
  return `https://${input.checkoutDomain}/crypto/hosted.php?payment_token=${input.paymentToken.trim()}&add_fees=${input.addFees ? '1' : '0'}`;
}

type SaleSessionResult = {
  orderSessionId: string;
  checkoutUrl: string;
  checkoutOptions: SaleCheckoutOption[];
  warnings: string[];
  expiresAt: string;
};

export function calculateReferralRewardMinorSnapshot(input: {
  items: Array<{
    category: string;
    variantReferralRewardMinor: number;
  }>;
  referralRewardCategoryKeys: string[];
  fallbackReferralRewardMinor: number;
}): number {
  const referralCategoryKeys = normalizeCategoryKeyList(input.referralRewardCategoryKeys);
  const enforceCategoryFilter = referralCategoryKeys.length > 0;
  const referralCategoryKeySet = new Set(referralCategoryKeys);
  const eligibleItems = input.items.filter((item) => {
    if (!enforceCategoryFilter) {
      return true;
    }

    return referralCategoryKeySet.has(normalizeCategoryKey(item.category));
  });

  if (eligibleItems.length === 0) {
    return 0;
  }

  const variantSpecificRewardMinor = eligibleItems.reduce(
    (sum, item) => sum + Math.max(0, Math.floor(item.variantReferralRewardMinor)),
    0,
  );
  if (variantSpecificRewardMinor > 0) {
    return variantSpecificRewardMinor;
  }

  return Math.max(0, Math.floor(input.fallbackReferralRewardMinor));
}

export class SaleService {
  private readonly env = getEnv();
  private readonly couponRepository = new CouponRepository();
  private readonly orderRepository = new OrderRepository();
  private readonly productRepository = new ProductRepository();
  private readonly tenantRepository = new TenantRepository();
  private readonly integrationService = new IntegrationService();
  private readonly ticketMetadataRepository = new TicketMetadataRepository();
  private readonly authorizationService = new AuthorizationService();
  private readonly pointsService = new PointsService();
  private readonly guildFeatureService = new GuildFeatureService();

  public async getSaleOptions(input: {
    tenantId: string;
    guildId: string;
  }): Promise<
    Result<
      Array<{
        productId: string;
        name: string;
        category: string;
        description: string;
        variants: Array<{ variantId: string; label: string; priceMinor: number; currency: string }>;
      }>,
      AppError
    >
  > {
    try {
      const products = await this.productRepository.listByGuild({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      return ok(
        products
          .filter((product) => product.active)
          .map((product) => ({
            productId: product.id,
            name: product.name,
            category: product.category,
            description: product.description,
            variants: product.variants.map((variant) => ({
              variantId: variant.id,
              label: variant.label,
              priceMinor: variant.priceMinor,
              currency: variant.currency,
            })),
          })),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async previewPointsForDraft(input: {
    tenantId: string;
    guildId: string;
    basketItems: Array<{
      productId: string;
      variantId: string;
      category: string;
      priceMinor: number;
    }>;
    couponCode?: string | null;
    tipMinor?: number;
    answers: Record<string, string>;
  }): Promise<
    Result<
      {
        canRedeem: boolean;
        emailNormalized: string | null;
        availablePoints: number;
        pointValueMinor: number;
        maxRedeemablePointsByAmount: number;
        pointsReservedIfUsed: number;
        pointsDiscountMinorIfUsed: number;
      },
      AppError
    >
  > {
    try {
      const parsedAnswers = answerSchema.safeParse(input.answers);
      if (!parsedAnswers.success) {
        return err(validationError(parsedAnswers.error.issues));
      }

      const pointsConfig = await this.resolvePointsConfig({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (pointsConfig.isErr()) {
        return err(pointsConfig.error);
      }

      const couponDiscountMinorResult = await this.resolveCouponDiscountMinor({
        tenantId: input.tenantId,
        guildId: input.guildId,
        couponCode: input.couponCode,
        basketItems: input.basketItems.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          priceMinor: item.priceMinor,
        })),
      });
      if (couponDiscountMinorResult.isErr()) {
        return err(couponDiscountMinorResult.error);
      }

      const customerEmail = this.findCustomerEmail(parsedAnswers.data);
      if (!customerEmail) {
        return ok({
          canRedeem: false,
          emailNormalized: null,
          availablePoints: 0,
          pointValueMinor: pointsConfig.value.pointValueMinor,
          maxRedeemablePointsByAmount: 0,
          pointsReservedIfUsed: 0,
          pointsDiscountMinorIfUsed: 0,
        });
      }

      const normalizedEmail = this.pointsService.normalizeEmail(customerEmail);
      if (normalizedEmail.isErr()) {
        return ok({
          canRedeem: false,
          emailNormalized: null,
          availablePoints: 0,
          pointValueMinor: pointsConfig.value.pointValueMinor,
          maxRedeemablePointsByAmount: 0,
          pointsReservedIfUsed: 0,
          pointsDiscountMinorIfUsed: 0,
        });
      }

      const released = await this.pointsService.releaseExpiredReservations({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (released.isErr()) {
        return err(released.error);
      }

      const balance = await this.pointsService.getBalanceByNormalizedEmail({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: normalizedEmail.value.emailNormalized,
        emailDisplay: normalizedEmail.value.emailDisplay,
        releaseExpiredReservations: false,
      });
      if (balance.isErr()) {
        return err(balance.error);
      }

      const calc = calculatePointsOrderTotals({
        lines: input.basketItems,
        couponDiscountMinor: couponDiscountMinorResult.value,
        tipMinor: Math.max(0, input.tipMinor ?? 0),
        pointValueMinor: pointsConfig.value.pointValueMinor,
        earnCategoryKeys: pointsConfig.value.earnCategoryKeys,
        redeemCategoryKeys: pointsConfig.value.redeemCategoryKeys,
        availablePoints: balance.value.availablePoints,
        usePoints: true,
      });

      return ok({
        canRedeem: calc.pointsReserved > 0,
        emailNormalized: normalizedEmail.value.emailNormalized,
        availablePoints: balance.value.availablePoints,
        pointValueMinor: pointsConfig.value.pointValueMinor,
        maxRedeemablePointsByAmount: calc.maxRedeemablePointsByAmount,
        pointsReservedIfUsed: calc.pointsReserved,
        pointsDiscountMinorIfUsed: calc.pointsDiscountMinor,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async isTicketChannel(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
  }): Promise<boolean> {
    return this.ticketMetadataRepository.isTicketChannel(input);
  }

  public async setTicketChannelFlag(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
    isTicket: boolean;
  }): Promise<Result<void, AppError>> {
    try {
      await this.ticketMetadataRepository.setTicketChannelFlag(input);
      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async createSaleSession(
    actor: SessionPayload,
    input: SaleSessionInput,
  ): Promise<Result<SaleSessionResult, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const tenantActiveCheck = await this.authorizationService.ensureTenantIsActive(input.tenantId);
      if (tenantActiveCheck.isErr()) {
        return err(tenantActiveCheck.error);
      }

      return await this.createSaleSessionInternal(input);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async createSaleSessionFromBot(input: SaleSessionInput): Promise<Result<SaleSessionResult, AppError>> {
    try {
      const tenantActiveCheck = await this.authorizationService.ensureTenantIsActive(input.tenantId);
      if (tenantActiveCheck.isErr()) {
        return err(tenantActiveCheck.error);
      }

      return await this.createSaleSessionInternal(input);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  private async createSaleSessionInternal(input: SaleSessionInput): Promise<Result<SaleSessionResult, AppError>> {
    const parsedAnswers = answerSchema.safeParse(input.answers);
    if (!parsedAnswers.success) {
      return err(validationError(parsedAnswers.error.issues));
    }

    const requestedItems =
      input.items && input.items.length > 0
        ? input.items
        : [
            {
              productId: input.productId,
              variantId: input.variantId,
            },
          ];

    const resolvedItemsResult = await this.resolveSaleItems({
      tenantId: input.tenantId,
      guildId: input.guildId,
      requestedItems,
    });
    if (resolvedItemsResult.isErr()) {
      return err(resolvedItemsResult.error);
    }
    const resolvedItems = resolvedItemsResult.value;
    const primaryItem = resolvedItems[0];
    if (!primaryItem) {
      return err(new AppError('BASKET_EMPTY', 'Basket must include at least one item', 400));
    }
    const configuredCurrency = input.defaultCurrency?.trim().toUpperCase() ?? '';
    const effectiveCheckoutCurrency =
      /^[A-Z]{3}$/.test(configuredCurrency) ? configuredCurrency : primaryItem.currency;
    const effectiveResolvedItems = resolvedItems.map((item) => ({
      ...item,
      currency: effectiveCheckoutCurrency,
    }));
    const effectivePrimaryItem = effectiveResolvedItems[0];
    if (!effectivePrimaryItem) {
      return err(new AppError('BASKET_EMPTY', 'Basket must include at least one item', 400));
    }

    const couponDiscountMinorResult = await this.resolveCouponDiscountMinor({
      tenantId: input.tenantId,
      guildId: input.guildId,
      couponCode: input.couponCode,
      basketItems: effectiveResolvedItems.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        priceMinor: item.priceMinor,
      })),
    });
    if (couponDiscountMinorResult.isErr()) {
      return err(couponDiscountMinorResult.error);
    }
    const couponDiscountMinor = couponDiscountMinorResult.value;
    const normalizedCouponCode = input.couponCode?.trim().toUpperCase() ?? null;

    const tipMinorRaw = input.tipMinor ?? 0;
    if (!Number.isInteger(tipMinorRaw) || tipMinorRaw < 0) {
      return err(new AppError('TIP_INVALID', 'Tip amount must be a non-negative integer minor amount', 400));
    }

    const pointsConfigResult = await this.resolvePointsConfig({
      tenantId: input.tenantId,
      guildId: input.guildId,
    });
    if (pointsConfigResult.isErr()) {
      return err(pointsConfigResult.error);
    }
    const pointsConfig = pointsConfigResult.value;
    const referralRewardMinorSnapshot = calculateReferralRewardMinorSnapshot({
      items: effectiveResolvedItems.map((item) => ({
        category: item.category,
        variantReferralRewardMinor: item.referralRewardMinor,
      })),
      referralRewardCategoryKeys: pointsConfig.referralRewardCategoryKeys,
      fallbackReferralRewardMinor: pointsConfig.referralRewardMinor,
    });

    const customerEmailFromAnswers = this.findCustomerEmail(parsedAnswers.data);
    let normalizedCustomerEmail: { emailNormalized: string; emailDisplay: string } | null = null;
    if (customerEmailFromAnswers) {
      const normalized = this.pointsService.normalizeEmail(customerEmailFromAnswers);
      if (normalized.isErr()) {
        return err(new AppError('CUSTOMER_EMAIL_INVALID', 'Customer email is invalid', 400));
      }
      normalizedCustomerEmail = normalized.value;
    }

    const persistedCustomerEmailNormalized = normalizedCustomerEmail
      ? resolveOrderSessionCustomerEmail({
          customerEmailNormalized: normalizedCustomerEmail.emailNormalized,
          customerDiscordId: input.customerDiscordUserId,
          ticketChannelId: input.ticketChannelId,
        })
      : null;
    if (!persistedCustomerEmailNormalized) {
      normalizedCustomerEmail = null;
    }

    let availablePoints = 0;
    if (normalizedCustomerEmail) {
      const release = await this.pointsService.releaseExpiredReservations({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (release.isErr()) {
        return err(release.error);
      }

      const balance = await this.pointsService.getBalanceByNormalizedEmail({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: normalizedCustomerEmail.emailNormalized,
        emailDisplay: normalizedCustomerEmail.emailDisplay,
        releaseExpiredReservations: false,
      });
      if (balance.isErr()) {
        return err(balance.error);
      }
      availablePoints = balance.value.availablePoints;
    }

    const calc = calculatePointsOrderTotals({
      lines: effectiveResolvedItems.map((item) => ({ category: item.category, priceMinor: item.priceMinor })),
      couponDiscountMinor,
      tipMinor: tipMinorRaw,
      pointValueMinor: pointsConfig.pointValueMinor,
      earnCategoryKeys: pointsConfig.earnCategoryKeys,
      redeemCategoryKeys: pointsConfig.redeemCategoryKeys,
      availablePoints,
      usePoints: Boolean(input.usePoints) && Boolean(normalizedCustomerEmail),
    });

    if (input.usePoints && calc.pointsReserved <= 0) {
      return err(
        new AppError(
          'POINTS_INSUFFICIENT',
          'No redeemable points are available for this checkout right now.',
          409,
        ),
      );
    }

    const voodooIntegration = await this.integrationService.getResolvedVoodooPayIntegrationByGuild({
      tenantId: input.tenantId,
      guildId: input.guildId,
    });
    const wooIntegration = await this.integrationService.getResolvedWooIntegrationByGuild({
      tenantId: input.tenantId,
      guildId: input.guildId,
    });

    if (voodooIntegration.isErr() && wooIntegration.isErr()) {
      return err(
        new AppError(
          'PAYMENT_INTEGRATION_NOT_CONFIGURED',
          'No payment integration configured for this guild',
          404,
        ),
      );
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const orderSessionId = ulid();
    const orderSession = await this.orderRepository.createOrderSession({
      id: orderSessionId,
      tenantId: input.tenantId,
      guildId: input.guildId,
      ticketChannelId: input.ticketChannelId,
      staffUserId: input.staffDiscordUserId,
      customerDiscordId: input.customerDiscordUserId,
      productId: effectivePrimaryItem.productId,
      variantId: effectivePrimaryItem.variantId,
      basketItems: effectiveResolvedItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        variantId: item.variantId,
        variantLabel: item.variantLabel,
        priceMinor: item.priceMinor,
        currency: item.currency,
      })),
      couponCode: normalizedCouponCode,
      couponDiscountMinor: calc.couponDiscountMinor,
      customerEmailNormalized: normalizedCustomerEmail?.emailNormalized ?? null,
      pointsReserved: calc.pointsReserved,
      pointsDiscountMinor: calc.pointsDiscountMinor,
      pointsReservationState: calc.pointsReserved > 0 ? 'reserved' : 'none',
      pointsConfigSnapshot: {
        pointValueMinor: pointsConfig.pointValueMinor,
        earnCategoryKeys: pointsConfig.earnCategoryKeys,
        redeemCategoryKeys: pointsConfig.redeemCategoryKeys,
      },
      referralRewardMinorSnapshot,
      tipMinor: calc.tipMinor,
      subtotalMinor: calc.subtotalMinor,
      totalMinor: calc.totalMinor,
      answers: parsedAnswers.data,
      checkoutTokenExpiresAt: expiresAt,
    });

    if (calc.pointsReserved > 0 && normalizedCustomerEmail) {
      const reserveResult = await this.pointsService.reservePointsForOrder({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: normalizedCustomerEmail.emailNormalized,
        emailDisplay: normalizedCustomerEmail.emailDisplay,
        points: calc.pointsReserved,
        orderSessionId: orderSession.id,
      });

      if (reserveResult.isErr()) {
        await this.tryCancelPendingOrderSession({
          tenantId: input.tenantId,
          orderSessionId: orderSession.id,
        });
        return err(reserveResult.error);
      }
    }

    const token = signCheckoutToken(
      {
        orderSessionId: orderSession.id,
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
      this.env.CHECKOUT_SIGNING_SECRET,
    );

    if (voodooIntegration.isOk()) {
      const warnings: string[] = [];
      const voodooCheckout = await this.buildVoodooPayCheckoutUrl({
        tenantId: input.tenantId,
        guildId: input.guildId,
        orderSessionId: orderSession.id,
        customerDiscordUserId: input.customerDiscordUserId,
        totalMinor: calc.totalMinor,
        currency: effectivePrimaryItem.currency,
        answers: parsedAnswers.data,
        integration: voodooIntegration.value,
        token,
      });

      if (voodooCheckout.isErr()) {
        await this.tryCancelPendingOrderSession({
          tenantId: input.tenantId,
          orderSessionId: orderSession.id,
        });
        return err(voodooCheckout.error);
      }

      let cryptoCheckoutUrl: string | null = null;
      if (voodooIntegration.value.cryptoGatewayEnabled) {
        const cryptoCheckout = await this.buildVoodooPayMulticoinCheckoutUrl({
          tenantId: input.tenantId,
          guildId: input.guildId,
          orderSessionId: orderSession.id,
          totalMinor: calc.totalMinor,
          currency: effectivePrimaryItem.currency,
          integration: voodooIntegration.value,
        });

        if (cryptoCheckout.isErr()) {
          warnings.push(
            `Crypto checkout could not be generated and was disabled for this sale: ${cryptoCheckout.error.message}`,
          );
        } else {
          cryptoCheckoutUrl = cryptoCheckout.value;
        }
      }

      const checkoutOptions: SaleCheckoutOption[] = [
        {
          method: 'pay',
          label: 'Pay',
          url: voodooCheckout.value,
        },
      ];
      if (cryptoCheckoutUrl) {
        checkoutOptions.push({
          method: 'crypto',
          label: 'Pay with Crypto',
          url: cryptoCheckoutUrl,
        });
      }

      await this.orderRepository.setCheckoutUrl({
        tenantId: input.tenantId,
        orderSessionId: orderSession.id,
        checkoutUrl: voodooCheckout.value,
        checkoutUrlCrypto: cryptoCheckoutUrl,
      });

      return ok({
        orderSessionId: orderSession.id,
        checkoutUrl: voodooCheckout.value,
        checkoutOptions,
        warnings,
        expiresAt: expiresAt.toISOString(),
      });
    }

    if (wooIntegration.isErr()) {
      return err(wooIntegration.error);
    }

    const productForCheckout = await this.productRepository.getById({
      tenantId: input.tenantId,
      guildId: input.guildId,
      productId: effectivePrimaryItem.productId,
    });
    const primaryVariantCheckoutPath =
      productForCheckout?.variants.find((item) => item.id === effectivePrimaryItem.variantId)?.wooCheckoutPath ?? null;

    const checkoutTarget =
      primaryVariantCheckoutPath && primaryVariantCheckoutPath.length > 0
        ? new URL(primaryVariantCheckoutPath, wooIntegration.value.wpBaseUrl)
        : new URL(wooIntegration.value.wpBaseUrl);

    checkoutTarget.searchParams.set('vd_token', token);
    checkoutTarget.searchParams.set('vd_order_session_id', orderSession.id);
    const providerCheckoutUrl = checkoutTarget.toString();

    await this.orderRepository.setCheckoutUrl({
      tenantId: input.tenantId,
      orderSessionId: orderSession.id,
      checkoutUrl: providerCheckoutUrl,
      checkoutUrlCrypto: null,
    });

    return ok({
      orderSessionId: orderSession.id,
      checkoutUrl: providerCheckoutUrl,
      checkoutOptions: [
        {
          method: 'pay',
          label: 'Pay',
          url: providerCheckoutUrl,
        },
      ],
      warnings: [],
      expiresAt: expiresAt.toISOString(),
    });
  }

  private async resolveCouponDiscountMinor(input: {
    tenantId: string;
    guildId: string;
    couponCode?: string | null;
    basketItems: Array<{
      productId: string;
      variantId: string;
      priceMinor: number;
    }>;
  }): Promise<Result<number, AppError>> {
    const normalizedCouponCode = input.couponCode?.trim().toUpperCase() ?? null;
    if (!normalizedCouponCode) {
      return ok(0);
    }

    const featureCheck = await this.guildFeatureService.ensureFeatureEnabled({
      tenantId: input.tenantId,
      guildId: input.guildId,
      feature: 'coupons',
    });
    if (featureCheck.isErr()) {
      return err(featureCheck.error);
    }

    const coupon = await this.couponRepository.getByCode({
      tenantId: input.tenantId,
      guildId: input.guildId,
      code: normalizedCouponCode,
    });
    if (!coupon || !coupon.active) {
      return err(new AppError('COUPON_NOT_FOUND', 'Coupon code is invalid or inactive', 404));
    }

    const eligibleSubtotalMinor = computeCouponEligibleSubtotalMinor(
      {
        allowedCategories: coupon.allowedCategories,
        allowedProductIds: coupon.allowedProductIds,
        allowedVariantIds: coupon.allowedVariantIds,
      },
      input.basketItems,
    );
    if (eligibleSubtotalMinor <= 0) {
      return err(
        new AppError(
          'COUPON_NOT_APPLICABLE',
          'Coupon does not apply to the selected products/variations.',
          409,
        ),
      );
    }

    return ok(Math.min(eligibleSubtotalMinor, coupon.discountMinor));
  }

  private async resolvePointsConfig(input: {
    tenantId: string;
    guildId: string;
  }): Promise<Result<ResolvedPointsConfig, AppError>> {
    const config = await this.tenantRepository.getGuildConfig(input);
    if (!config) {
      return err(new AppError('GUILD_CONFIG_NOT_FOUND', 'Guild config not found', 404));
    }

    return ok({
      pointValueMinor: Math.max(1, config.pointValueMinor),
      earnCategoryKeys: config.pointsEnabled ? normalizeCategoryKeyList(config.pointsEarnCategoryKeys) : [],
      redeemCategoryKeys: config.pointsEnabled ? normalizeCategoryKeyList(config.pointsRedeemCategoryKeys) : [],
      referralRewardMinor:
        config.pointsEnabled && config.referralsEnabled ? Math.max(0, config.referralRewardMinor) : 0,
      referralRewardCategoryKeys:
        config.pointsEnabled && config.referralsEnabled
          ? normalizeCategoryKeyList(config.referralRewardCategoryKeys)
          : [],
    });
  }

  private async buildVoodooPayCheckoutUrl(input: {
    tenantId: string;
    guildId: string;
    orderSessionId: string;
    customerDiscordUserId: string;
    totalMinor: number;
    currency: string;
    answers: Record<string, string>;
    integration: {
      tenantWebhookKey: string;
      merchantWalletAddress: string;
      callbackSecret: string;
      checkoutDomain: string;
    };
    token: string;
  }): Promise<Result<string, AppError>> {
    try {
      const callbackToken = signVoodooCallbackToken(
        {
          tenantId: input.tenantId,
          guildId: input.guildId,
          orderSessionId: input.orderSessionId,
        },
        input.integration.callbackSecret,
      );

      const callbackUrl = new URL(
        `/api/webhooks/voodoopay/${input.integration.tenantWebhookKey}/${input.orderSessionId}/${callbackToken}`,
        this.env.BOT_PUBLIC_URL,
      );
      // Keep query params for backward compatibility with existing callback handling.
      callbackUrl.searchParams.set('order_session_id', input.orderSessionId);
      callbackUrl.searchParams.set('cb_token', callbackToken);

      const createWalletUrl = new URL('/control/wallet.php', this.env.VOODOO_PAY_API_BASE_URL);
      createWalletUrl.searchParams.set('address', input.integration.merchantWalletAddress);
      createWalletUrl.searchParams.set('callback', callbackUrl.toString());

      const walletResponse = await fetch(createWalletUrl.toString());
      if (!walletResponse.ok) {
        return err(
          new AppError(
            'VOODOO_PAY_CREATE_WALLET_FAILED',
            `Voodoo Pay wallet creation failed with status ${walletResponse.status}`,
            502,
          ),
        );
      }

      const walletPayload = (await walletResponse.json()) as {
        address_in?: unknown;
        ipn_token?: unknown;
      };

      if (typeof walletPayload.address_in !== 'string' || walletPayload.address_in.length === 0) {
        return err(
          new AppError('VOODOO_PAY_INVALID_WALLET_RESPONSE', 'Missing address_in in wallet response', 502),
        );
      }

      const checkoutDomain = normalizeCheckoutDomain(input.integration.checkoutDomain);
      if (checkoutDomain.length === 0) {
        return err(
          new AppError(
            'VOODOO_PAY_CHECKOUT_DOMAIN_INVALID',
            'Configured checkout domain is invalid for standard checkout.',
            422,
          ),
        );
      }
      const customerEmail = this.resolveCheckoutEmail({
        answers: input.answers,
        customerDiscordUserId: input.customerDiscordUserId,
        orderSessionId: input.orderSessionId,
      });

      return ok(
        buildVoodooPayHostedCheckoutUrl({
          checkoutBaseUrl: this.env.VOODOO_PAY_CHECKOUT_BASE_URL,
          address: walletPayload.address_in,
          amount: (input.totalMinor / 100).toFixed(2),
          currency: input.currency,
          checkoutDomain,
          vdToken: input.token,
          orderSessionId: input.orderSessionId,
          email: customerEmail,
          ipnToken: typeof walletPayload.ipn_token === 'string' ? walletPayload.ipn_token : null,
        }),
      );
    } catch (error) {
      return err(fromUnknownError(error, 'VOODOO_PAY_CHECKOUT_FAILED'));
    }
  }

  private async buildVoodooPayMulticoinCheckoutUrl(input: {
    tenantId: string;
    guildId: string;
    orderSessionId: string;
    totalMinor: number;
    currency: string;
    integration: {
      tenantWebhookKey: string;
      callbackSecret: string;
      checkoutDomain: string;
      cryptoAddFees: boolean;
      cryptoWallets: {
        evm: string | null;
        btc: string | null;
        bitcoincash: string | null;
        ltc: string | null;
        doge: string | null;
        trc20: string | null;
        solana: string | null;
      };
    };
  }): Promise<Result<string, AppError>> {
    try {
      const callbackToken = signVoodooCallbackToken(
        {
          tenantId: input.tenantId,
          guildId: input.guildId,
          orderSessionId: input.orderSessionId,
        },
        input.integration.callbackSecret,
      );

      const callbackUrl = new URL(
        `/api/webhooks/voodoopay/${input.integration.tenantWebhookKey}/${input.orderSessionId}/${callbackToken}`,
        this.env.BOT_PUBLIC_URL,
      );
      callbackUrl.searchParams.set('order_session_id', input.orderSessionId);
      callbackUrl.searchParams.set('cb_token', callbackToken);

      const walletPayload: Record<string, string | number> = {
        fiat_amount: Number((input.totalMinor / 100).toFixed(2)),
        fiat_currency: input.currency,
        callback: callbackUrl.toString(),
      };

      for (const [key, value] of Object.entries(input.integration.cryptoWallets)) {
        if (typeof value !== 'string' || value.trim().length === 0) {
          continue;
        }
        walletPayload[key] = value.trim();
      }

      const createWalletUrl = new URL('/crypto/multi-hosted-wallet.php', this.env.VOODOO_PAY_API_BASE_URL);
      const walletResponse = await fetch(createWalletUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(walletPayload),
      });
      if (!walletResponse.ok) {
        return err(
          new AppError(
            'VOODOO_PAY_MULTICOIN_CREATE_WALLET_FAILED',
            `Voodoo Pay multicoin wallet creation failed with status ${walletResponse.status}`,
            502,
          ),
        );
      }

      const responsePayload = (await walletResponse.json()) as {
        payment_token?: unknown;
      };
      if (
        typeof responsePayload.payment_token !== 'string' ||
        responsePayload.payment_token.trim().length === 0
      ) {
        return err(
          new AppError(
            'VOODOO_PAY_MULTICOIN_INVALID_RESPONSE',
            'Missing payment_token in multicoin wallet response',
            502,
          ),
        );
      }

      const checkoutDomain = normalizeCheckoutDomain(input.integration.checkoutDomain);
      if (checkoutDomain.length === 0) {
        return err(
          new AppError(
            'VOODOO_PAY_MULTICOIN_CHECKOUT_DOMAIN_INVALID',
            'Configured checkout domain is invalid for hosted multi-coin checkout.',
            422,
          ),
        );
      }

      return ok(
        buildVoodooPayHostedCryptoCheckoutUrl({
          checkoutDomain,
          paymentToken: responsePayload.payment_token,
          addFees: input.integration.cryptoAddFees,
        }),
      );
    } catch (error) {
      return err(fromUnknownError(error, 'VOODOO_PAY_MULTICOIN_CHECKOUT_FAILED'));
    }
  }

  private findCustomerEmail(answers: Record<string, string>): string | null {
    for (const value of Object.values(answers)) {
      if (emailRegex.test(value.trim())) {
        return value.trim();
      }
    }

    return null;
  }

  private resolveCheckoutEmail(input: {
    answers: Record<string, string>;
    customerDiscordUserId: string;
    orderSessionId: string;
  }): string {
    const emailFromAnswers = this.findCustomerEmail(input.answers);
    if (emailFromAnswers) {
      return emailFromAnswers;
    }

    const localPartBase =
      input.customerDiscordUserId.trim().length > 0
        ? `discord-${input.customerDiscordUserId.trim()}`
        : `order-${input.orderSessionId.toLowerCase()}`;
    const localPart = localPartBase.replace(/[^a-zA-Z0-9._+-]/g, '').slice(0, 60) || 'customer';

    return `${localPart}@${this.resolveFallbackEmailDomain()}`;
  }

  private resolveFallbackEmailDomain(): string {
    try {
      const url = new URL(this.env.BOT_PUBLIC_URL);
      const hostname = url.hostname.trim().toLowerCase();
      if (hostname.includes('.')) {
        return hostname;
      }
    } catch {
      // ignore URL parsing failures and use static fallback domain.
    }

    return FALLBACK_EMAIL_DOMAIN;
  }

  private async tryCancelPendingOrderSession(input: {
    tenantId: string;
    orderSessionId: string;
  }): Promise<void> {
    try {
      const existing = await this.orderRepository.getOrderSession({
        tenantId: input.tenantId,
        orderSessionId: input.orderSessionId,
      });
      if (!existing) {
        return;
      }

      const cancelled = await this.orderRepository.cancelOrderSession(input);
      if (cancelled) {
        const released = await this.pointsService.releaseReservationForOrderSession({
          orderSession: existing,
          reason: 'cancelled',
        });
        if (released.isErr()) {
          // ignore release errors to preserve original response path.
        }
      }
    } catch {
      // ignore cancellation errors and preserve original failure response.
    }
  }

  private async resolveSaleItems(input: {
    tenantId: string;
    guildId: string;
    requestedItems: Array<{ productId: string; variantId: string }>;
  }): Promise<Result<ResolvedSaleItem[], AppError>> {
    const resolvedItems: ResolvedSaleItem[] = [];
    let basketCurrency: string | null = null;

    for (const requested of input.requestedItems) {
      const product = await this.productRepository.getById({
        tenantId: input.tenantId,
        guildId: input.guildId,
        productId: requested.productId,
      });
      if (!product || !product.active) {
        return err(new AppError('PRODUCT_NOT_FOUND', 'Product not found', 404));
      }

      const variant = product.variants.find((item) => item.id === requested.variantId);
      if (!variant) {
        return err(new AppError('VARIANT_NOT_FOUND', 'Variant not found', 404));
      }

      if (basketCurrency && basketCurrency !== variant.currency) {
        return err(
          new AppError(
            'BASKET_CURRENCY_MISMATCH',
            'All basket items must use the same currency',
            400,
          ),
        );
      }
      basketCurrency = variant.currency;

      resolvedItems.push({
        productId: product.id,
        productName: product.name,
        category: product.category,
        variantId: variant.id,
        variantLabel: variant.label,
        referralRewardMinor: Math.max(0, variant.referralRewardMinor),
        priceMinor: variant.priceMinor,
        currency: variant.currency,
      });
    }

    return ok(resolvedItems);
  }

  public async cancelLatestPendingSession(input: {
    tenantId: string;
    guildId: string;
    ticketChannelId: string;
  }): Promise<Result<{ orderSessionId: string }, AppError>> {
    try {
      const existing = await this.orderRepository.getLatestPendingSessionByChannel(input);
      if (!existing) {
        return err(new AppError('ORDER_SESSION_NOT_FOUND', 'No pending session found', 404));
      }

      const cancelled = await this.orderRepository.cancelOrderSession({
        tenantId: input.tenantId,
        orderSessionId: existing.id,
      });

      if (!cancelled) {
        return err(new AppError('ORDER_SESSION_NOT_CANCELABLE', 'Order session cannot be cancelled', 409));
      }

      const released = await this.pointsService.releaseReservationForOrderSession({
        orderSession: existing,
        reason: 'cancelled',
      });
      if (released.isErr()) {
        return err(released.error);
      }

      return ok({ orderSessionId: existing.id });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async getGuildRuntimeConfig(input: {
    tenantId: string;
    guildId: string;
  }): Promise<
    Result<
      {
        paidLogChannelId: string | null;
        staffRoleIds: string[];
        defaultCurrency: string;
        tipEnabled: boolean;
        pointsEarnCategoryKeys: string[];
        pointsRedeemCategoryKeys: string[];
        pointValueMinor: number;
        ticketMetadataKey: string;
      },
      AppError
    >
  > {
    try {
      const config = await this.tenantRepository.getGuildConfig(input);
      if (!config) {
        return err(new AppError('GUILD_CONFIG_NOT_FOUND', 'Guild config not found', 404));
      }

      return ok({
        paidLogChannelId: config.paidLogChannelId,
        staffRoleIds: config.staffRoleIds,
        defaultCurrency: config.defaultCurrency,
        tipEnabled: config.tipEnabled,
        pointsEarnCategoryKeys: config.pointsEarnCategoryKeys,
        pointsRedeemCategoryKeys: config.pointsRedeemCategoryKeys,
        pointValueMinor: config.pointValueMinor,
        ticketMetadataKey: config.ticketMetadataKey,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }
}

import { err, ok, type Result } from 'neverthrow';

import { AppError, fromUnknownError } from '../domain/errors.js';
import { IntegrationRepository } from '../repositories/integration-repository.js';
import { OrderRepository } from '../repositories/order-repository.js';
import { TelegramLinkRepository } from '../repositories/telegram-link-repository.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import type { SessionPayload } from '../security/session-token.js';
import { resolveOrderSessionCustomerEmail } from '../utils/customer-email.js';
import { AuthorizationService } from './authorization-service.js';

type DashboardRecentSale = {
  id: string;
  orderSessionId: string;
  priceMinor: number;
  currency: string;
  status: string;
  fulfillmentStatus: 'needs_action' | 'fulfilled';
  paymentReference: string | null;
  paidAt: string;
  customerEmail: string | null;
  ticketChannelId: string | null;
  productId: string | null;
  variantId: string | null;
};

export type DashboardSaleFilterRange = 'all' | 'day' | 'week' | 'month' | 'custom';

export type DashboardSale = {
  id: string;
  orderSessionId: string;
  priceMinor: number;
  currency: string;
  status: string;
  fulfillmentStatus: 'needs_action' | 'fulfilled';
  paymentReference: string | null;
  paidAt: string;
  paidDateKey: string;
  customerEmail: string | null;
  ticketChannelId: string | null;
  productId: string | null;
  productName: string | null;
  variantId: string | null;
  variantLabel: string | null;
};

export type DashboardSalesResult = {
  timezone: string;
  range: DashboardSaleFilterRange;
  fromDate: string | null;
  toDate: string | null;
  search: string;
  totalSalesMinor: number;
  totalSalesCount: number;
  sales: DashboardSale[];
};

export type DashboardOverview = {
  timezone: string;
  todayKey: string;
  todaySalesMinor: number;
  todaySalesCount: number;
  paymentsConfigured: boolean;
  cryptoEnabled: boolean;
  couponsEnabled: boolean;
  pointsEnabled: boolean;
  referralsEnabled: boolean;
  telegramEnabled: boolean;
  telegramLinked: boolean;
  recentSales: DashboardRecentSale[];
};

function resolveTimeZone(timeZone: string | null | undefined): string {
  const candidate = timeZone?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

function toDateKey(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

function shiftDateByDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function resolveLaterDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left.getTime() >= right.getTime() ? left : right;
}

function buildRelativeDateKeys(input: {
  now: Date;
  timeZone: string;
  days: number;
}): Set<string> {
  const keys = new Set<string>();

  for (let index = 0; index < input.days; index += 1) {
    keys.add(toDateKey(shiftDateByDays(input.now, -index), input.timeZone));
  }

  return keys;
}

function normalizeIsoDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function matchesRange(input: {
  range: DashboardSaleFilterRange;
  paidDateKey: string;
  todayKey: string;
  last7DateKeys: Set<string>;
  last30DateKeys: Set<string>;
  fromDate: string | null;
  toDate: string | null;
}): boolean {
  switch (input.range) {
    case 'day':
      return input.paidDateKey === input.todayKey;
    case 'week':
      return input.last7DateKeys.has(input.paidDateKey);
    case 'month':
      return input.last30DateKeys.has(input.paidDateKey);
    case 'custom':
      if (!input.fromDate || !input.toDate) {
        return false;
      }

      return input.paidDateKey >= input.fromDate && input.paidDateKey <= input.toDate;
    case 'all':
    default:
      return true;
  }
}

function matchesSearch(sale: DashboardSale, rawSearch: string): boolean {
  const normalizedSearch = rawSearch.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  const normalizedDateSearch = normalizedSearch.replace(/\//g, '-');
  const searchableFields = [
    sale.customerEmail?.toLowerCase() ?? '',
    sale.paymentReference?.toLowerCase() ?? '',
    sale.orderSessionId.toLowerCase(),
    sale.paidDateKey.toLowerCase(),
    sale.paidAt.toLowerCase(),
    sale.productName?.toLowerCase() ?? '',
    sale.variantLabel?.toLowerCase() ?? '',
  ];

  return searchableFields.some(
    (field) => field.includes(normalizedSearch) || field.includes(normalizedDateSearch),
  );
}

export class DashboardService {
  private readonly authorizationService = new AuthorizationService();
  private readonly tenantRepository = new TenantRepository();
  private readonly integrationRepository = new IntegrationRepository();
  private readonly telegramLinkRepository = new TelegramLinkRepository();
  private readonly orderRepository = new OrderRepository();

  public async getGuildOverview(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      timeZone?: string | null;
    },
  ): Promise<Result<DashboardOverview, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'member',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      const config = await this.tenantRepository.getGuildConfig({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (!config) {
        return err(new AppError('GUILD_CONFIG_NOT_FOUND', 'Guild config not found', 404));
      }

      const timeZone = resolveTimeZone(input.timeZone);
      const todayKey = toDateKey(new Date(), timeZone);
      const recentSummarySince = resolveLaterDate(
        config.salesHistoryClearedAt,
        new Date(Date.now() - 72 * 60 * 60 * 1000),
      );

      const [integration, telegramLink, recentOrders, summaryOrders] = await Promise.all([
        this.integrationRepository.getVoodooPayIntegrationByGuild({
          tenantId: input.tenantId,
          guildId: input.guildId,
        }),
        this.telegramLinkRepository.getByGuild({
          tenantId: input.tenantId,
          guildId: input.guildId,
        }),
        this.orderRepository.listPaidOrdersByGuild({
          tenantId: input.tenantId,
          guildId: input.guildId,
          limit: 8,
          since: config.salesHistoryClearedAt ?? undefined,
        }),
        this.orderRepository.listPaidOrdersByGuild({
          tenantId: input.tenantId,
          guildId: input.guildId,
          limit: 500,
          since: recentSummarySince ?? undefined,
        }),
      ]);

      const todayOrders = summaryOrders.filter((order) => toDateKey(order.paidAt, timeZone) === todayKey);
      const recentSales = await Promise.all(
        recentOrders.map(async (order) => {
          const session = await this.orderRepository.getOrderSessionById(order.orderSessionId);
          return {
            id: order.id,
            orderSessionId: order.orderSessionId,
            priceMinor: order.priceMinor,
            currency: order.currency,
            status: order.status,
            fulfillmentStatus: order.fulfillmentStatus,
            paymentReference: order.paymentReference,
            paidAt: order.paidAt.toISOString(),
            customerEmail: session ? resolveOrderSessionCustomerEmail(session) : null,
            ticketChannelId: session?.ticketChannelId ?? null,
            productId: session?.productId ?? null,
            variantId: session?.variantId ?? null,
          } satisfies DashboardRecentSale;
        }),
      );

      return ok({
        timezone: timeZone,
        todayKey,
        todaySalesMinor: todayOrders.reduce((sum, order) => sum + order.priceMinor, 0),
        todaySalesCount: todayOrders.length,
        paymentsConfigured: Boolean(integration?.merchantWalletAddress?.trim()),
        cryptoEnabled: Boolean(integration?.cryptoGatewayEnabled),
        couponsEnabled: config.couponsEnabled,
        pointsEnabled: config.pointsEnabled,
        referralsEnabled: config.referralsEnabled,
        telegramEnabled: config.telegramEnabled,
        telegramLinked: Boolean(telegramLink),
        recentSales,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async listGuildSales(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      timeZone?: string | null;
      range?: DashboardSaleFilterRange | null;
      fromDate?: string | null;
      toDate?: string | null;
      search?: string | null;
    },
  ): Promise<Result<DashboardSalesResult, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'member',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      const config = await this.tenantRepository.getGuildConfig({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (!config) {
        return err(new AppError('GUILD_CONFIG_NOT_FOUND', 'Guild config not found', 404));
      }

      const timeZone = resolveTimeZone(input.timeZone);
      const range = input.range ?? 'all';
      const fromDate = normalizeIsoDate(input.fromDate);
      const toDate = normalizeIsoDate(input.toDate);
      const search = input.search?.trim() ?? '';

      if (range === 'custom') {
        if (!fromDate || !toDate) {
          return err(
            new AppError(
              'INVALID_SALES_FILTER',
              'Custom date filters need both a from date and a to date.',
              400,
            ),
          );
        }

        if (fromDate > toDate) {
          return err(
            new AppError(
              'INVALID_SALES_FILTER',
              'The custom start date must be before or equal to the end date.',
              400,
            ),
          );
        }
      }

      const [orders, now] = await Promise.all([
        this.orderRepository.listPaidOrdersWithSessionsByGuild({
          tenantId: input.tenantId,
          guildId: input.guildId,
          since: config.salesHistoryClearedAt ?? undefined,
        }),
        Promise.resolve(new Date()),
      ]);

      const todayKey = toDateKey(now, timeZone);
      const last7DateKeys = buildRelativeDateKeys({ now, timeZone, days: 7 });
      const last30DateKeys = buildRelativeDateKeys({ now, timeZone, days: 30 });

      const sales = orders
        .map((order) => {
          const paidDateKey = toDateKey(order.paidAt, timeZone);
          const primaryBasketItem =
            order.basketItems?.find(
              (item) => item.productId === order.productId && item.variantId === order.variantId,
            ) ?? order.basketItems?.[0] ?? null;
          const customerEmail =
            order.customerDiscordId && order.ticketChannelId
              ? resolveOrderSessionCustomerEmail({
                  customerEmailNormalized: order.customerEmailNormalized,
                  customerDiscordId: order.customerDiscordId,
                  ticketChannelId: order.ticketChannelId,
                })
              : order.customerEmailNormalized?.trim().toLowerCase() ?? null;

          return {
            id: order.id,
            orderSessionId: order.orderSessionId,
            priceMinor: order.priceMinor,
            currency: order.currency,
            status: order.status,
            fulfillmentStatus: order.fulfillmentStatus,
            paymentReference: order.paymentReference,
            paidAt: order.paidAt.toISOString(),
            paidDateKey,
            customerEmail,
            ticketChannelId: order.ticketChannelId,
            productId: order.productId,
            productName: primaryBasketItem?.productName ?? null,
            variantId: order.variantId,
            variantLabel: primaryBasketItem?.variantLabel ?? null,
          } satisfies DashboardSale;
        })
        .filter((sale) =>
          matchesRange({
            range,
            paidDateKey: sale.paidDateKey,
            todayKey,
            last7DateKeys,
            last30DateKeys,
            fromDate,
            toDate,
          }),
        )
        .filter((sale) => matchesSearch(sale, search));

      return ok({
        timezone: timeZone,
        range,
        fromDate,
        toDate,
        search,
        totalSalesMinor: sales.reduce((sum, sale) => sum + sale.priceMinor, 0),
        totalSalesCount: sales.length,
        sales,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }
}

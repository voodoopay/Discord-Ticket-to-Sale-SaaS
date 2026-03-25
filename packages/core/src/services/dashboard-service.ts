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
        }),
        this.orderRepository.listPaidOrdersByGuild({
          tenantId: input.tenantId,
          guildId: input.guildId,
          limit: 500,
          since: new Date(Date.now() - 72 * 60 * 60 * 1000),
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
}

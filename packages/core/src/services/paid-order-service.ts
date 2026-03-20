import { err, ok, type Result } from 'neverthrow';

import { getEnv } from '../config/env.js';
import { AppError, fromUnknownError } from '../domain/errors.js';
import { postMessageToDiscordChannel } from '../integrations/discord-rest.js';
import { sendDirectMessageToTelegramUser } from '../integrations/telegram-rest.js';
import {
  OrderRepository,
  type PaidOrderFulfillmentStatus,
  type PaidOrderRecord,
} from '../repositories/order-repository.js';
import { parsePlatformScopedId } from '../utils/platform-ids.js';
import { AdminService } from './admin-service.js';

export const PAID_ORDER_FULFILLMENT_CUSTOM_ID_PREFIX = 'paid-order:fulfillment:';

export function buildPaidOrderFulfillmentCustomId(paidOrderId: string): string {
  return `${PAID_ORDER_FULFILLMENT_CUSTOM_ID_PREFIX}${paidOrderId}`;
}

export function parsePaidOrderFulfillmentCustomId(customId: string): string | null {
  if (!customId.startsWith(PAID_ORDER_FULFILLMENT_CUSTOM_ID_PREFIX)) {
    return null;
  }

  const paidOrderId = customId.slice(PAID_ORDER_FULFILLMENT_CUSTOM_ID_PREFIX.length).trim();
  return paidOrderId.length > 0 ? paidOrderId : null;
}

export function getPaidOrderFulfillmentButtonPresentation(status: PaidOrderFulfillmentStatus): {
  label: string;
  apiStyle: 3 | 4;
  disabled: boolean;
} {
  if (status === 'fulfilled') {
    return {
      label: 'Order Fulfilled',
      apiStyle: 3,
      disabled: true,
    };
  }

  return {
    label: 'Need Actioned',
    apiStyle: 4,
    disabled: false,
  };
}

export function buildPaidOrderFulfillmentComponents(input: {
  paidOrderId: string;
  fulfillmentStatus: PaidOrderFulfillmentStatus;
}): Array<Record<string, unknown>> {
  const presentation = getPaidOrderFulfillmentButtonPresentation(input.fulfillmentStatus);

  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: buildPaidOrderFulfillmentCustomId(input.paidOrderId),
          label: presentation.label,
          style: presentation.apiStyle,
          disabled: presentation.disabled,
        },
      ],
    },
  ];
}

export function buildPaidOrderFulfillmentTelegramReplyMarkup(input: {
  paidOrderId: string;
  fulfillmentStatus: PaidOrderFulfillmentStatus;
}): Record<string, unknown> {
  const presentation = getPaidOrderFulfillmentButtonPresentation(input.fulfillmentStatus);

  return {
    inline_keyboard: [
      [
        {
          text: presentation.label,
          callback_data: buildPaidOrderFulfillmentCustomId(input.paidOrderId),
        },
      ],
    ],
  };
}

function fitDiscordMessage(content: string, maxLength = 1900): string {
  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength - 20)}\n\n[message truncated]`;
}

function normalizeCustomerMessage(message: string | null | undefined): string | null {
  if (typeof message !== 'string') {
    return null;
  }

  const normalized = message.trim();
  return normalized.length > 0 ? normalized : null;
}

export type PaidOrderCustomerNotificationTarget = 'discord_channel' | 'telegram_dm';

export type PaidOrderCustomerNotificationResult = {
  attempted: boolean;
  delivered: boolean;
  target: PaidOrderCustomerNotificationTarget | null;
  errorMessage: string | null;
};

export class PaidOrderService {
  private readonly env = getEnv();
  private readonly adminService = new AdminService();
  private readonly orderRepository = new OrderRepository();

  public async getPaidOrderByGuild(input: {
    paidOrderId: string;
    guildId: string;
  }): Promise<Result<PaidOrderRecord, AppError>> {
    try {
      const paidOrder = await this.orderRepository.getPaidOrderById(input.paidOrderId);
      if (!paidOrder || paidOrder.guildId !== input.guildId) {
        return err(new AppError('PAID_ORDER_NOT_FOUND', 'Paid order not found for this server.', 404));
      }

      return ok(paidOrder);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async markPaidOrderFulfilled(input: {
    paidOrderId: string;
    guildId: string;
    actorDiscordUserId: string;
  }): Promise<
    Result<
      {
        paidOrderId: string;
        tenantId: string;
        guildId: string;
        orderSessionId: string;
        fulfillmentStatus: PaidOrderFulfillmentStatus;
        alreadyFulfilled: boolean;
        fulfilledAt: string | null;
        fulfilledByDiscordUserId: string | null;
      },
      AppError
    >
  > {
    try {
      const paidOrderResult = await this.getPaidOrderByGuild({
        paidOrderId: input.paidOrderId,
        guildId: input.guildId,
      });
      if (paidOrderResult.isErr()) {
        return err(paidOrderResult.error);
      }

      const existing = paidOrderResult.value;
      if (existing.fulfillmentStatus === 'fulfilled') {
        return ok({
          paidOrderId: existing.id,
          tenantId: existing.tenantId,
          guildId: existing.guildId,
          orderSessionId: existing.orderSessionId,
          fulfillmentStatus: existing.fulfillmentStatus,
          alreadyFulfilled: true,
          fulfilledAt: existing.fulfilledAt?.toISOString() ?? null,
          fulfilledByDiscordUserId: existing.fulfilledByDiscordUserId,
        });
      }

      await this.orderRepository.markPaidOrderFulfilled({
        paidOrderId: existing.id,
        actorDiscordUserId: input.actorDiscordUserId,
      });

      const updated = await this.orderRepository.getPaidOrderById(existing.id);
      if (!updated) {
        return err(new AppError('PAID_ORDER_NOT_FOUND', 'Paid order not found after update.', 404));
      }

      return ok({
        paidOrderId: updated.id,
        tenantId: updated.tenantId,
        guildId: updated.guildId,
        orderSessionId: updated.orderSessionId,
        fulfillmentStatus: updated.fulfillmentStatus,
        alreadyFulfilled: false,
        fulfilledAt: updated.fulfilledAt?.toISOString() ?? null,
        fulfilledByDiscordUserId: updated.fulfilledByDiscordUserId,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async completePaidOrderFulfillment(input: {
    paidOrderId: string;
    guildId: string;
    actorDiscordUserId: string;
    customerMessage?: string | null;
  }): Promise<
    Result<
      {
        paidOrderId: string;
        tenantId: string;
        guildId: string;
        orderSessionId: string;
        fulfillmentStatus: PaidOrderFulfillmentStatus;
        alreadyFulfilled: boolean;
        fulfilledAt: string | null;
        fulfilledByDiscordUserId: string | null;
        customerNotification: PaidOrderCustomerNotificationResult;
      },
      AppError
    >
  > {
    const fulfilledResult = await this.markPaidOrderFulfilled({
      paidOrderId: input.paidOrderId,
      guildId: input.guildId,
      actorDiscordUserId: input.actorDiscordUserId,
    });
    if (fulfilledResult.isErr()) {
      return err(fulfilledResult.error);
    }

    const customerNotification = await this.sendCustomerFulfillmentMessage({
      orderSessionId: fulfilledResult.value.orderSessionId,
      customerMessage: input.customerMessage ?? null,
    });

    return ok({
      ...fulfilledResult.value,
      customerNotification,
    });
  }

  private async sendCustomerFulfillmentMessage(input: {
    orderSessionId: string;
    customerMessage: string | null;
  }): Promise<PaidOrderCustomerNotificationResult> {
    const message = normalizeCustomerMessage(input.customerMessage);
    if (!message) {
      return {
        attempted: false,
        delivered: false,
        target: null,
        errorMessage: null,
      };
    }

    let orderSession;
    try {
      orderSession = await this.orderRepository.getOrderSessionById(input.orderSessionId);
    } catch (error) {
      return {
        attempted: true,
        delivered: false,
        target: null,
        errorMessage: error instanceof Error ? error.message : 'Order session could not be loaded.',
      };
    }

    if (!orderSession) {
      return {
        attempted: true,
        delivered: false,
        target: null,
        errorMessage: 'Order session could not be found for customer delivery.',
      };
    }

    const scopedChannelId = parsePlatformScopedId(orderSession.ticketChannelId);
    if (scopedChannelId.platform === 'telegram') {
      return this.sendTelegramCustomerFulfillmentMessage({
        customerDiscordId: orderSession.customerDiscordId,
        content: message,
      });
    }

    return this.sendDiscordCustomerFulfillmentMessage({
      ticketChannelId: scopedChannelId.rawId,
      customerDiscordId: orderSession.customerDiscordId,
      content: message,
    });
  }

  private async sendDiscordCustomerFulfillmentMessage(input: {
    ticketChannelId: string;
    customerDiscordId: string;
    content: string;
  }): Promise<PaidOrderCustomerNotificationResult> {
    const botTokensResult = await this.getBotTokenCandidates();
    if (botTokensResult.isErr()) {
      return {
        attempted: true,
        delivered: false,
        target: 'discord_channel',
        errorMessage: botTokensResult.error.message,
      };
    }

    const scopedCustomerId = parsePlatformScopedId(input.customerDiscordId);
    const mentionPrefix =
      scopedCustomerId.platform === 'discord' && scopedCustomerId.rawId.length > 0
        ? `<@${scopedCustomerId.rawId}>`
        : null;
    const message = fitDiscordMessage(mentionPrefix ? `${mentionPrefix}\n${input.content}` : input.content);

    let lastError: unknown = null;
    for (const botToken of botTokensResult.value) {
      try {
        await postMessageToDiscordChannel({
          botToken,
          channelId: input.ticketChannelId,
          content: message,
          allowedMentions: mentionPrefix
            ? {
                parse: [],
                users: [scopedCustomerId.rawId],
              }
            : {
                parse: [],
              },
        });

        return {
          attempted: true,
          delivered: true,
          target: 'discord_channel',
          errorMessage: null,
        };
      } catch (error) {
        lastError = error;
        if (this.isDiscordUnauthorized(error)) {
          continue;
        }
      }
    }

    return {
      attempted: true,
      delivered: false,
      target: 'discord_channel',
      errorMessage: lastError instanceof Error ? lastError.message : 'Customer message delivery failed.',
    };
  }

  private async sendTelegramCustomerFulfillmentMessage(input: {
    customerDiscordId: string;
    content: string;
  }): Promise<PaidOrderCustomerNotificationResult> {
    const telegramBotToken = this.getTelegramBotToken();
    if (!telegramBotToken) {
      return {
        attempted: true,
        delivered: false,
        target: 'telegram_dm',
        errorMessage: 'No Telegram bot token available for customer delivery.',
      };
    }

    const scopedCustomerId = parsePlatformScopedId(input.customerDiscordId);
    if (scopedCustomerId.platform !== 'telegram') {
      return {
        attempted: true,
        delivered: false,
        target: 'telegram_dm',
        errorMessage: 'Telegram customer ID is missing for this order.',
      };
    }

    try {
      await sendDirectMessageToTelegramUser({
        botToken: telegramBotToken,
        userId: scopedCustomerId.rawId,
        content: input.content,
      });

      return {
        attempted: true,
        delivered: true,
        target: 'telegram_dm',
        errorMessage: null,
      };
    } catch (error) {
      return {
        attempted: true,
        delivered: false,
        target: 'telegram_dm',
        errorMessage: error instanceof Error ? error.message : 'Customer message delivery failed.',
      };
    }
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
}

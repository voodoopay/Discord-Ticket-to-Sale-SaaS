import { err, ok, type Result } from 'neverthrow';

import { AppError, fromUnknownError } from '../domain/errors.js';
import {
  OrderRepository,
  type PaidOrderFulfillmentStatus,
  type PaidOrderRecord,
} from '../repositories/order-repository.js';

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

export class PaidOrderService {
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
}

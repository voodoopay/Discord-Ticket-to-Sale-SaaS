import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from 'neverthrow';

import * as discordRest from '../src/integrations/discord-rest.js';
import * as telegramRest from '../src/integrations/telegram-rest.js';
import type { OrderSessionRecord } from '../src/repositories/order-repository.js';
import {
  buildPaidOrderFulfillmentComponents,
  buildPaidOrderFulfillmentCustomId,
  getPaidOrderFulfillmentButtonPresentation,
  PaidOrderService,
  parsePaidOrderFulfillmentCustomId,
} from '../src/services/paid-order-service.js';

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
    pointsReserved: 0,
    pointsDiscountMinor: 0,
    pointsReservationState: 'consumed',
    pointsConfigSnapshot: {
      pointValueMinor: 100,
      earnCategoryKeys: [],
      redeemCategoryKeys: [],
    },
    referralRewardMinorSnapshot: 0,
    tipMinor: 0,
    subtotalMinor: 1500,
    totalMinor: 1500,
    status: 'paid',
    answers: {},
    checkoutUrl: null,
    checkoutUrlCrypto: null,
    checkoutTokenExpiresAt: new Date(),
    ...overrides,
  };
}

describe('paid order fulfillment helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds and parses the paid-order fulfillment custom id', () => {
    const customId = buildPaidOrderFulfillmentCustomId('01TESTPAIDORDERID1234567890');

    expect(customId).toBe('paid-order:fulfillment:01TESTPAIDORDERID1234567890');
    expect(parsePaidOrderFulfillmentCustomId(customId)).toBe('01TESTPAIDORDERID1234567890');
    expect(parsePaidOrderFulfillmentCustomId('sale:action:123')).toBeNull();
  });

  it('returns danger presentation for needs_action state', () => {
    expect(getPaidOrderFulfillmentButtonPresentation('needs_action')).toEqual({
      label: 'Need Actioned',
      apiStyle: 4,
      disabled: false,
    });
  });

  it('returns success presentation and disabled button for fulfilled state', () => {
    expect(getPaidOrderFulfillmentButtonPresentation('fulfilled')).toEqual({
      label: 'Order Fulfilled',
      apiStyle: 3,
      disabled: true,
    });
  });

  it('builds raw Discord components for the fulfillment button', () => {
    expect(
      buildPaidOrderFulfillmentComponents({
        paidOrderId: '01TESTPAIDORDERID1234567890',
        fulfillmentStatus: 'needs_action',
      }),
    ).toEqual([
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: 'paid-order:fulfillment:01TESTPAIDORDERID1234567890',
            label: 'Need Actioned',
            style: 4,
            disabled: false,
          },
        ],
      },
    ]);
  });

  it('sends an optional fulfillment message to the Discord sale channel', async () => {
    const service = new PaidOrderService();
    const orderSession = makeOrderSession();

    vi.spyOn((service as any).orderRepository, 'getOrderSessionById').mockResolvedValue(orderSession);
    vi.spyOn(service as any, 'getBotTokenCandidates').mockResolvedValue(ok(['bot-token']));
    const postMessageToDiscordChannel = vi
      .spyOn(discordRest, 'postMessageToDiscordChannel')
      .mockResolvedValue(undefined);

    const result = await (service as any).sendCustomerFulfillmentMessage({
      orderSessionId: orderSession.id,
      customerMessage: 'Your order details are ready.',
    });

    expect(result).toEqual({
      attempted: true,
      delivered: true,
      target: 'discord_channel',
      errorMessage: null,
    });
    expect(postMessageToDiscordChannel).toHaveBeenCalledWith({
      botToken: 'bot-token',
      channelId: '223456789012345678',
      content: '<@423456789012345678>\nYour order details are ready.',
      allowedMentions: {
        parse: [],
        users: ['423456789012345678'],
      },
    });
  });

  it('sends an optional fulfillment message to the Telegram customer DM', async () => {
    const service = new PaidOrderService();
    const orderSession = makeOrderSession({
      ticketChannelId: 'tg:-100123456',
      customerDiscordId: 'tg:99887766',
    });

    vi.spyOn((service as any).orderRepository, 'getOrderSessionById').mockResolvedValue(orderSession);
    vi.spyOn(service as any, 'getTelegramBotToken').mockReturnValue('telegram-token');
    const sendDirectMessageToTelegramUser = vi
      .spyOn(telegramRest, 'sendDirectMessageToTelegramUser')
      .mockResolvedValue({ messageId: 123 });

    const result = await (service as any).sendCustomerFulfillmentMessage({
      orderSessionId: orderSession.id,
      customerMessage: 'Your account has been set up.',
    });

    expect(result).toEqual({
      attempted: true,
      delivered: true,
      target: 'telegram_dm',
      errorMessage: null,
    });
    expect(sendDirectMessageToTelegramUser).toHaveBeenCalledWith({
      botToken: 'telegram-token',
      userId: '99887766',
      content: 'Your account has been set up.',
    });
  });

  it('returns a fulfilled result even when optional customer delivery fails', async () => {
    const service = new PaidOrderService();

    vi.spyOn(service, 'markPaidOrderFulfilled').mockResolvedValue(
      ok({
        paidOrderId: 'paid-order-1',
        tenantId: 'tenant-1',
        guildId: 'guild-1',
        orderSessionId: 'order-session-1',
        fulfillmentStatus: 'fulfilled',
        alreadyFulfilled: false,
        fulfilledAt: new Date().toISOString(),
        fulfilledByDiscordUserId: 'user-1',
      }),
    );
    vi.spyOn(service as any, 'sendCustomerFulfillmentMessage').mockResolvedValue({
      attempted: true,
      delivered: false,
      target: 'discord_channel',
      errorMessage: 'Channel post failed',
    });

    const result = await service.completePaidOrderFulfillment({
      paidOrderId: 'paid-order-1',
      guildId: 'guild-1',
      actorDiscordUserId: 'user-1',
      customerMessage: 'Here you go',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      paidOrderId: 'paid-order-1',
      fulfillmentStatus: 'fulfilled',
      customerNotification: {
        attempted: true,
        delivered: false,
        target: 'discord_channel',
        errorMessage: 'Channel post failed',
      },
    });
  });
});

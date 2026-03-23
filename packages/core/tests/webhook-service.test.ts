import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from 'neverthrow';

import * as telegramRest from '../src/integrations/telegram-rest.js';
import type { OrderSessionRecord } from '../src/repositories/order-repository.js';
import type { ReferralRewardResult } from '../src/services/referral-service.js';
import { WebhookService } from '../src/services/webhook-service.js';

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
    subtotalMinor: 1000,
    totalMinor: 1000,
    status: 'pending_payment',
    answers: {
      email: 'customer@example.com',
    },
    checkoutUrl: null,
    checkoutUrlCrypto: null,
    checkoutTokenExpiresAt: new Date(),
    ...overrides,
  };
}

describe('webhook service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('continues Discord delivery when the paid order record already exists', async () => {
    const service = new WebhookService();
    const orderSession = makeOrderSession();
    const referralResult: ReferralRewardResult = {
      status: 'not_applicable',
      reason: 'no_claim',
      referredEmailNormalized: orderSession.customerEmailNormalized,
      claim: null,
      rewardMinor: 0,
      pointValueMinor: 100,
      rewardPoints: 0,
    };

    vi.spyOn((service as any).orderRepository, 'getOrderSession').mockResolvedValue(orderSession);
    vi.spyOn((service as any).productRepository, 'getById').mockResolvedValue({
      id: orderSession.productId,
      category: 'Football',
      name: 'Match Package',
      variants: [
        {
          id: orderSession.variantId,
          label: 'Standard',
          priceMinor: 1000,
          currency: 'GBP',
        },
      ],
    });
    vi.spyOn((service as any).orderRepository, 'createPaidOrder').mockResolvedValue({
      paidOrderId: 'paid-order-1',
      created: false,
    });
    vi.spyOn((service as any).orderRepository, 'markOrderSessionPaid').mockResolvedValue(undefined);
    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue({
      paidLogChannelId: 'paid-log-channel',
      referralLogChannelId: null,
      referralThankYouTemplate: null,
    });
    const finalizePointsForPaidOrder = vi
      .spyOn(service as any, 'finalizePointsForPaidOrder')
      .mockResolvedValue({
        updatedPointsBalance: 42,
        referralResult,
      });
    vi.spyOn(service as any, 'fetchWooNotes').mockResolvedValue({
      latestInternal: null,
      latestCustomer: null,
    });
    vi.spyOn((service as any).orderRepository, 'cacheOrderNotes').mockResolvedValue(undefined);
    vi.spyOn((service as any).productRepository, 'getSensitiveFieldKeys').mockResolvedValue(new Set<string>());
    vi.spyOn(service as any, 'getBotTokenCandidates').mockResolvedValue(ok(['bot-token']));
    const postPaidLogMessage = vi.spyOn(service as any, 'postPaidLogMessage').mockResolvedValue(undefined);
    const postTicketPaidConfirmation = vi
      .spyOn(service as any, 'postTicketPaidConfirmation')
      .mockResolvedValue(undefined);
    const postReferralOutcome = vi.spyOn(service as any, 'postReferralOutcome').mockResolvedValue(undefined);
    const markWebhookProcessed = vi
      .spyOn((service as any).orderRepository, 'markWebhookProcessed')
      .mockResolvedValue(undefined);
    const markWebhookDuplicate = vi
      .spyOn((service as any).orderRepository, 'markWebhookDuplicate')
      .mockResolvedValue(undefined);

    await (service as any).processWooPaidEvent({
      integration: {
        tenantId: orderSession.tenantId,
        guildId: orderSession.guildId,
        wpBaseUrl: 'https://shop.example.com',
        consumerKey: 'ck_test',
        consumerSecret: 'cs_test',
      },
      payload: {
        id: 123,
        status: 'completed',
        number: '1001',
        total: '10.00',
        currency: 'GBP',
        meta_data: [
          {
            key: 'vd_order_session_id',
            value: orderSession.id,
          },
        ],
      },
      webhookEventId: 'webhook-1',
    });

    expect(finalizePointsForPaidOrder).toHaveBeenCalledOnce();
    expect(postPaidLogMessage).toHaveBeenCalledOnce();
    expect(postTicketPaidConfirmation).toHaveBeenCalledOnce();
    expect(postReferralOutcome).toHaveBeenCalledOnce();
    expect(markWebhookProcessed).toHaveBeenCalledWith('webhook-1');
    expect(markWebhookDuplicate).not.toHaveBeenCalled();
  });

  it('keeps Telegram paid logs out of the linked Telegram group when a Discord paid-log channel is configured', async () => {
    const service = new WebhookService();
    const orderSession = makeOrderSession({
      ticketChannelId: 'tg:-1003889522765',
      customerDiscordId: 'tg:99887766',
    });
    const referralResult: ReferralRewardResult = {
      status: 'not_applicable',
      reason: 'no_claim',
      referredEmailNormalized: orderSession.customerEmailNormalized,
      claim: null,
      rewardMinor: 0,
      pointValueMinor: 100,
      rewardPoints: 0,
    };

    vi.spyOn((service as any).orderRepository, 'getOrderSession').mockResolvedValue(orderSession);
    vi.spyOn((service as any).productRepository, 'getById').mockResolvedValue({
      id: orderSession.productId,
      category: 'Football',
      name: 'Match Package',
      variants: [
        {
          id: orderSession.variantId,
          label: 'Standard',
          priceMinor: 1000,
          currency: 'GBP',
        },
      ],
    });
    vi.spyOn((service as any).orderRepository, 'createPaidOrder').mockResolvedValue({
      paidOrderId: 'paid-order-1',
      created: false,
    });
    vi.spyOn((service as any).orderRepository, 'markOrderSessionPaid').mockResolvedValue(undefined);
    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue({
      paidLogChannelId: '1472676447603654869',
      referralLogChannelId: null,
      referralThankYouTemplate: null,
    });
    vi.spyOn(service as any, 'finalizePointsForPaidOrder').mockResolvedValue({
      updatedPointsBalance: 42,
      referralResult,
    });
    vi.spyOn((service as any).productRepository, 'getSensitiveFieldKeys').mockResolvedValue(new Set<string>());
    vi.spyOn(service as any, 'getBotTokenCandidates').mockResolvedValue(ok(['bot-token']));
    const postPaidLogMessage = vi.spyOn(service as any, 'postPaidLogMessage').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'postTicketPaidConfirmation').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'postReferralOutcome').mockResolvedValue(undefined);
    vi.spyOn((service as any).orderRepository, 'markWebhookProcessed').mockResolvedValue(undefined);

    await (service as any).processVoodooPayPaidEvent({
      tenantId: orderSession.tenantId,
      guildId: orderSession.guildId,
      orderSessionId: orderSession.id,
      query: {
        order_session_id: orderSession.id,
        status: 'paid',
        coin: 'polygon_pol',
        value_forwarded_coin: '15.00',
        txid_in: 'txid-hash-1',
      },
      webhookEventId: 'webhook-telegram-1',
    });

    expect(postPaidLogMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredChannelId: '1472676447603654869',
        fallbackChannelId: '1472676447603654869',
      }),
    );
  });

  it('DMs Telegram payment confirmations to the customer without posting in the linked group', async () => {
    const service = new WebhookService();

    vi.spyOn(service as any, 'getTelegramBotToken').mockReturnValue('telegram-token');
    const postMessageToTelegramChat = vi
      .spyOn(telegramRest, 'postMessageToTelegramChat')
      .mockResolvedValue({ messageId: 456 });
    const sendDirectMessageToTelegramUser = vi
      .spyOn(telegramRest, 'sendDirectMessageToTelegramUser')
      .mockResolvedValue({ messageId: 789 });

    await (service as any).postTicketPaidConfirmation({
      botTokens: ['bot-token'],
      ticketChannelId: 'tg:-1003889522765',
      customerDiscordId: 'tg:99887766',
      orderSessionId: 'order-session-1',
      productName: 'Renew Subscription',
      variantLabel: '1 Month',
      currency: 'GBP',
      priceMinor: 1500,
      updatedPointsBalance: 12,
    });

    expect(postMessageToTelegramChat).not.toHaveBeenCalled();
    expect(sendDirectMessageToTelegramUser).toHaveBeenCalledWith({
      botToken: 'telegram-token',
      userId: '99887766',
      content: [
        'Payment received. Thank you.',
        'Order Session: order-session-1',
        'Product: Renew Subscription',
        'Variant: 1 Month',
        'Amount: 15.00 GBP',
        'Updated Points Balance: 12 point(s)',
      ].join('\n'),
    });
  });
});

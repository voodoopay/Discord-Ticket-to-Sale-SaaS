import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/domain/errors.js';
import { SaleService } from '../src/services/sale-service.js';

describe('SaleService error handling', () => {
  it('returns an error result when the internal bot sale session flow throws', async () => {
    const service = new SaleService();

    vi.spyOn((service as any).authorizationService, 'ensureTenantIsActive').mockResolvedValue(ok(undefined));
    vi.spyOn(service as any, 'createSaleSessionInternal').mockRejectedValue(new Error('missing column'));

    const result = await service.createSaleSessionFromBot({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      ticketChannelId: 'channel-1',
      staffDiscordUserId: 'staff-1',
      customerDiscordUserId: 'customer-1',
      productId: 'product-1',
      variantId: 'variant-1',
      answers: {},
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('missing column');
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('uses the draft default currency when building a checkout session', async () => {
    const service = new SaleService();

    vi.spyOn(service as any, 'resolveSaleItems').mockResolvedValue(
      ok([
        {
          productId: 'product-1',
          productName: 'Starter',
          category: 'Boosting',
          variantId: 'variant-1',
          variantLabel: 'Standard',
          referralRewardMinor: 0,
          priceMinor: 1500,
          currency: 'GBP',
        },
      ]),
    );
    vi.spyOn(service as any, 'resolveCouponDiscountMinor').mockResolvedValue(ok(0));
    vi.spyOn(service as any, 'resolvePointsConfig').mockResolvedValue(
      ok({
        pointValueMinor: 1,
        earnCategoryKeys: [],
        redeemCategoryKeys: [],
        referralRewardMinor: 0,
        referralRewardCategoryKeys: [],
      }),
    );
    vi.spyOn((service as any).integrationService, 'getResolvedVoodooPayIntegrationByGuild').mockResolvedValue(
      ok({
        tenantWebhookKey: 'tenant-webhook',
        callbackSecret: 'callback-secret-12345678901234567890',
        checkoutDomain: 'checkout.voodoo-pay.uk',
        cryptoGatewayEnabled: false,
        cryptoAddFees: false,
        cryptoWallets: {
          evm: null,
          btc: null,
          bitcoincash: null,
          ltc: null,
          doge: null,
          trc20: null,
          solana: null,
        },
      }),
    );
    vi.spyOn((service as any).integrationService, 'getResolvedWooIntegrationByGuild').mockResolvedValue(
      err(new AppError('WOO_NOT_CONFIGURED', 'Woo not configured', 404)),
    );
    vi.spyOn((service as any).orderRepository, 'createOrderSession').mockResolvedValue({
      id: 'order-session-1',
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
      customerEmailNormalized: null,
      pointsReserved: 0,
      pointsDiscountMinor: 0,
      pointsReservationState: 'none',
      pointsConfigSnapshot: {
        pointValueMinor: 1,
        earnCategoryKeys: [],
        redeemCategoryKeys: [],
      },
      referralRewardMinorSnapshot: 0,
      tipMinor: 0,
      subtotalMinor: 1500,
      totalMinor: 1500,
      status: 'pending_payment',
      answers: {},
      checkoutUrl: null,
      checkoutUrlCrypto: null,
      checkoutTokenExpiresAt: new Date('2026-03-27T00:00:00.000Z'),
    });
    vi.spyOn((service as any).orderRepository, 'setCheckoutUrl').mockResolvedValue(undefined);
    const checkoutSpy = vi
      .spyOn(service as any, 'buildVoodooPayCheckoutUrl')
      .mockResolvedValue(ok('https://checkout.voodoo-pay.uk/pay.php?currency=EUR'));

    const result = await (service as any).createSaleSessionInternal({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      ticketChannelId: 'ticket-1',
      staffDiscordUserId: 'staff-1',
      customerDiscordUserId: 'customer-1',
      defaultCurrency: 'EUR',
      productId: 'product-1',
      variantId: 'variant-1',
      answers: {},
    });

    expect(result.isOk()).toBe(true);
    expect(checkoutSpy).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR' }));
    expect((service as any).orderRepository.createOrderSession).toHaveBeenCalledWith(
      expect.objectContaining({
        basketItems: [
          expect.objectContaining({
            currency: 'EUR',
          }),
        ],
      }),
    );
  });
});

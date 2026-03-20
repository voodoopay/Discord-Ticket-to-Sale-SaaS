import { SaleService } from '@voodoo/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSaleDraft, removeSaleDraft } from '../flows/sale-draft-store.js';
import { handleSaleAction } from './sale-interactions.js';

describe('sale interactions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows Done Adding on the category step after Add More is selected', async () => {
    const saleOptionsResult = {
      isErr: () => false,
      isOk: () => true,
      value: [
        {
          productId: 'product-1',
          name: 'Alpha Product',
          category: 'Alpha',
          description: '',
          variants: [
            {
              variantId: 'variant-1',
              label: 'Standard',
              priceMinor: 1500,
              currency: 'GBP',
            },
          ],
        },
      ],
    };

    vi.spyOn(SaleService.prototype, 'getSaleOptions').mockResolvedValue(
      saleOptionsResult as any,
    );

    const draft = createSaleDraft({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      ticketChannelId: 'channel-1',
      staffDiscordUserId: 'staff-1',
      customerDiscordUserId: 'customer-1',
      defaultCurrency: 'GBP',
      tipEnabled: true,
    });

    draft.basketItems.push({
      productId: 'existing-product',
      productName: 'Existing Product',
      category: 'Existing Category',
      variantId: 'existing-variant',
      variantLabel: 'Standard',
      priceMinor: 2000,
      currency: 'GBP',
    });

    const update = vi.fn().mockResolvedValue(undefined);

    try {
      await handleSaleAction({
        isButton: () => true,
        customId: `sale:action:${draft.id}:add_more`,
        user: { id: 'customer-1' },
        update,
        reply: vi.fn().mockResolvedValue(undefined),
        inGuild: () => true,
        channel: { id: 'channel-1' },
      } as any);

      expect(update).toHaveBeenCalledTimes(1);

      const payload = update.mock.calls[0]?.[0] as {
        components: Array<{ toJSON: () => { components: Array<{ label?: string; custom_id?: string }> } }>;
      };

      expect(payload.components).toHaveLength(2);
      expect(payload.components[1]?.toJSON().components[0]).toMatchObject({
        label: 'Done Adding',
        custom_id: `sale:action:${draft.id}:continue_checkout`,
      });
    } finally {
      removeSaleDraft(draft.id);
    }
  });
});

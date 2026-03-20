import { SaleService } from '@voodoo/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSaleDraft, removeSaleDraft } from '../flows/sale-draft-store.js';
import { handleSaleCallbackQuery } from './sale.js';

describe('telegram sale command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers a Done Adding button after entering add more with an existing basket', async () => {
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
      ticketChannelId: 'tg:-100123',
      customerLabel: '@buyer_one',
      staffDiscordUserId: 'tg:111',
      customerDiscordUserId: 'tg:222',
      customerTelegramUsernameNormalized: 'buyer_one',
      defaultCurrency: 'GBP',
      tipEnabled: true,
    });

    draft.controlChatId = 'tg:222';
    draft.controlMessageId = 55;
    draft.basketItems.push({
      productId: 'existing-product',
      productName: 'Existing Product',
      category: 'Existing Category',
      variantId: 'existing-variant',
      variantLabel: 'Standard',
      priceMinor: 2000,
      currency: 'GBP',
    });

    const editMessageText = vi.fn().mockResolvedValue(undefined);

    try {
      const handled = await handleSaleCallbackQuery({
        chat: { id: 222, type: 'private' },
        from: { id: 222, username: 'buyer_one' },
        callbackQuery: { data: `sale:act:${draft.id}:add` },
        api: { editMessageText },
        answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      } as any);

      expect(handled).toBe(true);
      expect(editMessageText).toHaveBeenCalledTimes(1);

      const keyboard = editMessageText.mock.calls[0]?.[3]?.reply_markup as {
        inline_keyboard: Array<Array<{ text?: string; callback_data?: string }>>;
      };
      const buttons = keyboard.inline_keyboard.flat();

      expect(buttons).toContainEqual(
        expect.objectContaining({
          text: 'Done Adding',
          callback_data: `sale:act:${draft.id}:co`,
        }),
      );
    } finally {
      removeSaleDraft(draft.id);
    }
  });
});

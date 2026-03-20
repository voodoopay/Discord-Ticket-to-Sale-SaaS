import { describe, expect, it } from 'vitest';

import {
  canTelegramUserAccessSaleDraft,
  resolveTelegramSaleCustomer,
} from './telegram.js';

describe('telegram helpers', () => {
  it('prefers an explicit @mention over a replied user for /sale targeting', () => {
    const customer = resolveTelegramSaleCustomer({
      text: '/sale @buyer_one',
      from: {
        id: 100,
        username: 'admin_user',
      },
      replyToUser: {
        id: 200,
        username: 'reply_target',
      },
      entities: [
        {
          type: 'mention',
          offset: 6,
          length: 10,
        },
      ],
    });

    expect(customer).toEqual({
      label: '@buyer_one',
      id: null,
      usernameNormalized: 'buyer_one',
    });
  });

  it('falls back to the replied customer when no explicit mention is provided', () => {
    const customer = resolveTelegramSaleCustomer({
      text: '/sale',
      from: {
        id: 100,
        username: 'admin_user',
      },
      replyToUser: {
        id: 200,
        username: 'reply_target',
      },
      entities: [],
    });

    expect(customer).toEqual({
      label: '@reply_target',
      id: 200,
      usernameNormalized: 'reply_target',
    });
  });

  it('allows the selected customer to continue a draft by username when the group command only tagged @username', () => {
    expect(
      canTelegramUserAccessSaleDraft({
        expectedUserId: null,
        expectedUsernameNormalized: 'buyer_one',
        actualUserId: 'tg:555',
        actualUsername: 'Buyer_One',
      }),
    ).toBe(true);
  });
});

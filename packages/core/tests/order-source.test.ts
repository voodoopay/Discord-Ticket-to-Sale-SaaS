import { describe, expect, it } from 'vitest';

import { getOrderSourceLabel } from '../src/services/order-source.js';

describe('getOrderSourceLabel', () => {
  it('labels telegram ticket channels as Telegram Order', () => {
    expect(getOrderSourceLabel('tg:-1001234567890')).toBe('Telegram Order');
  });

  it('labels discord ticket channels as Discord Order', () => {
    expect(getOrderSourceLabel('123456789012345678')).toBe('Discord Order');
  });
});

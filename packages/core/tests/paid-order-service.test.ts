import { describe, expect, it } from 'vitest';

import {
  buildPaidOrderFulfillmentComponents,
  buildPaidOrderFulfillmentCustomId,
  getPaidOrderFulfillmentButtonPresentation,
  parsePaidOrderFulfillmentCustomId,
} from '../src/services/paid-order-service.js';

describe('paid order fulfillment helpers', () => {
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
});

import { describe, expect, it } from 'vitest';

import {
  computeCouponEligibleSubtotalMinor,
  isCouponApplicableToLine,
} from '../src/services/coupon-scope.js';

describe('coupon scope', () => {
  it('treats empty scope as all items eligible', () => {
    const eligible = computeCouponEligibleSubtotalMinor(
      {
        allowedProductIds: [],
        allowedVariantIds: [],
      },
      [
        { productId: 'p1', variantId: 'v1', priceMinor: 500 },
        { productId: 'p2', variantId: 'v2', priceMinor: 700 },
      ],
    );

    expect(eligible).toBe(1200);
  });

  it('filters by product ids when product scope is set', () => {
    const eligible = computeCouponEligibleSubtotalMinor(
      {
        allowedProductIds: ['p2'],
        allowedVariantIds: [],
      },
      [
        { productId: 'p1', variantId: 'v1', priceMinor: 500 },
        { productId: 'p2', variantId: 'v2', priceMinor: 700 },
      ],
    );

    expect(eligible).toBe(700);
  });

  it('filters by variant ids when variation scope is set', () => {
    const eligible = computeCouponEligibleSubtotalMinor(
      {
        allowedProductIds: [],
        allowedVariantIds: ['v2'],
      },
      [
        { productId: 'p1', variantId: 'v1', priceMinor: 500 },
        { productId: 'p2', variantId: 'v2', priceMinor: 700 },
      ],
    );

    expect(eligible).toBe(700);
  });

  it('requires both product and variant match when both scopes are set', () => {
    expect(
      isCouponApplicableToLine(
        {
          allowedProductIds: ['p1'],
          allowedVariantIds: ['v2'],
        },
        {
          productId: 'p1',
          variantId: 'v1',
        },
      ),
    ).toBe(false);

    expect(
      isCouponApplicableToLine(
        {
          allowedProductIds: ['p1'],
          allowedVariantIds: ['v1'],
        },
        {
          productId: 'p1',
          variantId: 'v1',
        },
      ),
    ).toBe(true);
  });

  it('ignores negative and non-finite line values in eligible subtotals', () => {
    const eligible = computeCouponEligibleSubtotalMinor(
      {
        allowedProductIds: [],
        allowedVariantIds: [],
      },
      [
        { productId: 'p1', variantId: 'v1', priceMinor: -500 },
        { productId: 'p2', variantId: 'v2', priceMinor: Number.POSITIVE_INFINITY },
        { productId: 'p3', variantId: 'v3', priceMinor: 250 },
      ],
    );

    expect(eligible).toBe(250);
  });
});

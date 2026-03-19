import { describe, expect, it } from 'vitest';

import {
  allocateProportionalMinor,
  calculateEarnFromAppliedDiscounts,
  calculatePointsOrderTotals,
} from '../src/services/points-calculator.js';

describe('points calculator', () => {
  it('allocates coupon discount deterministically by basket index remainder', () => {
    const result = calculatePointsOrderTotals({
      lines: [
        { category: 'A', priceMinor: 100 },
        { category: 'B', priceMinor: 100 },
        { category: 'C', priceMinor: 100 },
      ],
      couponDiscountMinor: 100,
      tipMinor: 0,
      pointValueMinor: 100,
      earnCategoryKeys: [],
      redeemCategoryKeys: [],
      availablePoints: 0,
      usePoints: false,
    });

    expect(result.lineBreakdown.map((line) => line.couponAllocatedMinor)).toEqual([34, 33, 33]);
  });

  it('caps redemption using redeemable categories only', () => {
    const result = calculatePointsOrderTotals({
      lines: [
        { category: 'redeemable', priceMinor: 500 },
        { category: 'not-redeemable', priceMinor: 500 },
      ],
      couponDiscountMinor: 0,
      tipMinor: 0,
      pointValueMinor: 100,
      earnCategoryKeys: [],
      redeemCategoryKeys: ['redeemable'],
      availablePoints: 9,
      usePoints: true,
    });

    expect(result.redeemablePoolMinor).toBe(500);
    expect(result.maxRedeemablePointsByAmount).toBe(5);
    expect(result.pointsReserved).toBe(5);
    expect(result.pointsDiscountMinor).toBe(500);
    expect(result.lineBreakdown.map((line) => line.pointsAllocatedMinor)).toEqual([500, 0]);
    expect(result.totalMinor).toBe(500);
  });

  it('earns points from eligible net lines only and excludes tip', () => {
    const result = calculatePointsOrderTotals({
      lines: [
        { category: 'earn', priceMinor: 500 },
        { category: 'no-earn', priceMinor: 500 },
      ],
      couponDiscountMinor: 100,
      tipMinor: 900,
      pointValueMinor: 100,
      earnCategoryKeys: ['earn'],
      redeemCategoryKeys: [],
      availablePoints: 0,
      usePoints: false,
    });

    expect(result.lineBreakdown.map((line) => line.couponAllocatedMinor)).toEqual([50, 50]);
    expect(result.earnPoolMinor).toBe(450);
    expect(result.pointsEarned).toBe(4);
    expect(result.totalMinor).toBe(1800);
  });

  it('allocates points discount proportionally across redeemable lines', () => {
    const result = calculatePointsOrderTotals({
      lines: [
        { category: 'A', priceMinor: 300 },
        { category: 'B', priceMinor: 300 },
        { category: 'C', priceMinor: 400 },
      ],
      couponDiscountMinor: 100,
      tipMinor: 0,
      pointValueMinor: 100,
      earnCategoryKeys: ['A', 'B', 'C'],
      redeemCategoryKeys: ['A', 'C'],
      availablePoints: 4,
      usePoints: true,
    });

    expect(result.pointsReserved).toBe(4);
    expect(result.pointsDiscountMinor).toBe(400);
    expect(result.lineBreakdown.map((line) => line.couponAllocatedMinor)).toEqual([30, 30, 40]);
    expect(result.lineBreakdown.map((line) => line.pointsAllocatedMinor)).toEqual([172, 0, 228]);
    expect(result.pointsEarned).toBe(5);
    expect(result.totalMinor).toBe(500);
  });

  it('earns one point per major currency unit regardless of point value', () => {
    const result = calculatePointsOrderTotals({
      lines: [{ category: 'earn', priceMinor: 10_500 }],
      couponDiscountMinor: 0,
      tipMinor: 0,
      pointValueMinor: 10,
      earnCategoryKeys: ['earn'],
      redeemCategoryKeys: ['earn'],
      availablePoints: 0,
      usePoints: false,
    });

    expect(result.earnPoolMinor).toBe(10_500);
    expect(result.pointsEarned).toBe(105);
  });

  it('returns zero allocations when no eligible amount can receive a discount', () => {
    expect(allocateProportionalMinor(50, [0, 0])).toEqual([0, 0]);
    expect(allocateProportionalMinor(50, [100, 100], [false, false])).toEqual([0, 0]);
  });

  it('normalizes calculated earnings from already-applied discounts', () => {
    const result = calculateEarnFromAppliedDiscounts({
      lines: [
        { category: ' earn ', priceMinor: 500 },
        { category: 'skip', priceMinor: 500 },
      ],
      couponDiscountMinor: 100,
      pointsDiscountMinor: 50,
      earnCategoryKeys: ['earn'],
      redeemCategoryKeys: ['earn'],
    });

    expect(result.earnPoolMinor).toBe(400);
    expect(result.pointsEarned).toBe(4);
    expect(result.lineBreakdown.map((line) => line.pointsAllocatedMinor)).toEqual([50, 0]);
  });
});

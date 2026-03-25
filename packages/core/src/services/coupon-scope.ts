export type CouponScopeConfig = {
  allowedCategories: string[];
  allowedProductIds: string[];
  allowedVariantIds: string[];
};

export type CouponScopeLine = {
  category?: string | null;
  productId: string;
  variantId: string;
  priceMinor: number;
};

function toNonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

export function isCouponApplicableToLine(
  scope: CouponScopeConfig,
  line: { category?: string | null; productId: string; variantId: string },
): boolean {
  const categoryKey = line.category?.trim().toLowerCase() ?? '';
  const categoryKeys = new Set(scope.allowedCategories.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const productIds = new Set(scope.allowedProductIds);
  const variantIds = new Set(scope.allowedVariantIds);
  const categoryEligible = categoryKeys.size === 0 || (categoryKey.length > 0 && categoryKeys.has(categoryKey));
  const productEligible = productIds.size === 0 || productIds.has(line.productId);
  const variantEligible = variantIds.size === 0 || variantIds.has(line.variantId);

  return categoryEligible && productEligible && variantEligible;
}

export function computeCouponEligibleSubtotalMinor(
  scope: CouponScopeConfig,
  lines: CouponScopeLine[],
): number {
  let subtotal = 0;
  for (const line of lines) {
    if (!isCouponApplicableToLine(scope, line)) {
      continue;
    }

    subtotal += toNonNegativeInt(line.priceMinor);
  }

  return subtotal;
}

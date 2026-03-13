export const DASHBOARD_SECTION_IDS = [
  'workspace',
  'sales',
  'payments',
  'coupons',
  'catalog',
  'super-admin',
  'latest-action',
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export const DEFAULT_OPEN_DASHBOARD_SECTIONS: DashboardSectionId[] = ['workspace'];

export const CATALOG_SECTION_IDS = ['overview', 'category', 'product', 'pricing'] as const;

export type CatalogSectionId = (typeof CATALOG_SECTION_IDS)[number];

export const DEFAULT_OPEN_CATALOG_SECTIONS: CatalogSectionId[] = ['overview'];

export function togglePanel<TPanel extends string>(
  current: readonly TPanel[],
  panel: TPanel,
): TPanel[] {
  if (current.includes(panel)) {
    return current.filter((entry) => entry !== panel);
  }

  return [...current, panel];
}

export function toggleExclusivePanel<TPanel extends string>(
  current: readonly TPanel[],
  panel: TPanel,
): TPanel[] {
  if (current.includes(panel)) {
    return [];
  }

  return [panel];
}

export function ensurePanelOpen<TPanel extends string>(
  current: readonly TPanel[],
  panel: TPanel,
): TPanel[] {
  if (current.includes(panel)) {
    return [...current];
  }

  return [...current, panel];
}

export function ensurePanelsOpen<TPanel extends string>(
  current: readonly TPanel[],
  panels: readonly TPanel[],
): TPanel[] {
  const next = [...current];

  for (const panel of panels) {
    if (!next.includes(panel)) {
      next.push(panel);
    }
  }

  return next;
}

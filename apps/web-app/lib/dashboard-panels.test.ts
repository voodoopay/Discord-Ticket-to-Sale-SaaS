import { describe, expect, it } from 'vitest';

import {
  CATALOG_SECTION_IDS,
  DASHBOARD_SECTION_IDS,
  DEFAULT_OPEN_CATALOG_SECTIONS,
  DEFAULT_OPEN_DASHBOARD_SECTIONS,
  ensurePanelOpen,
  ensurePanelsOpen,
  toggleExclusivePanel,
  togglePanel,
} from './dashboard-panels';

describe('dashboard panel defaults', () => {
  it('opens the first merchant setup panels by default', () => {
    expect(DEFAULT_OPEN_DASHBOARD_SECTIONS).toEqual(['workspace']);
    expect(DEFAULT_OPEN_CATALOG_SECTIONS).toEqual(['overview']);
  });

  it('keeps the declared section order stable', () => {
    expect(DASHBOARD_SECTION_IDS).toEqual([
      'workspace',
      'sales',
      'payments',
      'coupons',
      'catalog',
      'super-admin',
      'latest-action',
    ]);
    expect(CATALOG_SECTION_IDS).toEqual(['overview', 'category', 'product', 'pricing']);
  });
});

describe('togglePanel', () => {
  it('adds a closed panel', () => {
    expect(togglePanel(['workspace'], 'sales')).toEqual(['workspace', 'sales']);
  });

  it('removes an open panel', () => {
    expect(togglePanel(['workspace', 'sales'], 'sales')).toEqual(['workspace']);
  });
});

describe('toggleExclusivePanel', () => {
  it('replaces the open list with the selected panel', () => {
    expect(toggleExclusivePanel(['workspace', 'sales'], 'catalog')).toEqual(['catalog']);
  });

  it('collapses the panel when it is already open', () => {
    expect(toggleExclusivePanel(['workspace'], 'workspace')).toEqual([]);
  });
});

describe('ensurePanelOpen', () => {
  it('returns the same open list when the panel is already open', () => {
    expect(ensurePanelOpen(['workspace', 'sales'], 'sales')).toEqual(['workspace', 'sales']);
  });

  it('appends the panel when it is not already open', () => {
    expect(ensurePanelOpen(['workspace'], 'catalog')).toEqual(['workspace', 'catalog']);
  });
});

describe('ensurePanelsOpen', () => {
  it('merges multiple panel ids without duplicates', () => {
    expect(ensurePanelsOpen(['workspace'], ['sales', 'catalog', 'sales'])).toEqual([
      'workspace',
      'sales',
      'catalog',
    ]);
  });

  it('preserves existing order while appending missing panels', () => {
    expect(
      ensurePanelsOpen(['payments', 'workspace'], ['workspace', 'catalog', 'coupons']),
    ).toEqual(['payments', 'workspace', 'catalog', 'coupons']);
  });
});

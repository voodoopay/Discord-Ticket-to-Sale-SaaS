import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

async function readDashboardSectionsSource(): Promise<string> {
  return await readFile(
    path.resolve(process.cwd(), 'apps/web-app/components/dashboard/dashboard-sections.tsx'),
    'utf8',
  );
}

describe('dashboard sections effect wiring', () => {
  it('keeps Effect Event callbacks out of dependency arrays for dashboard loaders', async () => {
    const source = await readDashboardSectionsSource();

    expect(source).not.toMatch(/\[isLinkedToCurrentTenant,\s*loadWorkspaceAccess,\s*tenantId\]/);
    expect(source).not.toMatch(
      /\[deferredMemberSearch,\s*guildId,\s*isLinkedToCurrentTenant,\s*searchGuildMembers,\s*tenantId,\s*workspaceAccess\?\.canManageMembers\]/,
    );
    expect(source).not.toMatch(/\[config\?\.couponsEnabled,\s*loadCoupons\]/);
    expect(source).not.toMatch(/\[activePointsPanel,\s*config\?\.pointsEnabled,\s*deferredSearch,\s*loadCustomers\]/);
  });

  it('surfaces referral placeholder-code guidance for both referral message editors', async () => {
    const source = await readDashboardSectionsSource();

    expect(source).toContain('Available placeholder codes');
    expect(source).toContain('REFERRAL_SUBMISSION_TEMPLATE_PLACEHOLDERS');
    expect(source).toContain('REFERRAL_THANK_YOU_TEMPLATE_PLACEHOLDERS');
    expect(source).toContain('Use these in the private success reply shown after a member submits /refer.');
    expect(source).toContain(
      'Use these in the payout thank-you message sent after the first paid referral order is completed.',
    );
  });

  it('locks the Voodoo Pay checkout domain to the fixed hosted value', async () => {
    const source = await readDashboardSectionsSource();

    expect(source).toContain('FIXED_VOODOO_PAY_CHECKOUT_DOMAIN');
    expect(source).toContain('id="checkout-domain"');
    expect(source).toContain('readOnly');
    expect(source).toContain('Hosted checkout links always use the fixed Voodoo Pay domain.');
  });
});

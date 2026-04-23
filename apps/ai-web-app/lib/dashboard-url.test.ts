import { describe, expect, it } from 'vitest';

import { buildDashboardGuildUrl } from './dashboard-url';

describe('AI dashboard URL state', () => {
  it('updates guild selection without carrying transient auth errors', () => {
    expect(
      buildDashboardGuildUrl(
        'https://www.voodooai.online/dashboard?authError=expired&tab=configure#configure',
        'guild-123',
      ),
    ).toBe('/dashboard?tab=configure&guildId=guild-123#configure');
  });
});

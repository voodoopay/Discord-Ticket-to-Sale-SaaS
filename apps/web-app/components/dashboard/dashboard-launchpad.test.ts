import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

async function readDashboardLaunchpadSource(): Promise<string> {
  return await readFile(
    path.resolve(process.cwd(), 'apps/web-app/components/dashboard/dashboard-launchpad.tsx'),
    'utf8',
  );
}

describe('dashboard launchpad workspace creation', () => {
  it('includes a first-time workspace creation flow for merchants with no workspaces', async () => {
    const source = await readDashboardLaunchpadSource();

    expect(source).toContain("data-tutorial=\"workspace-create-toggle\"");
    expect(source).toContain('id="workspace-name"');
    expect(source).toContain('/api/tenants');
    expect(source).toContain('Create First Workspace');
    expect(source).toContain('Create Workspace');
  });
});

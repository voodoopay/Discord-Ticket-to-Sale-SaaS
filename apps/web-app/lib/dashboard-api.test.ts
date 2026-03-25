import { afterEach, describe, expect, it, vi } from 'vitest';

import { dashboardApi } from './dashboard-api';

describe('dashboardApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries once when the first fetch fails at the network layer', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    await expect(dashboardApi<{ ok: boolean }>('/api/test')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a clearer dashboard message after repeated network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    await expect(dashboardApi('/api/test')).rejects.toThrow(
      'Dashboard request failed. Refresh the page and try again.',
    );
  });
});

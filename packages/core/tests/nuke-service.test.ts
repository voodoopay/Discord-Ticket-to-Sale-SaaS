import { afterEach, describe, expect, it, vi } from 'vitest';

import { NukeService } from '../src/services/nuke-service.js';

describe('NukeService scheduler loop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a due-schedule poll immediately when the worker starts', async () => {
    vi.useFakeTimers();

    const service = new NukeService();
    const serviceForSpy = service as unknown as { runDueSchedules: () => Promise<void> };
    const runDueSchedulesSpy = vi
      .spyOn(serviceForSpy, 'runDueSchedules')
      .mockResolvedValue(undefined);

    service.startSchedulerLoop(null, { pollIntervalMs: 30_000 });
    await Promise.resolve();

    expect(runDueSchedulesSpy).toHaveBeenCalledTimes(1);

    service.stopSchedulerLoop();
  });

  it('does not overlap scheduler polls while a run is still in flight', async () => {
    vi.useFakeTimers();

    const service = new NukeService();
    const serviceForSpy = service as unknown as { runDueSchedules: () => Promise<void> };

    let resolveRun: (() => void) | null = null;
    const runDueSchedulesSpy = vi
      .spyOn(serviceForSpy, 'runDueSchedules')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveRun = resolve;
          }),
      );

    service.startSchedulerLoop(null, { pollIntervalMs: 30_000 });
    await Promise.resolve();

    expect(runDueSchedulesSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(runDueSchedulesSpy).toHaveBeenCalledTimes(1);

    resolveRun?.();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(runDueSchedulesSpy).toHaveBeenCalledTimes(2);

    service.stopSchedulerLoop();
  });
});

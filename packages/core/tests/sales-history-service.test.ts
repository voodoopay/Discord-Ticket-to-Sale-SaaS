import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from 'neverthrow';

import type { GuildConfigRecord } from '../src/repositories/tenant-repository.js';
import type { SessionPayload } from '../src/security/session-token.js';
import { SalesHistoryService } from '../src/services/sales-history-service.js';

function makeSession(): SessionPayload {
  return {
    userId: 'user-1',
    discordUserId: 'discord-user-1',
    isSuperAdmin: false,
    tenantIds: ['tenant-1'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

function makeGuildConfig(overrides: Partial<GuildConfigRecord> = {}): GuildConfigRecord {
  return {
    id: 'config-1',
    tenantId: 'tenant-1',
    guildId: 'guild-1',
    paidLogChannelId: null,
    staffRoleIds: [],
    defaultCurrency: 'GBP',
    couponsEnabled: true,
    pointsEnabled: true,
    referralsEnabled: true,
    telegramEnabled: false,
    tipEnabled: false,
    pointsEarnCategoryKeys: [],
    pointsRedeemCategoryKeys: [],
    pointValueMinor: 1,
    referralRewardMinor: 0,
    referralRewardCategoryKeys: [],
    referralLogChannelId: null,
    referralThankYouTemplate: 'Thanks',
    referralSubmissionTemplate: 'Submitted',
    ticketMetadataKey: 'isTicket',
    joinGateEnabled: false,
    joinGateStaffRoleIds: [],
    joinGateFallbackChannelId: null,
    joinGateVerifiedRoleId: null,
    joinGateTicketCategoryId: null,
    joinGateCurrentLookupChannelId: null,
    joinGateNewLookupChannelId: null,
    joinGatePanelTitle: null,
    joinGatePanelMessage: null,
    salesHistoryClearedAt: null,
    salesHistoryAutoClearEnabled: false,
    salesHistoryAutoClearFrequency: 'daily',
    salesHistoryAutoClearLocalTimeHhMm: '00:00',
    salesHistoryAutoClearTimezone: 'UTC',
    salesHistoryAutoClearDayOfWeek: null,
    salesHistoryAutoClearDayOfMonth: null,
    salesHistoryAutoClearNextRunAtUtc: null,
    salesHistoryAutoClearLastRunAtUtc: null,
    salesHistoryAutoClearLastLocalRunDate: null,
    ...overrides,
  };
}

describe('sales history service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('clears the guild sales history after authorization succeeds', async () => {
    const service = new SalesHistoryService();
    const clearedAt = new Date('2026-03-30T10:15:00.000Z');
    const clearGuildHistory = vi
      .spyOn((service as any).salesHistoryRepository, 'clearGuildHistory')
      .mockResolvedValue(undefined);

    vi.spyOn((service as any).authorizationService, 'ensureTenantRole').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).authorizationService, 'ensureGuildBoundToTenant').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue(makeGuildConfig());

    const result = await service.clearGuildHistory(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      clearedAt,
    });

    expect(result.isOk()).toBe(true);
    expect(clearGuildHistory).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      clearedAt,
    });
  });

  it('marks a scheduled auto-clear as complete and stores the next run', async () => {
    const service = new SalesHistoryService();
    const executedAt = new Date('2026-03-30T10:30:00.000Z');
    const completeAutoClearRun = vi
      .spyOn((service as any).salesHistoryRepository, 'completeAutoClearRun')
      .mockResolvedValue(undefined);

    vi.spyOn((service as any).tenantRepository, 'getGuildConfig').mockResolvedValue(
      makeGuildConfig({
        salesHistoryAutoClearEnabled: true,
        salesHistoryAutoClearFrequency: 'weekly',
        salesHistoryAutoClearLocalTimeHhMm: '10:30',
        salesHistoryAutoClearTimezone: 'UTC',
        salesHistoryAutoClearDayOfWeek: 1,
      }),
    );

    const result = await service.markAutoClearCompleted({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      executedAt,
    });

    expect(result.isOk()).toBe(true);
    const call = completeAutoClearRun.mock.calls[0]?.[0];
    expect(call?.tenantId).toBe('tenant-1');
    expect(call?.guildId).toBe('guild-1');
    expect(call?.clearedAt.toISOString()).toBe('2026-03-30T10:30:00.000Z');
    expect(call?.lastRunAtUtc.toISOString()).toBe('2026-03-30T10:30:00.000Z');
    expect(call?.lastLocalRunDate).toBe('2026-03-30');
    expect(call?.nextRunAtUtc.toISOString()).toBe('2026-04-06T10:30:00.000Z');
  });

  it('does not overlap scheduler ticks while a previous poll is still running', async () => {
    vi.useFakeTimers();

    const service = new SalesHistoryService();
    let resolveRun: (() => void) | null = null;
    const runDueSchedules = vi.spyOn(service, 'runDueSchedules').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );

    service.startSchedulerLoop({ pollIntervalMs: 5_000 });
    expect(runDueSchedules).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20_000);
    expect(runDueSchedules).toHaveBeenCalledTimes(1);

    resolveRun?.();
    await Promise.resolve();
    await Promise.resolve();

    vi.advanceTimersByTime(5_000);
    expect(runDueSchedules).toHaveBeenCalledTimes(2);

    service.stopSchedulerLoop();
  });
});

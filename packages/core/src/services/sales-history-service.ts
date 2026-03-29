import { err, ok, type Result } from 'neverthrow';

import { AppError, fromUnknownError } from '../domain/errors.js';
import { logger } from '../infra/logger.js';
import {
  SalesHistoryRepository,
  type SalesHistoryAutoClearRecord,
} from '../repositories/sales-history-repository.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import type { SessionPayload } from '../security/session-token.js';
import { AuthorizationService } from './authorization-service.js';
import {
  computeNextRunAtUtc,
  resolveLocalDate,
} from './sales-history-schedule.js';

export type SalesHistoryClearSummary = {
  clearedAt: string;
};

export type SalesHistoryAutoClearSummary = {
  tenantId: string;
  guildId: string;
  clearedAt: string | null;
  autoClearEnabled: boolean;
  autoClearFrequency: 'daily' | 'weekly' | 'monthly';
  autoClearLocalTimeHhMm: string;
  autoClearTimezone: string;
  autoClearDayOfWeek: number | null;
  autoClearDayOfMonth: number | null;
  autoClearNextRunAtUtc: string | null;
  autoClearLastRunAtUtc: string | null;
  autoClearLastLocalRunDate: string | null;
};

function mapAutoClearSummary(record: SalesHistoryAutoClearRecord): SalesHistoryAutoClearSummary {
  return {
    tenantId: record.tenantId,
    guildId: record.guildId,
    clearedAt: record.clearedAt?.toISOString() ?? null,
    autoClearEnabled: record.autoClearEnabled,
    autoClearFrequency: record.autoClearFrequency,
    autoClearLocalTimeHhMm: record.autoClearLocalTimeHhMm,
    autoClearTimezone: record.autoClearTimezone,
    autoClearDayOfWeek: record.autoClearDayOfWeek,
    autoClearDayOfMonth: record.autoClearDayOfMonth,
    autoClearNextRunAtUtc: record.autoClearNextRunAtUtc?.toISOString() ?? null,
    autoClearLastRunAtUtc: record.autoClearLastRunAtUtc?.toISOString() ?? null,
    autoClearLastLocalRunDate: record.autoClearLastLocalRunDate,
  };
}

export class SalesHistoryService {
  private readonly authorizationService = new AuthorizationService();
  private readonly tenantRepository = new TenantRepository();
  private readonly salesHistoryRepository = new SalesHistoryRepository();
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerTickInFlight = false;

  public async clearGuildHistory(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      clearedAt?: Date;
    },
  ): Promise<Result<SalesHistoryClearSummary, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      const config = await this.tenantRepository.getGuildConfig({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (!config) {
        return err(new AppError('GUILD_CONFIG_NOT_FOUND', 'Guild config not found', 404));
      }

      const clearedAt = input.clearedAt ?? new Date();
      await this.salesHistoryRepository.clearGuildHistory({
        tenantId: input.tenantId,
        guildId: input.guildId,
        clearedAt,
      });

      return ok({ clearedAt: clearedAt.toISOString() });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async listDueGuildAutoClears(input: {
    now: Date;
    limit: number;
  }): Promise<Result<SalesHistoryAutoClearSummary[], AppError>> {
    try {
      const records = await this.salesHistoryRepository.listDueGuildAutoClears({
        now: input.now,
        limit: input.limit,
      });
      return ok(records.map(mapAutoClearSummary));
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async markAutoClearCompleted(input: {
    tenantId: string;
    guildId: string;
    executedAt: Date;
  }): Promise<Result<{ nextRunAtUtc: string }, AppError>> {
    try {
      const config = await this.tenantRepository.getGuildConfig({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (!config) {
        return err(new AppError('GUILD_CONFIG_NOT_FOUND', 'Guild config not found', 404));
      }

      if (!config.salesHistoryAutoClearEnabled) {
        return err(
          new AppError(
            'SALES_HISTORY_AUTO_CLEAR_DISABLED',
            'Sales-history auto clear is disabled for this guild.',
            409,
          ),
        );
      }

      const localDate = resolveLocalDate({
        timezone: config.salesHistoryAutoClearTimezone,
        at: input.executedAt,
      });
      const nextRunAtUtc = computeNextRunAtUtc({
        frequency: config.salesHistoryAutoClearFrequency,
        localTimeHhMm: config.salesHistoryAutoClearLocalTimeHhMm,
        timezone: config.salesHistoryAutoClearTimezone,
        dayOfWeek: config.salesHistoryAutoClearDayOfWeek,
        dayOfMonth: config.salesHistoryAutoClearDayOfMonth,
        now: input.executedAt,
        lastLocalRunDate: localDate,
      });

      await this.salesHistoryRepository.completeAutoClearRun({
        tenantId: input.tenantId,
        guildId: input.guildId,
        clearedAt: input.executedAt,
        nextRunAtUtc,
        lastRunAtUtc: input.executedAt,
        lastLocalRunDate: localDate,
      });

      return ok({ nextRunAtUtc: nextRunAtUtc.toISOString() });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public startSchedulerLoop(input: { pollIntervalMs: number }): void {
    if (this.schedulerTimer) {
      return;
    }

    const pollIntervalMs = Math.max(5_000, Math.floor(input.pollIntervalMs));
    this.queueSchedulerTick();
    this.schedulerTimer = setInterval(() => {
      this.queueSchedulerTick();
    }, pollIntervalMs);
    this.schedulerTimer.unref?.();
  }

  public stopSchedulerLoop(): void {
    if (!this.schedulerTimer) {
      return;
    }

    clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    this.schedulerTickInFlight = false;
  }

  private queueSchedulerTick(): void {
    if (this.schedulerTickInFlight) {
      return;
    }

    this.schedulerTickInFlight = true;
    void this.runDueSchedules().finally(() => {
      this.schedulerTickInFlight = false;
    });
  }

  public async runDueSchedules(): Promise<void> {
    try {
      const dueConfigs = await this.salesHistoryRepository.listDueGuildAutoClears({
        now: new Date(),
        limit: 20,
      });

      for (const dueConfig of dueConfigs) {
        const completed = await this.markAutoClearCompleted({
          tenantId: dueConfig.tenantId,
          guildId: dueConfig.guildId,
          executedAt: new Date(),
        });

        if (completed.isErr()) {
          logger.warn(
            {
              tenantId: dueConfig.tenantId,
              guildId: dueConfig.guildId,
              err: completed.error,
            },
            'sales-history auto clear failed',
          );
        }
      }
    } catch (error) {
      logger.warn(
        { errorMessage: error instanceof Error ? error.message : 'unknown' },
        'failed to poll due sales-history auto clears',
      );
    }
  }
}

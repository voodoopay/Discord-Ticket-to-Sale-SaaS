import { err, ok, type Result } from 'neverthrow';

import { AppError } from '../domain/errors.js';
import { getEnv } from '../config/env.js';
import {
  SportsRepository,
  type SportsChannelBindingRecord,
  type SportsGuildConfigRecord,
} from '../repositories/sports-repository.js';
import { SportsAccessService } from './sports-access-service.js';
import {
  assertValidTimezone,
  computeNextRunAtUtc,
  parseDailyTimeHhMm,
  resolveLocalDate,
} from './sports-schedule.js';

export type SportsGuildConfigSummary = {
  configId: string;
  guildId: string;
  enabled: boolean;
  managedCategoryChannelId: string | null;
  liveCategoryChannelId?: string | null;
  localTimeHhMm: string;
  timezone: string;
  broadcastCountry: string;
  nextRunAtUtc: string;
  lastRunAtUtc: string | null;
  lastLocalRunDate: string | null;
};

export type SportsChannelBindingSummary = {
  bindingId: string;
  guildId: string;
  sportId: string | null;
  sportName: string;
  sportSlug: string;
  channelId: string;
};

export type SportsGuildStatus = {
  config: SportsGuildConfigSummary | null;
  channelCount: number;
  activated: boolean;
  authorizedUserCount: number;
};

function mapGuildConfigSummary(config: SportsGuildConfigRecord): SportsGuildConfigSummary {
  return {
    configId: config.id,
    guildId: config.guildId,
    enabled: config.enabled,
    managedCategoryChannelId: config.managedCategoryChannelId,
    liveCategoryChannelId: config.liveCategoryChannelId,
    localTimeHhMm: config.localTimeHhmm,
    timezone: config.timezone,
    broadcastCountry: config.broadcastCountry,
    nextRunAtUtc: config.nextRunAtUtc.toISOString(),
    lastRunAtUtc: config.lastRunAtUtc?.toISOString() ?? null,
    lastLocalRunDate: config.lastLocalRunDate ?? null,
  };
}

function mapChannelBindingSummary(
  binding: SportsChannelBindingRecord,
): SportsChannelBindingSummary {
  return {
    bindingId: binding.id,
    guildId: binding.guildId,
    sportId: binding.sportId,
    sportName: binding.sportName,
    sportSlug: binding.sportSlug,
    channelId: binding.channelId,
  };
}

export class SportsService {
  private readonly sportsRepository = new SportsRepository();
  private readonly sportsAccessService = new SportsAccessService();
  private readonly env = getEnv();

  public async getGuildStatus(input: {
    guildId: string;
  }): Promise<Result<SportsGuildStatus, AppError>> {
    try {
      const [config, bindings, activationState] = await Promise.all([
        this.sportsRepository.getGuildConfig(input.guildId),
        this.sportsRepository.listChannelBindings(input.guildId),
        this.sportsAccessService.getGuildActivationState({ guildId: input.guildId }),
      ]);

      if (activationState.isErr()) {
        return err(activationState.error);
      }

      return ok({
        config: config ? mapGuildConfigSummary(config) : null,
        channelCount: bindings.length,
        activated: activationState.value.activated,
        authorizedUserCount: activationState.value.authorizedUserCount,
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('SPORTS_CONFIG_READ_FAILED', 'Sports configuration read failed.', 500),
      );
    }
  }

  public async getGuildConfig(input: {
    guildId: string;
  }): Promise<Result<SportsGuildConfigSummary | null, AppError>> {
    try {
      const config = await this.sportsRepository.getGuildConfig(input.guildId);
      return ok(config ? mapGuildConfigSummary(config) : null);
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('SPORTS_CONFIG_READ_FAILED', 'Sports configuration read failed.', 500),
      );
    }
  }

  public async upsertGuildConfig(input: {
    guildId: string;
    managedCategoryChannelId: string | null;
    liveCategoryChannelId: string | null;
    localTimeHhMm: string;
    timezone: string;
    broadcastCountry: string;
    actorDiscordUserId: string;
  }): Promise<Result<SportsGuildConfigSummary, AppError>> {
    try {
      const timezone = assertValidTimezone(input.timezone);
      const parsed = parseDailyTimeHhMm(input.localTimeHhMm);
      const normalizedTime = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
      const nextRunAtUtc = computeNextRunAtUtc({
        timezone,
        timeHhMm: normalizedTime,
        now: new Date(),
      });

      const config = await this.sportsRepository.upsertGuildConfig({
        guildId: input.guildId,
        managedCategoryChannelId: input.managedCategoryChannelId,
        liveCategoryChannelId: input.liveCategoryChannelId,
        localTimeHhmm: normalizedTime,
        timezone,
        broadcastCountry: input.broadcastCountry.trim() || this.env.SPORTS_BROADCAST_COUNTRY,
        nextRunAtUtc,
        updatedByDiscordUserId: input.actorDiscordUserId,
      });

      return ok(mapGuildConfigSummary(config));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('SPORTS_CONFIG_WRITE_FAILED', 'Sports configuration update failed.', 500),
      );
    }
  }

  public async listChannelBindings(input: {
    guildId: string;
  }): Promise<Result<SportsChannelBindingSummary[], AppError>> {
    try {
      const bindings = await this.sportsRepository.listChannelBindings(input.guildId);
      return ok(bindings.map(mapChannelBindingSummary));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('SPORTS_CONFIG_READ_FAILED', 'Sports configuration read failed.', 500),
      );
    }
  }

  public async upsertChannelBinding(input: {
    guildId: string;
    sportId: string | null;
    sportName: string;
    sportSlug: string;
    channelId: string;
  }): Promise<Result<SportsChannelBindingSummary, AppError>> {
    try {
      const binding = await this.sportsRepository.upsertChannelBinding({
        guildId: input.guildId,
        sportId: input.sportId,
        sportName: input.sportName,
        sportSlug: input.sportSlug,
        channelId: input.channelId,
      });
      return ok(mapChannelBindingSummary(binding));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('SPORTS_CONFIG_WRITE_FAILED', 'Sports channel update failed.', 500),
      );
    }
  }

  public async listDueGuilds(input: {
    now: Date;
    limit: number;
  }): Promise<Result<SportsGuildConfigSummary[], AppError>> {
    try {
      const configs = await this.sportsRepository.listDueGuildConfigs({
        now: input.now,
        limit: input.limit,
      });
      return ok(configs.map(mapGuildConfigSummary));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('SPORTS_CONFIG_READ_FAILED', 'Sports schedule read failed.', 500),
      );
    }
  }

  public async markPublishCompleted(input: {
    guildId: string;
    executedAt: Date;
    updatedByDiscordUserId: string | null;
  }): Promise<Result<{ nextRunAtUtc: string }, AppError>> {
    try {
      const config = await this.sportsRepository.getGuildConfig(input.guildId);
      if (!config) {
        return err(new AppError('SPORTS_CONFIG_NOT_FOUND', 'Sports configuration not found for this server.', 404));
      }

      const localDate = resolveLocalDate({
        timezone: config.timezone,
        at: input.executedAt,
      });
      const nextRunAtUtc = computeNextRunAtUtc({
        timezone: config.timezone,
        timeHhMm: config.localTimeHhmm,
        now: input.executedAt,
        lastLocalRunDate: localDate,
      });

      await this.sportsRepository.setNextRunAt({
        guildId: input.guildId,
        nextRunAtUtc,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
        lastRunAtUtc: input.executedAt,
        lastLocalRunDate: localDate,
      });

      return ok({ nextRunAtUtc: nextRunAtUtc.toISOString() });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('SPORTS_CONFIG_WRITE_FAILED', 'Sports publish state update failed.', 500),
      );
    }
  }

  public async rescheduleNextRun(input: {
    guildId: string;
    now: Date;
    updatedByDiscordUserId: string | null;
  }): Promise<Result<{ nextRunAtUtc: string }, AppError>> {
    try {
      const config = await this.sportsRepository.getGuildConfig(input.guildId);
      if (!config) {
        return err(new AppError('SPORTS_CONFIG_NOT_FOUND', 'Sports configuration not found for this server.', 404));
      }

      const nextRunAtUtc = computeNextRunAtUtc({
        timezone: config.timezone,
        timeHhMm: config.localTimeHhmm,
        now: input.now,
      });

      await this.sportsRepository.setNextRunAt({
        guildId: input.guildId,
        nextRunAtUtc,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
      });

      return ok({ nextRunAtUtc: nextRunAtUtc.toISOString() });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('SPORTS_CONFIG_WRITE_FAILED', 'Sports schedule update failed.', 500),
      );
    }
  }

  public async scheduleRetry(input: {
    guildId: string;
    retryAt: Date;
    updatedByDiscordUserId: string | null;
  }): Promise<Result<{ nextRunAtUtc: string }, AppError>> {
    try {
      await this.sportsRepository.setNextRunAt({
        guildId: input.guildId,
        nextRunAtUtc: input.retryAt,
        updatedByDiscordUserId: input.updatedByDiscordUserId,
      });

      return ok({ nextRunAtUtc: input.retryAt.toISOString() });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError('SPORTS_CONFIG_WRITE_FAILED', 'Sports retry schedule update failed.', 500),
      );
    }
  }
}

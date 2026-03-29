import pRetry, { AbortError } from 'p-retry';
import { err, ok, type Result } from 'neverthrow';
import { ulid } from 'ulid';

import { getEnv } from '../config/env.js';
import { AppError } from '../domain/errors.js';
import { logger } from '../infra/logger.js';
import {
  NukeRepository,
  type ChannelNukeAuthorizedUserRecord,
  type ChannelNukeScheduleRecord,
} from '../repositories/nuke-repository.js';
import {
  assertValidMonthlyDayOfMonth,
  assertValidScheduleCadence,
  assertValidTimezone,
  assertValidWeeklyDayOfWeek,
  buildScheduledNukeIdempotencyKey,
  computeNextRunAtUtc,
  type NukeScheduleCadence,
  parseDailyTimeHhMm,
  resolveLocalDate,
  resolveLocalScheduleAnchor,
} from './nuke-schedule.js';
import { toNukeAppError } from './nuke-discord-errors.js';

type DiscordChannelPayload = {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  parent_id: string | null;
  topic?: string | null;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  position?: number;
  permission_overwrites?: Array<{
    id: string;
    type: number;
    allow: string;
    deny: string;
  }>;
};

const MAX_SCHEDULE_FAILURES = 5;
const LOCK_LEASE_MS = 60_000;
const LOCK_HEARTBEAT_MS = 15_000;
type NukeExecutionMode = 'replace' | 'delete_only';

export type ChannelNukeScheduleSummary = {
  scheduleId: string;
  channelId: string;
  enabled: boolean;
  localTimeHhMm: string;
  timezone: string;
  cadence: NukeScheduleCadence;
  weeklyDayOfWeek: number | null;
  monthlyDayOfMonth: number | null;
  nextRunAtUtc: string;
  lastRunAtUtc: string | null;
  lastLocalRunDate: string | null;
  consecutiveFailures: number;
};

export type ChannelNukeAuthorizedUserSummary = {
  authorizationId: string;
  discordUserId: string;
  grantedByDiscordUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NukeCommandAccessState = {
  locked: boolean;
  allowed: boolean;
  authorizedUserCount: number;
};

type NukeScheduleConfig = {
  timezone: string;
  localTimeHhmm: string;
  cadence: NukeScheduleCadence;
  weeklyDayOfWeek: number | null;
  monthlyDayOfMonth: number | null;
};

function resolveScheduleRecurrence(input: {
  cadence: NukeScheduleCadence;
  timezone: string;
  now: Date;
  weeklyDayOfWeek?: number | null;
  monthlyDayOfMonth?: number | null;
}): {
  weeklyDayOfWeek: number | null;
  monthlyDayOfMonth: number | null;
} {
  if (input.cadence !== 'weekly' && input.weeklyDayOfWeek != null) {
    throw new AppError(
      'NUKE_SCHEDULE_WEEKDAY_NOT_ALLOWED',
      'Weekday can only be set for weekly nuke schedules.',
      422,
    );
  }

  if (input.cadence !== 'monthly' && input.monthlyDayOfMonth != null) {
    throw new AppError(
      'NUKE_SCHEDULE_DAY_OF_MONTH_NOT_ALLOWED',
      'Day of month can only be set for monthly nuke schedules.',
      422,
    );
  }

  const anchor = resolveLocalScheduleAnchor({
    timezone: input.timezone,
    at: input.now,
  });

  if (input.cadence === 'weekly') {
    return {
      weeklyDayOfWeek: assertValidWeeklyDayOfWeek(input.weeklyDayOfWeek ?? anchor.dayOfWeek),
      monthlyDayOfMonth: null,
    };
  }

  if (input.cadence === 'monthly') {
    return {
      weeklyDayOfWeek: null,
      monthlyDayOfMonth: assertValidMonthlyDayOfMonth(input.monthlyDayOfMonth ?? anchor.dayOfMonth),
    };
  }

  return {
    weeklyDayOfWeek: null,
    monthlyDayOfMonth: null,
  };
}

function computeNextRunForSchedule(
  input: NukeScheduleConfig & {
    now: Date;
    lastLocalRunDate?: string | null;
  },
): Date {
  return computeNextRunAtUtc({
    timezone: input.timezone,
    timeHhMm: input.localTimeHhmm,
    cadence: input.cadence,
    dayOfWeek: input.weeklyDayOfWeek,
    dayOfMonth: input.monthlyDayOfMonth,
    now: input.now,
    lastLocalRunDate: input.lastLocalRunDate,
  });
}

function mapAuthorizedUserSummary(
  authorizedUser: ChannelNukeAuthorizedUserRecord,
): ChannelNukeAuthorizedUserSummary {
  return {
    authorizationId: authorizedUser.id,
    discordUserId: authorizedUser.discordUserId,
    grantedByDiscordUserId: authorizedUser.grantedByDiscordUserId,
    createdAt: authorizedUser.createdAt.toISOString(),
    updatedAt: authorizedUser.updatedAt.toISOString(),
  };
}

export class NukeService {
  private readonly env = getEnv();
  private readonly nukeRepository = new NukeRepository();
  private readonly workerOwnerId = ulid().toLowerCase();
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerTickInFlight = false;

  public async getChannelSchedule(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
  }): Promise<Result<ChannelNukeScheduleSummary | null, AppError>> {
    try {
      const schedule = await this.nukeRepository.getScheduleByChannel({
        tenantId: input.tenantId,
        guildId: input.guildId,
        channelId: input.channelId,
      });

      if (!schedule) {
        return ok(null);
      }

      return ok({
        scheduleId: schedule.id,
        channelId: schedule.channelId,
        enabled: schedule.enabled,
        localTimeHhMm: schedule.localTimeHhmm,
        timezone: schedule.timezone,
        cadence: schedule.cadence,
        weeklyDayOfWeek: schedule.weeklyDayOfWeek,
        monthlyDayOfMonth: schedule.monthlyDayOfMonth,
        nextRunAtUtc: schedule.nextRunAtUtc.toISOString(),
        lastRunAtUtc: schedule.lastRunAtUtc?.toISOString() ?? null,
        lastLocalRunDate: schedule.lastLocalRunDate,
        consecutiveFailures: schedule.consecutiveFailures,
      });
    } catch (error) {
      return err(toNukeAppError(error));
    }
  }

  public async getCommandAccessState(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<Result<NukeCommandAccessState, AppError>> {
    try {
      const authorizedUsers = await this.nukeRepository.listAuthorizedUsers({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      return ok({
        locked: true,
        allowed: authorizedUsers.some((user) => user.discordUserId === input.discordUserId),
        authorizedUserCount: authorizedUsers.length,
      });
    } catch (error) {
      return err(toNukeAppError(error));
    }
  }

  public async listAuthorizedUsers(input: {
    tenantId: string;
    guildId: string;
  }): Promise<Result<ChannelNukeAuthorizedUserSummary[], AppError>> {
    try {
      const authorizedUsers = await this.nukeRepository.listAuthorizedUsers({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      return ok(authorizedUsers.map(mapAuthorizedUserSummary));
    } catch (error) {
      return err(toNukeAppError(error));
    }
  }

  public async grantUserAccess(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    grantedByDiscordUserId: string;
  }): Promise<
    Result<
      {
        authorizationId: string;
        discordUserId: string;
        created: boolean;
      },
      AppError
    >
  > {
    try {
      const granted = await this.nukeRepository.upsertAuthorizedUser({
        tenantId: input.tenantId,
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        grantedByDiscordUserId: input.grantedByDiscordUserId,
      });

      return ok({
        authorizationId: granted.record.id,
        discordUserId: granted.record.discordUserId,
        created: granted.created,
      });
    } catch (error) {
      return err(toNukeAppError(error));
    }
  }

  public async revokeUserAccess(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<Result<{ revoked: boolean }, AppError>> {
    try {
      const revoked = await this.nukeRepository.revokeAuthorizedUser({
        tenantId: input.tenantId,
        guildId: input.guildId,
        discordUserId: input.discordUserId,
      });

      return ok({ revoked });
    } catch (error) {
      return err(toNukeAppError(error));
    }
  }

  public async setSchedule(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
    timeHhMm: string;
    timezone: string;
    cadence?: string | null;
    weeklyDayOfWeek?: number | null;
    monthlyDayOfMonth?: number | null;
    actorDiscordUserId: string;
  }): Promise<
    Result<
      {
        scheduleId: string;
        channelId: string;
        localTimeHhMm: string;
        timezone: string;
        cadence: NukeScheduleCadence;
        weeklyDayOfWeek: number | null;
        monthlyDayOfMonth: number | null;
        nextRunAtUtc: string;
        enabled: boolean;
      },
      AppError
    >
  > {
    try {
      const now = new Date();
      const timezone = assertValidTimezone(input.timezone);
      const cadence = assertValidScheduleCadence(input.cadence);
      const parsed = parseDailyTimeHhMm(input.timeHhMm);
      const normalizedTime = `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
      const recurrence = resolveScheduleRecurrence({
        cadence,
        timezone,
        now,
        weeklyDayOfWeek: input.weeklyDayOfWeek,
        monthlyDayOfMonth: input.monthlyDayOfMonth,
      });
      const nextRunAtUtc = computeNextRunForSchedule({
        timezone,
        localTimeHhmm: normalizedTime,
        cadence,
        weeklyDayOfWeek: recurrence.weeklyDayOfWeek,
        monthlyDayOfMonth: recurrence.monthlyDayOfMonth,
        now,
      });

      const schedule = await this.nukeRepository.upsertSchedule({
        tenantId: input.tenantId,
        guildId: input.guildId,
        channelId: input.channelId,
        localTimeHhmm: normalizedTime,
        timezone,
        cadence,
        weeklyDayOfWeek: recurrence.weeklyDayOfWeek,
        monthlyDayOfMonth: recurrence.monthlyDayOfMonth,
        nextRunAtUtc,
        updatedByDiscordUserId: input.actorDiscordUserId,
      });

      return ok({
        scheduleId: schedule.id,
        channelId: schedule.channelId,
        localTimeHhMm: schedule.localTimeHhmm,
        timezone: schedule.timezone,
        cadence: schedule.cadence,
        weeklyDayOfWeek: schedule.weeklyDayOfWeek,
        monthlyDayOfMonth: schedule.monthlyDayOfMonth,
        nextRunAtUtc: schedule.nextRunAtUtc.toISOString(),
        enabled: schedule.enabled,
      });
    } catch (error) {
      return err(toNukeAppError(error));
    }
  }

  public async disableSchedule(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
    actorDiscordUserId: string;
  }): Promise<Result<{ disabled: boolean }, AppError>> {
    try {
      const disabled = await this.nukeRepository.disableScheduleByChannel({
        tenantId: input.tenantId,
        guildId: input.guildId,
        channelId: input.channelId,
        updatedByDiscordUserId: input.actorDiscordUserId,
      });
      return ok({ disabled });
    } catch (error) {
      return err(toNukeAppError(error));
    }
  }

  public startSchedulerLoop(_client: unknown, input: { pollIntervalMs: number }): void {
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

  public async runNukeNow(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
    actorDiscordUserId: string;
    reason: 'manual';
    idempotencyKey?: string;
  }): Promise<
    Result<
      {
        status: 'success' | 'partial' | 'duplicate';
        oldChannelId: string;
        newChannelId: string | null;
        oldChannelDeleted: boolean;
        message: string;
      },
      AppError
    >
  > {
    try {
      const idempotencyKey =
        input.idempotencyKey?.trim() ||
        `${input.guildId}:${input.channelId}:manual:${Math.floor(Date.now() / 1000)}`;
      const result = await this.executeNuke({
        tenantId: input.tenantId,
        guildId: input.guildId,
        channelId: input.channelId,
        mode: 'replace',
        triggerType: 'manual',
        schedule: null,
        actorDiscordUserId: input.actorDiscordUserId,
        idempotencyKey,
      });

      return ok(result);
    } catch (error) {
      return err(toNukeAppError(error));
    }
  }

  public async runDeleteNow(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
    actorDiscordUserId: string;
    reason: 'manual';
    idempotencyKey?: string;
  }): Promise<
    Result<
      {
        status: 'success' | 'partial' | 'duplicate';
        oldChannelId: string;
        newChannelId: string | null;
        oldChannelDeleted: boolean;
        message: string;
      },
      AppError
    >
  > {
    try {
      const idempotencyKey =
        input.idempotencyKey?.trim() ||
        `${input.guildId}:${input.channelId}:delete:${Math.floor(Date.now() / 1000)}`;
      const result = await this.executeNuke({
        tenantId: input.tenantId,
        guildId: input.guildId,
        channelId: input.channelId,
        mode: 'delete_only',
        triggerType: 'manual',
        schedule: null,
        actorDiscordUserId: input.actorDiscordUserId,
        idempotencyKey,
      });

      return ok(result);
    } catch (error) {
      return err(toNukeAppError(error));
    }
  }

  private async runDueSchedules(): Promise<void> {
    try {
      const due = await this.nukeRepository.listDueSchedules({
        now: new Date(),
        limit: 20,
      });

      for (const schedule of due) {
        const localDate = resolveLocalDate({
          timezone: schedule.timezone,
          at: new Date(),
        });

        const idempotencyKey = buildScheduledNukeIdempotencyKey({
          guildId: schedule.guildId,
          channelId: schedule.channelId,
          localDate,
        });

        try {
          await this.executeNuke({
            tenantId: schedule.tenantId,
            guildId: schedule.guildId,
            channelId: schedule.channelId,
            mode: 'replace',
            triggerType: 'scheduled',
            schedule,
            actorDiscordUserId: null,
            idempotencyKey,
          });
        } catch (error) {
          logger.warn(
            {
              tenantId: schedule.tenantId,
              guildId: schedule.guildId,
              channelId: schedule.channelId,
              scheduleId: schedule.id,
              errorMessage: error instanceof Error ? error.message : 'unknown',
            },
            'scheduled nuke execution failed',
          );
        }
      }
    } catch (error) {
      logger.warn(
        { errorMessage: error instanceof Error ? error.message : 'unknown' },
        'failed to poll due nuke schedules',
      );
    }
  }

  private async executeNuke(input: {
    tenantId: string;
    guildId: string;
    channelId: string;
    mode: NukeExecutionMode;
    triggerType: 'scheduled' | 'manual' | 'retry';
    schedule: ChannelNukeScheduleRecord | null;
    actorDiscordUserId: string | null;
    idempotencyKey: string;
  }): Promise<{
    status: 'success' | 'partial' | 'duplicate';
    oldChannelId: string;
    newChannelId: string | null;
    oldChannelDeleted: boolean;
    message: string;
  }> {
    const lockKey = `${input.guildId}:${input.channelId}`;
    const leaseUntil = new Date(Date.now() + LOCK_LEASE_MS);
    const lockAcquired = await this.nukeRepository.tryAcquireLock({
      lockKey,
      ownerId: this.workerOwnerId,
      leaseUntil,
    });

    if (!lockAcquired) {
      return {
        status: 'duplicate',
        oldChannelId: input.channelId,
        newChannelId: null,
        oldChannelDeleted: false,
        message: 'Another nuke run is already in progress for this channel.',
      };
    }

    const correlationId = ulid();
    let runId: string | null = null;
    let lockLeaseLostError: Error | null = null;
    const assertLockLease = (): void => {
      if (lockLeaseLostError) {
        throw new AbortError('Nuke lock lease was lost while executing this run.');
      }
    };
    const refreshLockLease = async (): Promise<void> => {
      const renewed = await this.nukeRepository.renewLockLease({
        lockKey,
        ownerId: this.workerOwnerId,
        leaseUntil: new Date(Date.now() + LOCK_LEASE_MS),
      });
      if (!renewed) {
        throw new AbortError('Nuke lock could not be renewed.');
      }
    };
    const lockHeartbeat = setInterval(() => {
      void refreshLockLease().catch((error) => {
        lockLeaseLostError = error instanceof Error ? error : new Error('nuke lock renewal failed');
      });
    }, LOCK_HEARTBEAT_MS);
    lockHeartbeat.unref?.();

    try {
      await refreshLockLease();

      const run = await this.nukeRepository.createRun({
        scheduleId: input.schedule?.id ?? null,
        tenantId: input.tenantId,
        guildId: input.guildId,
        channelId: input.channelId,
        triggerType: input.triggerType,
        idempotencyKey: input.idempotencyKey,
        actorDiscordUserId: input.actorDiscordUserId,
        correlationId,
      });

      runId = run.runId;
      if (!run.created) {
        if (input.schedule) {
          const now = new Date();
          const localDate = resolveLocalDate({
            timezone: input.schedule.timezone,
            at: now,
          });
          const nextRunAtUtc = computeNextRunForSchedule({
            timezone: input.schedule.timezone,
            localTimeHhmm: input.schedule.localTimeHhmm,
            cadence: input.schedule.cadence,
            weeklyDayOfWeek: input.schedule.weeklyDayOfWeek,
            monthlyDayOfMonth: input.schedule.monthlyDayOfMonth,
            now,
            lastLocalRunDate: localDate,
          });
          await this.nukeRepository.setScheduleNextRunById({
            scheduleId: input.schedule.id,
            nextRunAtUtc,
            updatedByDiscordUserId: input.actorDiscordUserId,
            lastLocalRunDate: localDate,
            lastRunAtUtc: now,
          });
        }

        return {
          status: 'duplicate',
          oldChannelId: input.channelId,
          newChannelId: null,
          oldChannelDeleted: false,
          message: 'Nuke already executed for this idempotency key.',
        };
      }

      await this.nukeRepository.markRunStarted(runId);
      assertLockLease();
      await refreshLockLease();

      const sourceChannel = await this.fetchChannel(input.channelId);
      if (!sourceChannel.guild_id || sourceChannel.guild_id !== input.guildId) {
        throw new AbortError('Channel does not belong to the expected guild.');
      }

      if (!this.isSupportedChannelType(sourceChannel.type)) {
        throw new AbortError('Only text and announcement channels are supported for nuke.');
      }
      assertLockLease();
      await refreshLockLease();

      if (input.mode === 'delete_only') {
        await this.deleteChannel(input.channelId);
        assertLockLease();
        await refreshLockLease();

        try {
          await this.nukeRepository.disableScheduleByChannel({
            tenantId: input.tenantId,
            guildId: input.guildId,
            channelId: input.channelId,
            updatedByDiscordUserId: input.actorDiscordUserId ?? 'system',
          });

          await this.nukeRepository.markRunSuccess({
            runId,
            oldChannelId: input.channelId,
            newChannelId: null,
          });
        } catch (error) {
          logger.error(
            {
              err: error,
              tenantId: input.tenantId,
              guildId: input.guildId,
              oldChannelId: input.channelId,
              runId,
            },
            'delete-only nuke bookkeeping failed after deleting the channel',
          );

          try {
            await this.nukeRepository.markRunPartial({
              runId,
              oldChannelId: input.channelId,
              newChannelId: null,
              errorMessage:
                error instanceof Error
                  ? error.message
                  : 'Delete-only nuke bookkeeping failed after channel deletion',
            });
          } catch (markPartialError) {
            logger.error(
              {
                err: markPartialError,
                runId,
                oldChannelId: input.channelId,
              },
              'failed to mark delete-only nuke run partial after bookkeeping error',
            );
          }

          return {
            status: 'partial',
            oldChannelId: input.channelId,
            newChannelId: null,
            oldChannelDeleted: true,
            message:
              'Channel was deleted, but disabling its stored nuke schedule failed. Please check logs before reusing this server setup.',
          };
        }

        return {
          status: 'success',
          oldChannelId: input.channelId,
          newChannelId: null,
          oldChannelDeleted: true,
          message:
            'Channel deleted successfully. No replacement channel was created. Any stored nuke schedule for this channel was disabled.',
        };
      }

      const clonedChannel = await this.cloneChannel(sourceChannel);
      assertLockLease();
      await refreshLockLease();

      try {
        await this.deleteChannel(input.channelId);
      } catch (error) {
        await this.nukeRepository.markRunPartial({
          runId,
          oldChannelId: input.channelId,
          newChannelId: clonedChannel.id,
          errorMessage: error instanceof Error ? error.message : 'Failed to delete original channel',
        });
        await this.handleScheduleFailure({
          schedule: input.schedule,
          actorDiscordUserId: input.actorDiscordUserId,
        });
        return {
          status: 'partial',
          oldChannelId: input.channelId,
          newChannelId: clonedChannel.id,
          oldChannelDeleted: false,
          message:
            'Channel clone succeeded but deleting the original channel failed. Both channels currently exist.',
        };
      }
      assertLockLease();
      await refreshLockLease();

      const localDate =
        input.schedule &&
        resolveLocalDate({
          timezone: input.schedule.timezone,
          at: new Date(),
        });
      const nextRunAtUtc =
        input.schedule && localDate
          ? computeNextRunForSchedule({
              timezone: input.schedule.timezone,
              localTimeHhmm: input.schedule.localTimeHhmm,
              cadence: input.schedule.cadence,
              weeklyDayOfWeek: input.schedule.weeklyDayOfWeek,
              monthlyDayOfMonth: input.schedule.monthlyDayOfMonth,
              now: new Date(),
              lastLocalRunDate: localDate,
            })
          : null;

      try {
        await this.nukeRepository.finalizeSuccessfulNuke({
          tenantId: input.tenantId,
          guildId: input.guildId,
          oldChannelId: input.channelId,
          newChannelId: clonedChannel.id,
          scheduleId: input.schedule?.id ?? null,
          nextRunAtUtc,
          lastLocalRunDate: localDate ?? null,
          updatedByDiscordUserId: input.actorDiscordUserId,
        });

        await this.nukeRepository.markRunSuccess({
          runId,
          oldChannelId: input.channelId,
          newChannelId: clonedChannel.id,
        });
      } catch (error) {
        logger.error(
          {
            err: error,
            tenantId: input.tenantId,
            guildId: input.guildId,
            oldChannelId: input.channelId,
            newChannelId: clonedChannel.id,
            runId,
          },
          'nuke bookkeeping failed after deleting the original channel',
        );

        try {
          await this.nukeRepository.markRunPartial({
            runId,
            oldChannelId: input.channelId,
            newChannelId: clonedChannel.id,
            errorMessage:
              error instanceof Error ? error.message : 'Nuke bookkeeping failed after channel deletion',
          });
        } catch (markPartialError) {
          logger.error(
            {
              err: markPartialError,
              runId,
              oldChannelId: input.channelId,
              newChannelId: clonedChannel.id,
            },
            'failed to mark nuke run partial after bookkeeping error',
          );
        }

        await this.handleScheduleFailure({
          schedule: input.schedule,
          actorDiscordUserId: input.actorDiscordUserId,
        });

        return {
          status: 'partial',
          oldChannelId: input.channelId,
          newChannelId: clonedChannel.id,
          oldChannelDeleted: true,
          message:
            'Channel was recreated, but internal bookkeeping failed after deletion. Please check logs before continuing.',
        };
      }

      return {
        status: 'success',
        oldChannelId: input.channelId,
        newChannelId: clonedChannel.id,
        oldChannelDeleted: true,
        message: `Channel nuked successfully. New channel: ${clonedChannel.id}`,
      };
    } catch (error) {
      if (runId) {
        await this.nukeRepository.markRunFailed({
          runId,
          errorMessage: error instanceof Error ? error.message : 'Nuke execution failed',
        });
      }
      await this.handleScheduleFailure({
        schedule: input.schedule,
        actorDiscordUserId: input.actorDiscordUserId,
      });
      throw error;
    } finally {
      clearInterval(lockHeartbeat);
      await this.nukeRepository.releaseLock({
        lockKey,
        ownerId: this.workerOwnerId,
      });
    }
  }

  private async handleScheduleFailure(input: {
    schedule: ChannelNukeScheduleRecord | null;
    actorDiscordUserId: string | null;
  }): Promise<void> {
    if (!input.schedule) {
      return;
    }

    const refreshed = await this.nukeRepository.bumpScheduleFailure({
      scheduleId: input.schedule.id,
      updatedByDiscordUserId: input.actorDiscordUserId,
    });
    const now = new Date();
    const localDate = resolveLocalDate({
      timezone: input.schedule.timezone,
      at: now,
    });
    const nextRunAtUtc = computeNextRunForSchedule({
      timezone: input.schedule.timezone,
      localTimeHhmm: input.schedule.localTimeHhmm,
      cadence: input.schedule.cadence,
      weeklyDayOfWeek: input.schedule.weeklyDayOfWeek,
      monthlyDayOfMonth: input.schedule.monthlyDayOfMonth,
      now,
      lastLocalRunDate: localDate,
    });
    await this.nukeRepository.setScheduleNextRunById({
      scheduleId: input.schedule.id,
      nextRunAtUtc,
      updatedByDiscordUserId: input.actorDiscordUserId,
      lastLocalRunDate: localDate,
      lastRunAtUtc: now,
    });
    if (refreshed && refreshed.consecutiveFailures >= MAX_SCHEDULE_FAILURES) {
      await this.nukeRepository.disableScheduleById({
        scheduleId: refreshed.id,
        updatedByDiscordUserId: input.actorDiscordUserId,
      });
    }
  }

  private async fetchChannel(channelId: string): Promise<DiscordChannelPayload> {
    return this.discordRequest<DiscordChannelPayload>({
      method: 'GET',
      path: `/channels/${channelId}`,
    });
  }

  private async cloneChannel(source: DiscordChannelPayload): Promise<DiscordChannelPayload> {
    const request = (includePosition: boolean) =>
      this.discordRequest<DiscordChannelPayload>({
        method: 'POST',
        path: `/guilds/${source.guild_id}/channels`,
        body: {
          name: source.name,
          type: source.type,
          topic: source.topic ?? undefined,
          parent_id: source.parent_id ?? undefined,
          nsfw: source.nsfw ?? undefined,
          rate_limit_per_user: source.rate_limit_per_user ?? undefined,
          position: includePosition ? source.position ?? undefined : undefined,
          permission_overwrites: source.permission_overwrites ?? undefined,
        },
      });

    try {
      return await request(true);
    } catch (error) {
      const canRetryWithoutPosition =
        source.position != null &&
        error instanceof Error &&
        /^Discord API POST \/guilds\/.+\/channels failed \((?:400|500)\)/u.test(error.message);

      if (!canRetryWithoutPosition) {
        throw error;
      }

      logger.warn(
        {
          guildId: source.guild_id,
          sourceChannelId: source.id,
          sourceChannelPosition: source.position,
          errorMessage: error.message,
        },
        'retrying nuke channel clone without explicit position',
      );

      return request(false);
    }
  }

  private async deleteChannel(channelId: string): Promise<void> {
    await this.discordRequest({
      method: 'DELETE',
      path: `/channels/${channelId}`,
    });
  }

  private isSupportedChannelType(type: number): boolean {
    // 0 = GUILD_TEXT, 5 = GUILD_ANNOUNCEMENT
    return type === 0 || type === 5;
  }

  private getNukeBotToken(): string {
    const nukeToken = this.env.NUKE_DISCORD_TOKEN.trim();
    if (nukeToken.length > 0) {
      return nukeToken;
    }

    const fallback = this.env.DISCORD_TOKEN.trim();
    if (fallback.length > 0) {
      return fallback;
    }

    throw new AppError('NUKE_BOT_TOKEN_MISSING', 'Nuke bot token is not configured', 500);
  }

  private async discordRequest<T = unknown>(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
  }): Promise<T> {
    const token = this.getNukeBotToken();
    const apiBaseUrl = this.env.DISCORD_API_BASE_URL.replace(/\/+$/u, '');

    return pRetry(
      async () => {
        const response = await fetch(`${apiBaseUrl}${input.path}`, {
          method: input.method,
          headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
          },
          body: input.body == null ? undefined : JSON.stringify(input.body),
        });

        if (response.status === 429) {
          const body = (await response.json().catch(() => null)) as
            | { retry_after?: number }
            | null;
          const retryAfterMs = Math.max(250, Math.floor((body?.retry_after ?? 1) * 1000));
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
          throw new Error(`Discord rate limited request to ${input.path}`);
        }

        if (!response.ok) {
          const bodyText = await response.text();
          const message = `Discord API ${input.method} ${input.path} failed (${response.status})`;

          if (response.status >= 500) {
            throw new Error(`${message}: ${bodyText}`);
          }

          throw new AbortError(`${message}: ${bodyText}`);
        }

        if (response.status === 204) {
          return undefined as T;
        }

        return (await response.json()) as T;
      },
      {
        retries: 3,
        minTimeout: 300,
        factor: 2,
      },
    );
  }
}

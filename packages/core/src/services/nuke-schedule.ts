import { Temporal } from '@js-temporal/polyfill';

import { AppError } from '../domain/errors.js';

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export const NUKE_SCHEDULE_CADENCES = ['daily', 'weekly', 'monthly'] as const;

export type NukeScheduleCadence = (typeof NUKE_SCHEDULE_CADENCES)[number];

export function parseDailyTimeHhMm(timeHhMm: string): { hour: number; minute: number } {
  const trimmed = timeHhMm.trim();
  const match = HHMM_REGEX.exec(trimmed);
  if (!match) {
    throw new AppError('NUKE_SCHEDULE_TIME_INVALID', 'Time must be in HH:mm (24-hour) format.', 422);
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

export function assertValidTimezone(timezone: string): string {
  const trimmed = timezone.trim();
  if (!trimmed) {
    throw new AppError('NUKE_SCHEDULE_TIMEZONE_INVALID', 'Timezone is required.', 422);
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format();
    return trimmed;
  } catch {
    throw new AppError(
      'NUKE_SCHEDULE_TIMEZONE_INVALID',
      `Invalid timezone "${timezone}". Use an IANA timezone like Europe/Berlin or America/New_York.`,
      422,
    );
  }
}

export function assertValidScheduleCadence(cadence?: string | null): NukeScheduleCadence {
  const trimmed = cadence?.trim().toLowerCase();
  if (!trimmed) {
    return 'daily';
  }

  if (NUKE_SCHEDULE_CADENCES.includes(trimmed as NukeScheduleCadence)) {
    return trimmed as NukeScheduleCadence;
  }

  throw new AppError(
    'NUKE_SCHEDULE_CADENCE_INVALID',
    'Cadence must be one of: daily, weekly, monthly.',
    422,
  );
}

export function assertValidWeeklyDayOfWeek(dayOfWeek: number): number {
  if (Number.isInteger(dayOfWeek) && dayOfWeek >= 1 && dayOfWeek <= 7) {
    return dayOfWeek;
  }

  throw new AppError(
    'NUKE_SCHEDULE_WEEKDAY_INVALID',
    'Weekday must be between 1 (Monday) and 7 (Sunday).',
    422,
  );
}

export function assertValidMonthlyDayOfMonth(dayOfMonth: number): number {
  if (Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31) {
    return dayOfMonth;
  }

  throw new AppError(
    'NUKE_SCHEDULE_DAY_OF_MONTH_INVALID',
    'Day of month must be between 1 and 31.',
    422,
  );
}

export function formatNukeScheduleCadence(cadence: NukeScheduleCadence): string {
  return cadence.charAt(0).toUpperCase() + cadence.slice(1);
}

export function formatWeeklyDayOfWeek(dayOfWeek: number): string {
  const normalized = assertValidWeeklyDayOfWeek(dayOfWeek);
  return ISO_WEEKDAY_NAMES[normalized - 1]!;
}

function buildLocalZonedDateTime(input: {
  timezone: string;
  plainDate: Temporal.PlainDate;
  hour: number;
  minute: number;
}): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from(
    {
      timeZone: input.timezone,
      year: input.plainDate.year,
      month: input.plainDate.month,
      day: input.plainDate.day,
      hour: input.hour,
      minute: input.minute,
      second: 0,
      millisecond: 0,
      microsecond: 0,
      nanosecond: 0,
    },
    { disambiguation: 'compatible' },
  );
}

function resolveZonedDateTime(input: {
  timezone: string;
  at: Date;
}): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(input.at.getTime()).toZonedDateTimeISO(input.timezone);
}

function buildMonthlyPlainDate(input: {
  referenceDate: Temporal.PlainDate;
  dayOfMonth: number;
}): Temporal.PlainDate {
  const firstDayOfMonth = Temporal.PlainDate.from({
    year: input.referenceDate.year,
    month: input.referenceDate.month,
    day: 1,
  });

  return firstDayOfMonth.with({
    day: Math.min(input.dayOfMonth, firstDayOfMonth.daysInMonth),
  });
}

function isSameLocalMinute(left: Temporal.ZonedDateTime, right: Temporal.ZonedDateTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

export function resolveLocalDate(input: {
  timezone: string;
  at: Date;
}): string {
  const zoned = resolveZonedDateTime(input);
  return zoned.toPlainDate().toString();
}

export function resolveLocalScheduleAnchor(input: {
  timezone: string;
  at: Date;
}): {
  dayOfWeek: number;
  dayOfMonth: number;
} {
  const zoned = resolveZonedDateTime(input);

  return {
    dayOfWeek: zoned.dayOfWeek,
    dayOfMonth: zoned.day,
  };
}

export function computeNextRunAtUtc(input: {
  timezone: string;
  timeHhMm: string;
  now: Date;
  cadence?: NukeScheduleCadence | string | null;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  lastLocalRunDate?: string | null;
}): Date {
  const timezone = assertValidTimezone(input.timezone);
  const { hour, minute } = parseDailyTimeHhMm(input.timeHhMm);
  const cadence = assertValidScheduleCadence(input.cadence);

  const zonedNow = resolveZonedDateTime({
    timezone,
    at: input.now,
  });
  const today = zonedNow.toPlainDate();
  const targetWeeklyDayOfWeek =
    cadence === 'weekly' ? assertValidWeeklyDayOfWeek(input.dayOfWeek ?? NaN) : undefined;
  const targetMonthlyDayOfMonth =
    cadence === 'monthly' ? assertValidMonthlyDayOfMonth(input.dayOfMonth ?? NaN) : undefined;
  let candidateDate = (() => {
    switch (cadence) {
      case 'weekly':
        return today.add({
          days: (targetWeeklyDayOfWeek! - today.dayOfWeek + 7) % 7,
        });
      case 'monthly':
        return buildMonthlyPlainDate({
          referenceDate: today,
          dayOfMonth: targetMonthlyDayOfMonth!,
        });
      case 'daily':
      default:
        return today;
    }
  })();

  let candidate = buildLocalZonedDateTime({
    timezone,
    plainDate: candidateDate,
    hour,
    minute,
  });

  const alreadyRanForCandidate = input.lastLocalRunDate === candidateDate.toString();
  if (
    alreadyRanForCandidate ||
    (!isSameLocalMinute(candidate, zonedNow) && Temporal.ZonedDateTime.compare(candidate, zonedNow) <= 0)
  ) {
    candidateDate =
      cadence === 'weekly'
        ? candidateDate.add({ days: 7 })
        : cadence === 'monthly'
          ? buildMonthlyPlainDate({
              referenceDate: Temporal.PlainDate.from({
                year: candidateDate.year,
                month: candidateDate.month,
                day: 1,
              }).add({ months: 1 }),
              dayOfMonth: targetMonthlyDayOfMonth!,
            })
          : candidateDate.add({ days: 1 });

    candidate = buildLocalZonedDateTime({
      timezone,
      plainDate: candidateDate,
      hour,
      minute,
    });
  }

  return new Date(candidate.epochMilliseconds);
}

export function buildScheduledNukeIdempotencyKey(input: {
  guildId: string;
  channelId: string;
  localDate: string;
}): string {
  return `${input.guildId}:${input.channelId}:${input.localDate}`;
}

import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

import { AppError, validationError } from '../domain/errors.js';

export const SALES_HISTORY_AUTO_CLEAR_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

export type SalesHistoryAutoClearFrequency =
  (typeof SALES_HISTORY_AUTO_CLEAR_FREQUENCIES)[number];

export type SalesHistoryAutoClearConfig = {
  enabled: boolean;
  frequency: SalesHistoryAutoClearFrequency;
  localTimeHhMm: string;
  timezone: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
};

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const salesHistoryAutoClearSchema = z
  .object({
    enabled: z.boolean(),
    frequency: z.enum(SALES_HISTORY_AUTO_CLEAR_FREQUENCIES),
    localTimeHhMm: z.string().trim().min(1),
    timezone: z.string().trim().min(1),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.frequency === 'weekly' && value.dayOfWeek == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose a weekday for weekly sales-history auto clear.',
        path: ['dayOfWeek'],
      });
    }

    if (value.frequency === 'monthly' && value.dayOfMonth == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose a calendar day for monthly sales-history auto clear.',
        path: ['dayOfMonth'],
      });
    }
  });

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

function toScheduleDayOfWeek(dayOfWeek: number): number {
  return dayOfWeek % 7;
}

function buildMonthlyPlainDate(
  baseDate: Temporal.PlainDate,
  requestedDayOfMonth: number,
): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    year: baseDate.year,
    month: baseDate.month,
    day: Math.min(requestedDayOfMonth, baseDate.daysInMonth),
  });
}

export function parseDailyTimeHhMm(timeHhMm: string): { hour: number; minute: number } {
  const trimmed = timeHhMm.trim();
  const match = HHMM_REGEX.exec(trimmed);
  if (!match) {
    throw new AppError(
      'SALES_HISTORY_SCHEDULE_TIME_INVALID',
      'Time must be in HH:mm (24-hour) format.',
      422,
    );
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

export function assertValidTimezone(timezone: string): string {
  const trimmed = timezone.trim();
  if (!trimmed) {
    throw new AppError(
      'SALES_HISTORY_SCHEDULE_TIMEZONE_INVALID',
      'Timezone is required.',
      422,
    );
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format();
    return trimmed;
  } catch {
    throw new AppError(
      'SALES_HISTORY_SCHEDULE_TIMEZONE_INVALID',
      `Invalid timezone "${timezone}". Use an IANA timezone like Europe/Berlin or America/New_York.`,
      422,
    );
  }
}

export function parseSalesHistoryAutoClearConfig(input: unknown): SalesHistoryAutoClearConfig {
  const parsed = salesHistoryAutoClearSchema.safeParse(input);
  if (!parsed.success) {
    throw validationError(parsed.error.issues);
  }

  const timezone = assertValidTimezone(parsed.data.timezone);
  const { hour, minute } = parseDailyTimeHhMm(parsed.data.localTimeHhMm);

  return {
    enabled: parsed.data.enabled,
    frequency: parsed.data.frequency,
    localTimeHhMm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    timezone,
    dayOfWeek: parsed.data.frequency === 'weekly' ? parsed.data.dayOfWeek ?? null : null,
    dayOfMonth: parsed.data.frequency === 'monthly' ? parsed.data.dayOfMonth ?? null : null,
  };
}

export function hasSameSalesHistoryAutoClearPattern(
  left: SalesHistoryAutoClearConfig,
  right: SalesHistoryAutoClearConfig,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.frequency === right.frequency &&
    left.localTimeHhMm === right.localTimeHhMm &&
    left.timezone === right.timezone &&
    left.dayOfWeek === right.dayOfWeek &&
    left.dayOfMonth === right.dayOfMonth
  );
}

export function resolveLocalDate(input: { timezone: string; at: Date }): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(input.at.getTime()).toZonedDateTimeISO(
    input.timezone,
  );
  return zoned.toPlainDate().toString();
}

export function computeNextRunAtUtc(input: {
  frequency: SalesHistoryAutoClearFrequency;
  localTimeHhMm: string;
  timezone: string;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  now: Date;
  lastLocalRunDate?: string | null;
}): Date {
  const timezone = assertValidTimezone(input.timezone);
  const { hour, minute } = parseDailyTimeHhMm(input.localTimeHhMm);
  const zonedNow = Temporal.Instant.fromEpochMilliseconds(input.now.getTime()).toZonedDateTimeISO(
    timezone,
  );
  const today = zonedNow.toPlainDate();
  const alreadyRanToday = input.lastLocalRunDate === today.toString();
  let candidateDate = today;

  if (input.frequency === 'weekly') {
    if (input.dayOfWeek == null) {
      throw new AppError(
        'SALES_HISTORY_SCHEDULE_WEEKDAY_REQUIRED',
        'Choose a weekday for weekly sales-history auto clear.',
        422,
      );
    }

    const todayDayOfWeek = toScheduleDayOfWeek(zonedNow.dayOfWeek);
    const daysUntil = (input.dayOfWeek - todayDayOfWeek + 7) % 7;
    candidateDate = today.add({ days: daysUntil });
  }

  if (input.frequency === 'monthly') {
    if (input.dayOfMonth == null) {
      throw new AppError(
        'SALES_HISTORY_SCHEDULE_MONTHDAY_REQUIRED',
        'Choose a calendar day for monthly sales-history auto clear.',
        422,
      );
    }

    candidateDate = buildMonthlyPlainDate(today, input.dayOfMonth);
  }

  let candidate = buildLocalZonedDateTime({
    timezone,
    plainDate: candidateDate,
    hour,
    minute,
  });
  const candidateIsToday = Temporal.PlainDate.compare(candidateDate, today) === 0;
  const sameLocalMinute =
    candidateIsToday && zonedNow.hour === hour && zonedNow.minute === minute;
  const shouldAdvance = candidateIsToday
    ? alreadyRanToday || (!sameLocalMinute && Temporal.ZonedDateTime.compare(candidate, zonedNow) <= 0)
    : Temporal.ZonedDateTime.compare(candidate, zonedNow) <= 0;

  if (shouldAdvance) {
    if (input.frequency === 'monthly') {
      const nextMonth = Temporal.PlainDate.from({
        year: today.year,
        month: today.month,
        day: 1,
      }).add({ months: 1 });

      candidateDate = buildMonthlyPlainDate(nextMonth, input.dayOfMonth ?? today.day);
    } else {
      candidateDate = candidateDate.add({ days: input.frequency === 'weekly' ? 7 : 1 });
    }

    candidate = buildLocalZonedDateTime({
      timezone,
      plainDate: candidateDate,
      hour,
      minute,
    });
  }

  return new Date(candidate.epochMilliseconds);
}

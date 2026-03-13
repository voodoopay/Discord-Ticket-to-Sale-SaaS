import { Temporal } from '@js-temporal/polyfill';

import { AppError } from '../domain/errors.js';

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

export function resolveLocalDate(input: {
  timezone: string;
  at: Date;
}): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(input.at.getTime()).toZonedDateTimeISO(
    input.timezone,
  );
  return zoned.toPlainDate().toString();
}

export function computeNextRunAtUtc(input: {
  timezone: string;
  timeHhMm: string;
  now: Date;
  lastLocalRunDate?: string | null;
}): Date {
  const timezone = assertValidTimezone(input.timezone);
  const { hour, minute } = parseDailyTimeHhMm(input.timeHhMm);

  const zonedNow = Temporal.Instant.fromEpochMilliseconds(input.now.getTime()).toZonedDateTimeISO(timezone);
  const today = zonedNow.toPlainDate();
  let candidate = buildLocalZonedDateTime({
    timezone,
    plainDate: today,
    hour,
    minute,
  });

  const alreadyRanToday = input.lastLocalRunDate === today.toString();
  const sameLocalMinute = zonedNow.hour === hour && zonedNow.minute === minute;
  if (alreadyRanToday || (!sameLocalMinute && Temporal.ZonedDateTime.compare(candidate, zonedNow) <= 0)) {
    candidate = buildLocalZonedDateTime({
      timezone,
      plainDate: today.add({ days: 1 }),
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

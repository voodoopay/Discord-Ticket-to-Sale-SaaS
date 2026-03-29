import { describe, expect, it } from 'vitest';

import {
  assertValidTimezone,
  assertValidScheduleCadence,
  buildScheduledNukeIdempotencyKey,
  computeNextRunAtUtc,
  formatWeeklyDayOfWeek,
  parseDailyTimeHhMm,
  resolveLocalDate,
} from '../src/services/nuke-schedule.js';

describe('nuke schedule helpers', () => {
  it('parses valid HH:mm input', () => {
    const parsed = parseDailyTimeHhMm('09:45');
    expect(parsed).toEqual({ hour: 9, minute: 45 });
  });

  it('rejects invalid HH:mm input', () => {
    expect(() => parseDailyTimeHhMm('25:00')).toThrow();
    expect(() => parseDailyTimeHhMm('9:00')).toThrow();
  });

  it('rejects blank or invalid timezones', () => {
    expect(() => assertValidTimezone('   ')).toThrow();
    expect(() => assertValidTimezone('Mars/Olympus')).toThrow();
  });

  it('defaults blank cadence to daily and rejects unknown cadence values', () => {
    expect(assertValidScheduleCadence(undefined)).toBe('daily');
    expect(assertValidScheduleCadence('')).toBe('daily');
    expect(() => assertValidScheduleCadence('yearly')).toThrow();
  });

  it('computes next run later same day when time is in the future', () => {
    const now = new Date('2026-03-04T09:00:00.000Z');
    const next = computeNextRunAtUtc({
      timezone: 'UTC',
      timeHhMm: '10:30',
      now,
    });

    expect(next.toISOString()).toBe('2026-03-04T10:30:00.000Z');
  });

  it('computes next run next day when time already passed', () => {
    const now = new Date('2026-03-04T22:30:00.000Z');
    const next = computeNextRunAtUtc({
      timezone: 'UTC',
      timeHhMm: '21:15',
      now,
    });

    expect(next.toISOString()).toBe('2026-03-05T21:15:00.000Z');
  });

  it('keeps the current day when the schedule is created during the target minute', () => {
    const now = new Date('2026-03-13T20:25:30.000Z');
    const next = computeNextRunAtUtc({
      timezone: 'Europe/London',
      timeHhMm: '20:25',
      now,
    });

    expect(next.toISOString()).toBe('2026-03-13T20:25:00.000Z');
  });

  it('computes next run next day when already ran today', () => {
    const now = new Date('2026-03-04T09:00:00.000Z');
    const next = computeNextRunAtUtc({
      timezone: 'UTC',
      timeHhMm: '23:00',
      now,
      lastLocalRunDate: '2026-03-04',
    });

    expect(next.toISOString()).toBe('2026-03-05T23:00:00.000Z');
  });

  it('computes the next weekly run on the requested weekday', () => {
    const now = new Date('2026-03-03T09:00:00.000Z');
    const next = computeNextRunAtUtc({
      timezone: 'UTC',
      timeHhMm: '10:30',
      cadence: 'weekly',
      dayOfWeek: 5,
      now,
    });

    expect(next.toISOString()).toBe('2026-03-06T10:30:00.000Z');
    expect(formatWeeklyDayOfWeek(5)).toBe('Friday');
  });

  it('computes the next weekly run for the following week after the scheduled minute passes', () => {
    const now = new Date('2026-03-06T11:00:00.000Z');
    const next = computeNextRunAtUtc({
      timezone: 'UTC',
      timeHhMm: '10:30',
      cadence: 'weekly',
      dayOfWeek: 5,
      now,
    });

    expect(next.toISOString()).toBe('2026-03-13T10:30:00.000Z');
  });

  it('computes the next monthly run using the last day when the configured date does not exist', () => {
    const now = new Date('2026-02-10T09:00:00.000Z');
    const next = computeNextRunAtUtc({
      timezone: 'UTC',
      timeHhMm: '10:30',
      cadence: 'monthly',
      dayOfMonth: 31,
      now,
    });

    expect(next.toISOString()).toBe('2026-02-28T10:30:00.000Z');
  });

  it('computes the next monthly run in the following month after the current occurrence already ran', () => {
    const now = new Date('2026-02-28T11:00:00.000Z');
    const next = computeNextRunAtUtc({
      timezone: 'UTC',
      timeHhMm: '10:30',
      cadence: 'monthly',
      dayOfMonth: 31,
      now,
      lastLocalRunDate: '2026-02-28',
    });

    expect(next.toISOString()).toBe('2026-03-31T10:30:00.000Z');
  });

  it('resolves local date and deterministic scheduled idempotency key', () => {
    const localDate = resolveLocalDate({
      timezone: 'UTC',
      at: new Date('2026-03-04T00:00:00.000Z'),
    });
    const key = buildScheduledNukeIdempotencyKey({
      guildId: '123',
      channelId: '456',
      localDate,
    });

    expect(localDate).toBe('2026-03-04');
    expect(key).toBe('123:456:2026-03-04');
  });
});

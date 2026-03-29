import { describe, expect, it } from 'vitest';

import { AppError } from '../src/domain/errors.js';
import {
  computeNextRunAtUtc,
  parseSalesHistoryAutoClearConfig,
} from '../src/services/sales-history-schedule.js';

describe('sales history schedule helpers', () => {
  it('keeps the current minute when a daily schedule is created during that same minute', () => {
    const result = computeNextRunAtUtc({
      frequency: 'daily',
      localTimeHhMm: '08:15',
      timezone: 'UTC',
      now: new Date('2026-03-30T08:15:00.000Z'),
      lastLocalRunDate: null,
    });

    expect(result.toISOString()).toBe('2026-03-30T08:15:00.000Z');
  });

  it('moves a daily schedule to the next day after it already ran for the local date', () => {
    const result = computeNextRunAtUtc({
      frequency: 'daily',
      localTimeHhMm: '08:15',
      timezone: 'UTC',
      now: new Date('2026-03-30T08:15:00.000Z'),
      lastLocalRunDate: '2026-03-30',
    });

    expect(result.toISOString()).toBe('2026-03-31T08:15:00.000Z');
  });

  it('computes the next weekly run for the chosen weekday', () => {
    const result = computeNextRunAtUtc({
      frequency: 'weekly',
      localTimeHhMm: '18:30',
      timezone: 'UTC',
      dayOfWeek: 4,
      now: new Date('2026-03-30T09:00:00.000Z'),
      lastLocalRunDate: null,
    });

    expect(result.toISOString()).toBe('2026-04-02T18:30:00.000Z');
  });

  it('clamps monthly schedules to the last day available in the month', () => {
    const result = computeNextRunAtUtc({
      frequency: 'monthly',
      localTimeHhMm: '09:00',
      timezone: 'UTC',
      dayOfMonth: 31,
      now: new Date('2026-02-10T08:00:00.000Z'),
      lastLocalRunDate: null,
    });

    expect(result.toISOString()).toBe('2026-02-28T09:00:00.000Z');
  });

  it('rejects invalid auto-clear timezone values', () => {
    expect(() =>
      parseSalesHistoryAutoClearConfig({
        enabled: true,
        frequency: 'daily',
        localTimeHhMm: '12:00',
        timezone: 'Mars/Base',
      }),
    ).toThrowError(AppError);
  });

  it('requires a weekday for weekly schedules and a month day for monthly schedules', () => {
    expect(() =>
      parseSalesHistoryAutoClearConfig({
        enabled: true,
        frequency: 'weekly',
        localTimeHhMm: '12:00',
        timezone: 'UTC',
      }),
    ).toThrowError(AppError);

    expect(() =>
      parseSalesHistoryAutoClearConfig({
        enabled: true,
        frequency: 'monthly',
        localTimeHhMm: '12:00',
        timezone: 'UTC',
      }),
    ).toThrowError(AppError);
  });
});

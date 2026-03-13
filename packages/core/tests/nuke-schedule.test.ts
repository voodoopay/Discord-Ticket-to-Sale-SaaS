import { describe, expect, it } from 'vitest';

import {
  buildScheduledNukeIdempotencyKey,
  computeNextRunAtUtc,
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

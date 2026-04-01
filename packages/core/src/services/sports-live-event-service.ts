import { err, ok, type Result } from 'neverthrow';

import { AppError } from '../domain/errors.js';
import {
  SportsLiveEventRepository,
  type SportsLiveEventChannelRecord,
} from '../repositories/sports-live-event-repository.js';

export type SportsLiveEventChannelSummary = {
  id: string;
  guildId: string;
  sportName: string;
  eventId: string;
  eventName: string;
  sportChannelId: string;
  eventChannelId: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'cleanup_due' | 'deleted' | 'failed';
  kickoffAtUtc: Date;
  lastScoreSnapshot: Record<string, unknown> | null;
  lastStateSnapshot: Record<string, unknown> | null;
  lastSyncedAtUtc: Date | null;
  finishedAtUtc: Date | null;
  deleteAfterUtc: Date | null;
  highlightsPosted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function mapSportsLiveEventChannelSummary(
  record: SportsLiveEventChannelRecord,
): SportsLiveEventChannelSummary {
  return {
    id: record.id,
    guildId: record.guildId,
    sportName: record.sportName,
    eventId: record.eventId,
    eventName: record.eventName,
    sportChannelId: record.sportChannelId,
    eventChannelId: record.eventChannelId,
    status: record.status,
    kickoffAtUtc: record.kickoffAtUtc,
    lastScoreSnapshot: record.lastScoreSnapshot,
    lastStateSnapshot: record.lastStateSnapshot,
    lastSyncedAtUtc: record.lastSyncedAtUtc,
    finishedAtUtc: record.finishedAtUtc,
    deleteAfterUtc: record.deleteAfterUtc,
    highlightsPosted: record.highlightsPosted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class SportsLiveEventService {
  constructor(private readonly repository = new SportsLiveEventRepository()) {}

  public async upsertTrackedEvent(input: {
    guildId: string;
    sportName: string;
    eventId: string;
    eventName: string;
    sportChannelId: string;
    kickoffAtUtc: Date;
    eventChannelId: string | null;
    status: SportsLiveEventChannelSummary['status'];
    lastScoreSnapshot: Record<string, unknown> | null;
    lastStateSnapshot: Record<string, unknown> | null;
    lastSyncedAtUtc: Date | null;
    finishedAtUtc: Date | null;
    deleteAfterUtc: Date | null;
    highlightsPosted?: boolean;
  }): Promise<Result<SportsLiveEventChannelSummary, AppError>> {
    try {
      const record = await this.repository.upsertTrackedEvent(input);
      return ok(mapSportsLiveEventChannelSummary(record));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'SPORTS_LIVE_EVENT_WRITE_FAILED',
              'Sports live event update failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async listTrackedEvents(input: {
    guildId: string;
    statuses?: SportsLiveEventChannelSummary['status'][];
  }): Promise<Result<SportsLiveEventChannelSummary[], AppError>> {
    try {
      const records = await this.repository.listTrackedEvents(input);
      return ok(records.map((record) => mapSportsLiveEventChannelSummary(record)));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'SPORTS_LIVE_EVENT_READ_FAILED',
              'Sports live event read failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async listRecoverableEvents(input: {
    guildId: string;
  }): Promise<Result<SportsLiveEventChannelSummary[], AppError>> {
    return this.listTrackedEvents({
      guildId: input.guildId,
      statuses: ['live', 'finished', 'cleanup_due'],
    });
  }

  public async getTrackedEvent(input: {
    guildId: string;
    eventId: string;
  }): Promise<Result<SportsLiveEventChannelSummary | null, AppError>> {
    try {
      const record = await this.repository.getTrackedEvent(input);
      return ok(record ? mapSportsLiveEventChannelSummary(record) : null);
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'SPORTS_LIVE_EVENT_READ_FAILED',
              'Sports live event read failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async markFinished(input: {
    guildId: string;
    eventId: string;
    finishedAtUtc: Date;
  }): Promise<Result<SportsLiveEventChannelSummary, AppError>> {
    const deleteAfterUtc = new Date(input.finishedAtUtc.getTime() + 3 * 60 * 60 * 1000);

    try {
      const record = await this.repository.markFinished({
        guildId: input.guildId,
        eventId: input.eventId,
        finishedAtUtc: input.finishedAtUtc,
        deleteAfterUtc,
      });

      if (!record) {
        return err(
          new AppError('SPORTS_LIVE_EVENT_NOT_FOUND', 'Tracked live event not found.', 404),
        );
      }

      return ok(mapSportsLiveEventChannelSummary(record));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'SPORTS_LIVE_EVENT_WRITE_FAILED',
              'Sports live event update failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async markDeleted(input: {
    guildId: string;
    eventId: string;
    deletedAtUtc: Date;
  }): Promise<Result<SportsLiveEventChannelSummary, AppError>> {
    try {
      const record = await this.repository.markDeleted(input);

      if (!record) {
        return err(
          new AppError('SPORTS_LIVE_EVENT_NOT_FOUND', 'Tracked live event not found.', 404),
        );
      }

      return ok(mapSportsLiveEventChannelSummary(record));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'SPORTS_LIVE_EVENT_WRITE_FAILED',
              'Sports live event update failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async markHighlightsPosted(input: {
    guildId: string;
    eventId: string;
    postedAtUtc: Date;
  }): Promise<Result<SportsLiveEventChannelSummary, AppError>> {
    try {
      const record = await this.repository.markHighlightsPosted(input);

      if (!record) {
        return err(
          new AppError('SPORTS_LIVE_EVENT_NOT_FOUND', 'Tracked live event not found.', 404),
        );
      }

      return ok(mapSportsLiveEventChannelSummary(record));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'SPORTS_LIVE_EVENT_WRITE_FAILED',
              'Sports live event update failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async markFailed(input: {
    guildId: string;
    eventId: string;
    failedAtUtc: Date;
  }): Promise<Result<SportsLiveEventChannelSummary, AppError>> {
    try {
      const record = await this.repository.markFailed(input);

      if (!record) {
        return err(
          new AppError('SPORTS_LIVE_EVENT_NOT_FOUND', 'Tracked live event not found.', 404),
        );
      }

      return ok(mapSportsLiveEventChannelSummary(record));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'SPORTS_LIVE_EVENT_WRITE_FAILED',
              'Sports live event update failed due to an internal error.',
              500,
            ),
      );
    }
  }
}

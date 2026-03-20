import pRetry, { AbortError } from 'p-retry';
import { err, ok, type Result } from 'neverthrow';

import { getEnv } from '../config/env.js';
import { AppError } from '../domain/errors.js';
import { resolveLocalDate } from './sports-schedule.js';

type SportsApiV1TvEvent = {
  id?: string | null;
  idEvent?: string | null;
  intDivision?: string | null;
  strSport?: string | null;
  strEvent?: string | null;
  strEventThumb?: string | null;
  strEventPoster?: string | null;
  strEventBanner?: string | null;
  strEventSquare?: string | null;
  idChannel?: string | null;
  strCountry?: string | null;
  strEventCountry?: string | null;
  strLogo?: string | null;
  strChannel?: string | null;
  strSeason?: string | null;
  strTime?: string | null;
  dateEvent?: string | null;
  strTimeStamp?: string | null;
};

type SportsApiV2Sport = {
  idSport?: string | null;
  strSport?: string | null;
  strSportThumb?: string | null;
  strSportThumbBW?: string | null;
  strSportIconGreen?: string | null;
  strSportDescription?: string | null;
};

type SportsApiV2EventSearch = {
  idEvent?: string | number | null;
  strEvent?: string | null;
  strLeague?: string | null;
  dateEvent?: string | null;
  strThumb?: string | null;
  strSport?: string | null;
};

type SportsApiV2EventLookup = {
  idEvent?: string | number | null;
  strEvent?: string | null;
  strSport?: string | null;
  strLeague?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strTimestamp?: string | null;
  strVenue?: string | null;
  strCountry?: string | null;
  strCity?: string | null;
  strDescriptionEN?: string | null;
  strPoster?: string | null;
  strSquare?: string | null;
  strFanart?: string | null;
  strThumb?: string | null;
  strBanner?: string | null;
};

type SportsApiV2EventSearchPayload = {
  results?: SportsApiV2EventSearch[] | null;
  search?: SportsApiV2EventSearch[] | null;
};

type SportsApiV2TeamSearch = {
  idTeam?: string | number | null;
  strAlternate?: string | null;
  strLeague?: string | null;
  strSport?: string | null;
  strTeam?: string | null;
  strTeamShort?: string | null;
};

type SportsApiV2TeamSearchPayload = {
  search?: SportsApiV2TeamSearch[] | null;
  teams?: SportsApiV2TeamSearch[] | null;
};

type SportsApiV2TeamScheduleEvent = {
  dateEvent?: string | null;
  idAwayTeam?: string | number | null;
  idEvent?: string | number | null;
  idHomeTeam?: string | number | null;
  strAwayTeam?: string | null;
  strEvent?: string | null;
  strEventThumb?: string | null;
  strHomeTeam?: string | null;
  strLeague?: string | null;
  strPoster?: string | null;
  strSport?: string | null;
  strThumb?: string | null;
};

type SportsApiV2TeamSchedulePayload = {
  schedule?: SportsApiV2TeamScheduleEvent[] | null;
};

type SportsApiV1TvShow = {
  idChannel?: string | null;
  idShow?: string | null;
  strCountry?: string | null;
  strNetwork?: string | null;
  strTvChannel?: string | null;
  strLogo?: string | null;
};

type SportsApiTvPayload = {
  filter?: SportsApiV1TvEvent[] | null;
  tvevent?: SportsApiV1TvEvent[] | null;
  tvevents?: SportsApiV1TvEvent[] | null;
  tvshows?: SportsApiV1TvShow[] | null;
};

export type SportDefinition = {
  sportId: string | null;
  sportName: string;
  channelSlug: string;
  imageUrl: string | null;
  iconUrl: string | null;
  description: string | null;
};

export type SportsBroadcast = {
  channelId: string | null;
  channelName: string;
  country: string | null;
  logoUrl: string | null;
};

export type SportsListing = {
  eventId: string;
  sportName: string;
  eventName: string;
  season: string | null;
  eventCountry: string | null;
  startTimeUtc: string;
  startTimeUkLabel: string;
  imageUrl: string | null;
  broadcasters: SportsBroadcast[];
};

export type SportsListingsBySport = {
  sportName: string;
  listings: SportsListing[];
};

export type SportsSearchResult = {
  eventId: string;
  eventName: string;
  sportName: string | null;
  leagueName: string | null;
  dateEvent: string | null;
  imageUrl: string | null;
};

export type SportsEventDetails = {
  eventId: string;
  eventName: string;
  sportName: string | null;
  leagueName: string | null;
  venueName: string | null;
  country: string | null;
  city: string | null;
  dateUkLabel: string | null;
  startTimeUkLabel: string | null;
  imageUrl: string | null;
  description: string | null;
  broadcasters: SportsBroadcast[];
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const UK_LOCALE = 'en-GB';
const SPORTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DAILY_LISTINGS_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 30 * 1000;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function toApiQueryValue(value: string): string {
  return normalizeWhitespace(value).replace(/\s+/gu, '_');
}

function toApiPathSegment(value: string): string {
  return encodeURIComponent(toApiQueryValue(value).toLowerCase());
}

function slugifySportName(value: string): string {
  return normalizeWhitespace(value)
    .normalize('NFKD')
    .replace(/[^\w\s-]/gu, '')
    .toLowerCase()
    .replace(/[\s_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 90);
}

function firstNonEmpty(
  ...values: Array<string | number | null | undefined>
): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function parseUtcDateTime(input: {
  timestamp?: string | null;
  date?: string | null;
  time?: string | null;
}): Date | null {
  const timestamp = input.timestamp?.trim();
  if (timestamp) {
    const normalized = timestamp.includes('T') ? timestamp : timestamp.replace(' ', 'T');
    const parsedWithOffset = new Date(normalized);
    if (!Number.isNaN(parsedWithOffset.getTime())) {
      return parsedWithOffset;
    }

    const parsedUtc = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
    return Number.isNaN(parsedUtc.getTime()) ? null : parsedUtc;
  }

  const date = input.date?.trim();
  const time = input.time?.trim();
  if (!date || !time) {
    return null;
  }

  const parsed = new Date(`${date}T${time}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatUkTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat(UK_LOCALE, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatUkDateLong(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat(UK_LOCALE, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function normalizeForSearch(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\bversus\b/gu, 'vs')
    .replace(/\bv\b/gu, 'vs')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeCountryName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function parseVersusQuery(query: string): { leftTeam: string; rightTeam: string } | null {
  const normalized = normalizeForSearch(query);
  const segments = normalized.split(/\svs\s/gu).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length !== 2) {
    return null;
  }

  return {
    leftTeam: segments[0] ?? '',
    rightTeam: segments[1] ?? '',
  };
}

function matchesCountry(input: {
  actual?: string | null;
  expected: string;
}): boolean {
  const actual = firstNonEmpty(input.actual);
  if (!actual) {
    return false;
  }

  return normalizeCountryName(actual) === normalizeCountryName(input.expected);
}

function extractTvEventRows(payload: SportsApiTvPayload): SportsApiV1TvEvent[] {
  return payload.filter ?? payload.tvevents ?? payload.tvevent ?? [];
}

function extractTvBroadcasts(payload: SportsApiTvPayload): SportsBroadcast[] {
  const eventBroadcasts = extractTvEventRows(payload)
    .map((row) => {
      const channelName = firstNonEmpty(row.strChannel);
      if (!channelName) {
        return null;
      }

      return {
        channelId: firstNonEmpty(row.idChannel),
        channelName,
        country: firstNonEmpty(row.strCountry),
        logoUrl: firstNonEmpty(row.strLogo),
      } satisfies SportsBroadcast;
    })
    .filter((row): row is SportsBroadcast => row !== null);

  const tvShowBroadcasts = (payload.tvshows ?? [])
    .map((row) => {
      const channelName = firstNonEmpty(row.strTvChannel, row.strNetwork);
      if (!channelName) {
        return null;
      }

      return {
        channelId: firstNonEmpty(row.idChannel, row.idShow),
        channelName,
        country: firstNonEmpty(row.strCountry),
        logoUrl: firstNonEmpty(row.strLogo),
      } satisfies SportsBroadcast;
    })
    .filter((row): row is SportsBroadcast => row !== null);

  const uniqueBroadcasts = new Map<string, SportsBroadcast>();
  for (const broadcaster of [...eventBroadcasts, ...tvShowBroadcasts]) {
    const key = broadcaster.channelId ?? broadcaster.channelName.toLowerCase();
    if (!uniqueBroadcasts.has(key)) {
      uniqueBroadcasts.set(key, broadcaster);
    }
  }

  return [...uniqueBroadcasts.values()];
}

function extractEventSearchRows(payload: SportsApiV2EventSearchPayload): SportsApiV2EventSearch[] {
  return payload.search ?? payload.results ?? [];
}

function extractTeamSearchRows(payload: SportsApiV2TeamSearchPayload): SportsApiV2TeamSearch[] {
  return payload.search ?? payload.teams ?? [];
}

function pickBestTeamSearchResult(
  query: string,
  results: SportsApiV2TeamSearch[],
): SportsApiV2TeamSearch | null {
  const normalizedQuery = normalizeForSearch(query);
  const scored = results.map((result) => {
    const exactNames = [
      firstNonEmpty(result.strTeam),
      firstNonEmpty(result.strTeamShort),
      firstNonEmpty(result.strAlternate),
    ]
      .filter((value): value is string => value !== null)
      .map((value) => normalizeForSearch(value));

    let score = 0;
    if (exactNames.includes(normalizedQuery)) {
      score += 100;
    }

    for (const name of exactNames) {
      if (name.includes(normalizedQuery) || normalizedQuery.includes(name)) {
        score += 30;
      }
    }

    return { result, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.result ?? null;
}

export function pickBestSportsSearchResult(
  query: string,
  results: SportsSearchResult[],
): SportsSearchResult | null {
  const normalizedQuery = normalizeForSearch(query);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);

  const scored = results.map((result) => {
    const eventValue = normalizeForSearch(result.eventName);
    let score = 0;

    if (eventValue === normalizedQuery) {
      score += 100;
    }
    if (eventValue.includes(normalizedQuery)) {
      score += 50;
    }

    for (const token of queryTokens) {
      score += eventValue.includes(token) ? 8 : -3;
    }

    if (result.dateEvent) {
      const date = Date.parse(`${result.dateEvent}T00:00:00Z`);
      if (!Number.isNaN(date) && date >= Date.now() - 24 * 60 * 60 * 1000) {
        score += 10;
      }
    }

    return { result, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.result ?? null;
}

export class SportsDataService {
  private readonly env = getEnv();
  private sportsCache: CacheEntry<SportDefinition[]> | null = null;
  private readonly dailyListingsCache = new Map<string, CacheEntry<SportsListingsBySport[]>>();
  private readonly searchCache = new Map<string, CacheEntry<SportsSearchResult[]>>();

  private getApiKey(): string {
    const apiKey = this.env.SPORTS_API_KEY.trim();
    if (!apiKey) {
      throw new AppError(
        'SPORTS_API_KEY_MISSING',
        'SPORTS_API_KEY is required for the sports worker. A paid TheSportsDB key is needed for full daily listings.',
        500,
      );
    }

    return apiKey;
  }

  private getV1BaseUrl(): string {
    return this.env.SPORTS_API_V1_BASE_URL.replace(/\/+$/u, '');
  }

  private getV2BaseUrl(): string {
    return this.env.SPORTS_API_BASE_URL.replace(/\/+$/u, '');
  }

  private async requestJson(input: {
    url: string;
    headers?: Record<string, string>;
  }): Promise<unknown> {
    return pRetry(
      async () => {
        const response = await fetch(input.url, {
          headers: input.headers,
        });

        if (response.status === 429) {
          throw new Error(`Sports API rate limited request to ${input.url}`);
        }

        if (!response.ok) {
          const bodyText = await response.text();
          if (response.status >= 500) {
            throw new Error(`Sports API request failed (${response.status}): ${bodyText}`);
          }

          throw new AbortError(`Sports API request failed (${response.status}): ${bodyText}`);
        }

        return response.json();
      },
      {
        retries: 3,
        minTimeout: 400,
        factor: 2,
      },
    );
  }

  private async requestV1<T>(input: {
    endpoint: string;
    params?: Record<string, string | null | undefined>;
  }): Promise<T> {
    const url = new URL(`${this.getV1BaseUrl()}/${this.getApiKey()}/${input.endpoint}`);
    for (const [key, value] of Object.entries(input.params ?? {})) {
      if (!value) {
        continue;
      }

      url.searchParams.set(key, toApiQueryValue(value));
    }

    return (await this.requestJson({ url: url.toString() })) as T;
  }

  private async requestV2<T>(input: {
    path: string;
  }): Promise<T> {
    return (await this.requestJson({
      url: `${this.getV2BaseUrl()}${input.path}`,
      headers: {
        'X-API-KEY': this.getApiKey(),
      },
    })) as T;
  }

  private mapSportsSearchResults(rows: SportsApiV2EventSearch[]): SportsSearchResult[] {
    return rows
      .map((result) => ({
        eventId: firstNonEmpty(result.idEvent) ?? '',
        eventName: firstNonEmpty(result.strEvent) ?? '',
        sportName: firstNonEmpty(result.strSport),
        leagueName: firstNonEmpty(result.strLeague),
        dateEvent: firstNonEmpty(result.dateEvent),
        imageUrl: firstNonEmpty(result.strThumb),
      }))
      .filter((result) => result.eventId.length > 0 && result.eventName.length > 0);
  }

  private mapTeamScheduleResults(rows: SportsApiV2TeamScheduleEvent[]): SportsSearchResult[] {
    return rows
      .map((row) => ({
        eventId: firstNonEmpty(row.idEvent) ?? '',
        eventName: firstNonEmpty(row.strEvent) ?? '',
        sportName: firstNonEmpty(row.strSport),
        leagueName: firstNonEmpty(row.strLeague),
        dateEvent: firstNonEmpty(row.dateEvent),
        imageUrl: firstNonEmpty(row.strThumb, row.strEventThumb, row.strPoster),
      }))
      .filter((result) => result.eventId.length > 0 && result.eventName.length > 0);
  }

  private async searchHeadToHeadEvents(query: string): Promise<SportsSearchResult[]> {
    const versusQuery = parseVersusQuery(query);
    if (!versusQuery) {
      return [];
    }

    const [leftPayload, rightPayload] = await Promise.all([
      this.requestV2<SportsApiV2TeamSearchPayload>({
        path: `/search/team/${toApiPathSegment(versusQuery.leftTeam)}`,
      }),
      this.requestV2<SportsApiV2TeamSearchPayload>({
        path: `/search/team/${toApiPathSegment(versusQuery.rightTeam)}`,
      }),
    ]);

    const leftTeam = pickBestTeamSearchResult(
      versusQuery.leftTeam,
      extractTeamSearchRows(leftPayload),
    );
    const rightTeam = pickBestTeamSearchResult(
      versusQuery.rightTeam,
      extractTeamSearchRows(rightPayload),
    );
    const leftTeamId = firstNonEmpty(leftTeam?.idTeam);
    const rightTeamId = firstNonEmpty(rightTeam?.idTeam);

    if (!leftTeam || !rightTeam || !leftTeamId) {
      return [];
    }

    const [nextSchedule, previousSchedule] = await Promise.all([
      this.requestV2<SportsApiV2TeamSchedulePayload>({
        path: `/schedule/next/team/${encodeURIComponent(leftTeamId)}`,
      }),
      this.requestV2<SportsApiV2TeamSchedulePayload>({
        path: `/schedule/previous/team/${encodeURIComponent(leftTeamId)}`,
      }),
    ]);

    const rightTeamNames = [
      firstNonEmpty(rightTeam.strTeam),
      firstNonEmpty(rightTeam.strTeamShort),
      firstNonEmpty(rightTeam.strAlternate),
    ]
      .filter((value): value is string => value !== null)
      .map((value) => normalizeForSearch(value));

    const matchingRows = [...(nextSchedule.schedule ?? []), ...(previousSchedule.schedule ?? [])].filter(
      (row) => {
        const homeTeamId = firstNonEmpty(row.idHomeTeam);
        const awayTeamId = firstNonEmpty(row.idAwayTeam);
        if (rightTeamId && (homeTeamId === rightTeamId || awayTeamId === rightTeamId)) {
          return true;
        }

        const homeTeam = firstNonEmpty(row.strHomeTeam);
        const awayTeam = firstNonEmpty(row.strAwayTeam);
        return [homeTeam, awayTeam]
          .filter((value): value is string => value !== null)
          .some((value) => rightTeamNames.includes(normalizeForSearch(value)));
      },
    );

    const uniqueResults = new Map<string, SportsSearchResult>();
    for (const result of this.mapTeamScheduleResults(matchingRows)) {
      if (!uniqueResults.has(result.eventId)) {
        uniqueResults.set(result.eventId, result);
      }
    }

    return [...uniqueResults.values()];
  }

  public async listSupportedSports(): Promise<Result<SportDefinition[], AppError>> {
    try {
      if (this.sportsCache && this.sportsCache.expiresAt > Date.now()) {
        return ok(this.sportsCache.value);
      }

      const payload = await this.requestV2<{ all?: SportsApiV2Sport[] }>({
        path: '/all/sports',
      });
      const sports = (payload.all ?? [])
        .map((sport) => ({
          sportId: sport.idSport ?? null,
          sportName: firstNonEmpty(sport.strSport) ?? '',
          channelSlug: slugifySportName(firstNonEmpty(sport.strSport) ?? ''),
          imageUrl: firstNonEmpty(sport.strSportThumb, sport.strSportThumbBW),
          iconUrl: firstNonEmpty(sport.strSportIconGreen),
          description: firstNonEmpty(sport.strSportDescription),
        }))
        .filter((sport) => sport.sportName.length > 0)
        .sort((left, right) => left.sportName.localeCompare(right.sportName, UK_LOCALE));

      this.sportsCache = {
        expiresAt: Date.now() + SPORTS_CACHE_TTL_MS,
        value: sports,
      };

      return ok(sports);
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  public async listDailyListingsForLocalDate(input: {
    localDate: string;
    timezone: string;
    broadcastCountry: string;
  }): Promise<Result<SportsListingsBySport[], AppError>> {
    const cacheKey = `${input.localDate}:${input.timezone}:${input.broadcastCountry}`;
    try {
      const cached = this.dailyListingsCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return ok(cached.value);
      }

      const previousDate = new Date(`${input.localDate}T00:00:00Z`);
      previousDate.setUTCDate(previousDate.getUTCDate() - 1);
      const previousDateValue = previousDate.toISOString().slice(0, 10);

      const [previousDay, currentDay] = await Promise.all([
        this.requestV2<SportsApiTvPayload>({
          path: `/filter/tv/day/${encodeURIComponent(previousDateValue)}`,
        }),
        this.requestV2<SportsApiTvPayload>({
          path: `/filter/tv/day/${encodeURIComponent(input.localDate)}`,
        }),
      ]);

      const eventGroups = new Map<string, SportsListing>();
      const addRows = (rows: SportsApiV1TvEvent[] | undefined): void => {
        for (const row of rows ?? []) {
          const eventId = firstNonEmpty(row.idEvent);
          const sportName = firstNonEmpty(row.strSport);
          const eventName = firstNonEmpty(row.strEvent);
          const eventDateTime = parseUtcDateTime({
            timestamp: row.strTimeStamp,
            date: row.dateEvent,
            time: row.strTime,
          });

          if (!eventId || !sportName || !eventName || !eventDateTime) {
            continue;
          }

          if (
            input.broadcastCountry.trim().length > 0 &&
            !matchesCountry({
              actual: row.strCountry,
              expected: input.broadcastCountry,
            })
          ) {
            continue;
          }

          const localDate = resolveLocalDate({
            timezone: input.timezone,
            at: eventDateTime,
          });
          if (localDate !== input.localDate) {
            continue;
          }

          const cacheId = `${eventId}:${sportName}`;
          const broadcaster =
            row.strChannel && row.strChannel.trim().length > 0
              ? {
                  channelId: firstNonEmpty(row.idChannel),
                  channelName: row.strChannel.trim(),
                  country: firstNonEmpty(row.strCountry),
                  logoUrl: firstNonEmpty(row.strLogo),
                }
              : null;

          const existing = eventGroups.get(cacheId);
          if (existing) {
            if (
              broadcaster &&
              !existing.broadcasters.some(
                (item) =>
                  item.channelId === broadcaster.channelId ||
                  item.channelName.toLowerCase() === broadcaster.channelName.toLowerCase(),
              )
            ) {
              existing.broadcasters.push(broadcaster);
            }
            continue;
          }

          eventGroups.set(cacheId, {
            eventId,
            sportName,
            eventName,
            season: firstNonEmpty(row.strSeason),
            eventCountry: firstNonEmpty(row.strEventCountry),
            startTimeUtc: eventDateTime.toISOString(),
            startTimeUkLabel: formatUkTime(eventDateTime, input.timezone),
            imageUrl: firstNonEmpty(
              row.strEventPoster,
              row.strEventSquare,
              row.strEventThumb,
              row.strEventBanner,
            ),
            broadcasters: broadcaster ? [broadcaster] : [],
          });
        }
      };

      addRows(extractTvEventRows(previousDay));
      addRows(extractTvEventRows(currentDay));

      const bySport = new Map<string, SportsListing[]>();
      for (const listing of eventGroups.values()) {
        const current = bySport.get(listing.sportName) ?? [];
        current.push({
          ...listing,
          broadcasters: [...listing.broadcasters].sort((left, right) =>
            left.channelName.localeCompare(right.channelName, UK_LOCALE),
          ),
        });
        bySport.set(listing.sportName, current);
      }

      const grouped = [...bySport.entries()]
        .map(([sportName, listings]) => ({
          sportName,
          listings: listings.sort((left, right) => left.startTimeUtc.localeCompare(right.startTimeUtc)),
        }))
        .sort((left, right) => left.sportName.localeCompare(right.sportName, UK_LOCALE));

      this.dailyListingsCache.set(cacheKey, {
        expiresAt: Date.now() + DAILY_LISTINGS_CACHE_TTL_MS,
        value: grouped,
      });

      return ok(grouped);
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  public async searchEvents(query: string): Promise<Result<SportsSearchResult[], AppError>> {
    const normalizedQuery = normalizeWhitespace(query);
    if (normalizedQuery.length < 2) {
      return ok([]);
    }

    const eventSearchQuery = normalizeForSearch(query);
    const cacheKey = normalizedQuery.toLowerCase();
    try {
      const cached = this.searchCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return ok(cached.value);
      }

      const payload = await this.requestV2<SportsApiV2EventSearchPayload>({
        path: `/search/event/${toApiPathSegment(eventSearchQuery)}`,
      });
      let results = this.mapSportsSearchResults(extractEventSearchRows(payload));
      if (results.length === 0) {
        results = await this.searchHeadToHeadEvents(normalizedQuery);
      }

      this.searchCache.set(cacheKey, {
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        value: results,
      });

      return ok(results);
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  public async getEventDetails(input: {
    eventId: string;
    timezone: string;
    broadcastCountry: string;
  }): Promise<Result<SportsEventDetails | null, AppError>> {
    try {
      const [eventPayload, tvPayload] = await Promise.all([
        this.requestV2<{ lookup?: SportsApiV2EventLookup[] }>({
          path: `/lookup/event/${encodeURIComponent(input.eventId)}`,
        }),
        this.requestV1<SportsApiTvPayload>({
          endpoint: 'lookuptv.php',
          params: {
            id: input.eventId,
          },
        }),
      ]);

      const event = eventPayload.lookup?.[0];
      if (!event) {
        return ok(null);
      }

      const eventDateTime = parseUtcDateTime({
        timestamp: event.strTimestamp,
        date: event.dateEvent,
        time: event.strTime,
      });
      const broadcasters = extractTvBroadcasts(tvPayload);

      const countryMatches = broadcasters.filter(
        (broadcaster) =>
          matchesCountry({
            actual: broadcaster.country,
            expected: input.broadcastCountry,
          }),
      );
      const visibleBroadcasters = (countryMatches.length > 0 ? countryMatches : broadcasters).sort((left, right) =>
        left.channelName.localeCompare(right.channelName, UK_LOCALE),
      );

      return ok({
        eventId: firstNonEmpty(event.idEvent) ?? input.eventId,
        eventName: firstNonEmpty(event.strEvent) ?? 'Unknown event',
        sportName: firstNonEmpty(event.strSport),
        leagueName: firstNonEmpty(event.strLeague),
        venueName: firstNonEmpty(event.strVenue),
        country: firstNonEmpty(event.strCountry),
        city: firstNonEmpty(event.strCity),
        dateUkLabel: eventDateTime ? formatUkDateLong(eventDateTime, input.timezone) : null,
        startTimeUkLabel: eventDateTime ? formatUkTime(eventDateTime, input.timezone) : null,
        imageUrl: firstNonEmpty(
          event.strPoster,
          event.strSquare,
          event.strThumb,
          event.strBanner,
          event.strFanart,
        ),
        description: firstNonEmpty(event.strDescriptionEN),
        broadcasters: visibleBroadcasters,
      });
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  private toSportsApiError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    return new AppError(
      'SPORTS_API_REQUEST_FAILED',
      'Sports data could not be loaded from TheSportsDB. Check the API key and try again.',
      502,
      {
        errorMessage: error instanceof Error ? error.message : 'unknown',
      },
    );
  }
}

import pRetry, { AbortError } from 'p-retry';
import { err, ok, type Result } from 'neverthrow';

import { getEnv } from '../config/env.js';
import { AppError } from '../domain/errors.js';
import { logger } from '../infra/logger.js';
import { normalizeBroadcastCountries } from './sports-broadcast-countries.js';
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
  strStatus?: string | null;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  intScore?: string | number | null;
  strVideo?: string | null;
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

type SportsApiV2LeagueSearch = {
  idLeague?: string | number | null;
  strLeague?: string | null;
  strSport?: string | null;
  strBadge?: string | null;
};

type SportsApiV2LeagueSearchPayload = {
  countries?: SportsApiV2LeagueSearch[] | null;
  leagues?: SportsApiV2LeagueSearch[] | null;
  search?: SportsApiV2LeagueSearch[] | null;
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

type SportsApiV2LiveScoreEvent = {
  idEvent?: string | number | null;
  strEvent?: string | null;
  strSport?: string | null;
  strLeague?: string | null;
  strStatus?: string | null;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  intScore?: string | number | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strTimestamp?: string | null;
  strThumb?: string | null;
  strPoster?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
};

type SportsApiV2LiveScorePayload = {
  events?: SportsApiV2LiveScoreEvent[] | null;
  livescore?: SportsApiV2LiveScoreEvent[] | null;
};

type SportsApiV2EventHighlightsRow = {
  idEvent?: string | number | null;
  strEvent?: string | null;
  strSport?: string | null;
  strVideo?: string | null;
  strThumb?: string | null;
  strPoster?: string | null;
  strFanart?: string | null;
};

type SportsApiV2EventHighlightsPayload = {
  highlights?: SportsApiV2EventHighlightsRow[] | null;
  lookup?: SportsApiV2EventHighlightsRow[] | null;
};

type SportsApiV1StandingsRow = {
  name?: string | null;
  teamid?: string | number | null;
  played?: string | number | null;
  goalsfor?: string | number | null;
  goalsagainst?: string | number | null;
  goalsdifference?: string | number | null;
  win?: string | number | null;
  draw?: string | number | null;
  loss?: string | number | null;
  total?: string | number | null;
  rank?: string | number | null;
};

type SportsApiV1StandingsPayload = {
  table?: SportsApiV1StandingsRow[] | null;
};

type SportsApiV2TeamLookup = {
  idTeam?: string | number | null;
  strTeam?: string | null;
  strTeamShort?: string | null;
  strLeague?: string | null;
  strSport?: string | null;
  strCountry?: string | null;
  strStadium?: string | null;
  strDescriptionEN?: string | null;
  strBadge?: string | null;
  strTeamBadge?: string | null;
  strTeamBanner?: string | null;
  strBanner?: string | null;
};

type SportsApiV2TeamLookupPayload = {
  lookup?: SportsApiV2TeamLookup[] | null;
  teams?: SportsApiV2TeamLookup[] | null;
};

type SportsApiV2Player = {
  idPlayer?: string | number | null;
  idTeam?: string | number | null;
  strPlayer?: string | null;
  strTeam?: string | null;
  strPosition?: string | null;
  dateBorn?: string | null;
  strThumb?: string | null;
  strCutout?: string | null;
  strDescriptionEN?: string | null;
};

type SportsApiV2PlayerPayload = {
  lookup?: SportsApiV2Player[] | null;
  player?: SportsApiV2Player[] | null;
  players?: SportsApiV2Player[] | null;
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

export type SportsLiveEvent = {
  eventId: string;
  eventName: string;
  sportName: string | null;
  leagueName: string | null;
  statusLabel: string;
  scoreLabel: string | null;
  startTimeUkLabel: string | null;
  imageUrl: string | null;
  broadcasters: SportsBroadcast[];
};

export type SportsEventHighlight = {
  eventId: string;
  eventName: string | null;
  sportName: string | null;
  videoUrl: string;
  imageUrl: string | null;
};

export type SportsStandingsRow = {
  rank: number | null;
  teamId: string | null;
  teamName: string;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDifference: number | null;
  points: number | null;
};

export type SportsStandings = {
  leagueId: string | null;
  leagueName: string;
  sportName: string | null;
  imageUrl: string | null;
  rows: SportsStandingsRow[];
};

export type SportsTeamPlayerSummary = {
  playerId: string;
  playerName: string;
  position: string | null;
  imageUrl: string | null;
};

export type SportsTeamDetails = {
  teamId: string;
  teamName: string;
  sportName: string | null;
  leagueName: string | null;
  country: string | null;
  stadiumName: string | null;
  description: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  players: SportsTeamPlayerSummary[];
};

export type SportsPlayerDetails = {
  playerId: string;
  playerName: string;
  teamName: string | null;
  position: string | null;
  dateBorn: string | null;
  description: string | null;
  imageUrl: string | null;
  cutoutUrl: string | null;
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

function formatLocalDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function extractLeagueSearchRows(payload: SportsApiV2LeagueSearchPayload): SportsApiV2LeagueSearch[] {
  return payload.search ?? payload.leagues ?? payload.countries ?? [];
}

function extractLiveScoreRows(payload: SportsApiV2LiveScorePayload): SportsApiV2LiveScoreEvent[] {
  return payload.events ?? payload.livescore ?? [];
}

function extractEventHighlightsRows(
  payload: SportsApiV2EventHighlightsPayload,
): SportsApiV2EventHighlightsRow[] {
  return payload.highlights ?? payload.lookup ?? [];
}

function extractTeamLookupRows(payload: SportsApiV2TeamLookupPayload): SportsApiV2TeamLookup[] {
  return payload.lookup ?? payload.teams ?? [];
}

function extractPlayerRows(payload: SportsApiV2PlayerPayload): SportsApiV2Player[] {
  return payload.lookup ?? payload.player ?? payload.players ?? [];
}

function toNumberValue(value: string | number | null | undefined): number | null {
  const normalized = firstNonEmpty(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toLoggableError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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

function pickBestLeagueSearchResult(
  query: string,
  results: SportsApiV2LeagueSearch[],
): SportsApiV2LeagueSearch | null {
  const normalizedQuery = normalizeForSearch(query);
  const scored = results.map((result) => {
    const leagueName = normalizeForSearch(firstNonEmpty(result.strLeague) ?? '');
    let score = 0;

    if (leagueName === normalizedQuery) {
      score += 100;
    }
    if (leagueName.includes(normalizedQuery) || normalizedQuery.includes(leagueName)) {
      score += 30;
    }

    return { result, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.result ?? null;
}

function pickBestPlayerResult(query: string, results: SportsApiV2Player[]): SportsApiV2Player | null {
  const normalizedQuery = normalizeForSearch(query);
  const scored = results.map((result) => {
    const playerName = normalizeForSearch(firstNonEmpty(result.strPlayer) ?? '');
    let score = 0;

    if (playerName === normalizedQuery) {
      score += 100;
    }
    if (playerName.includes(normalizedQuery) || normalizedQuery.includes(playerName)) {
      score += 30;
    }

    return { result, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.result ?? null;
}

function buildScoreLabel(input: {
  homeScore?: string | number | null;
  awayScore?: string | number | null;
  score?: string | number | null;
}): string | null {
  const homeScore = firstNonEmpty(input.homeScore);
  const awayScore = firstNonEmpty(input.awayScore);
  if (homeScore && awayScore) {
    return `${homeScore}-${awayScore}`;
  }

  return firstNonEmpty(input.score);
}

function sortSportsBroadcasts(left: SportsBroadcast, right: SportsBroadcast): number {
  const channelNameCompare = left.channelName.localeCompare(right.channelName, UK_LOCALE);
  if (channelNameCompare !== 0) {
    return channelNameCompare;
  }

  const countryCompare = (left.country ?? '').localeCompare(right.country ?? '', UK_LOCALE);
  if (countryCompare !== 0) {
    return countryCompare;
  }

  return (left.channelId ?? '').localeCompare(right.channelId ?? '', UK_LOCALE);
}

function buildSportsBroadcastKey(broadcaster: SportsBroadcast): string {
  return broadcaster.channelId ?? broadcaster.channelName.toLowerCase();
}

function mergeSportsBroadcast(
  left: SportsBroadcast,
  right: SportsBroadcast,
): SportsBroadcast {
  return {
    channelId: firstNonEmpty(left.channelId, right.channelId),
    channelName: firstNonEmpty(left.channelName, right.channelName) ?? left.channelName,
    country: firstNonEmpty(left.country, right.country),
    logoUrl: firstNonEmpty(left.logoUrl, right.logoUrl),
  };
}

function mergeSportsBroadcasts(broadcasters: readonly SportsBroadcast[]): SportsBroadcast[] {
  const merged = new Map<string, SportsBroadcast>();
  for (const broadcaster of broadcasters) {
    const key = buildSportsBroadcastKey(broadcaster);
    const existing = merged.get(key);
    merged.set(
      key,
      existing ? mergeSportsBroadcast(existing, broadcaster) : { ...broadcaster },
    );
  }

  return [...merged.values()].sort(sortSportsBroadcasts);
}

function buildSportsListingKey(listing: Pick<SportsListing, 'eventId' | 'sportName'>): string {
  return `${listing.eventId}:${listing.sportName.toLowerCase()}`;
}

function buildSportsListingFallbackKey(
  listing: Pick<SportsListing, 'sportName' | 'eventName' | 'startTimeUtc'>,
): string {
  return [
    normalizeForSearch(listing.sportName),
    normalizeForSearch(listing.eventName),
    listing.startTimeUtc.trim(),
  ].join('|');
}

function buildSportsLiveEventFallbackKey(
  event: Pick<SportsLiveEvent, 'sportName' | 'eventName' | 'startTimeUkLabel'>,
): string | null {
  const sportName = firstNonEmpty(event.sportName);
  const startTime = firstNonEmpty(event.startTimeUkLabel);
  if (!sportName || !startTime) {
    return null;
  }

  return [
    normalizeForSearch(sportName),
    normalizeForSearch(event.eventName),
    startTime,
  ].join('|');
}

function pickDeterministicPair<T>(
  left: T,
  right: T,
  compare: (leftValue: T, rightValue: T) => number,
): [T, T] {
  return compare(left, right) <= 0 ? [left, right] : [right, left];
}

function mergeSportsListing(
  left: SportsListing,
  right: SportsListing,
): SportsListing {
  const [primary, secondary] = pickDeterministicPair(
    left,
    right,
    (leftListing, rightListing) => {
      const startTimeCompare = leftListing.startTimeUtc.localeCompare(rightListing.startTimeUtc);
      if (startTimeCompare !== 0) {
        return startTimeCompare;
      }

      return buildSportsListingKey(leftListing).localeCompare(
        buildSportsListingKey(rightListing),
        UK_LOCALE,
      );
    },
  );

  return {
    eventId: primary.eventId,
    sportName: primary.sportName,
    eventName: firstNonEmpty(primary.eventName, secondary.eventName) ?? primary.eventName,
    season: firstNonEmpty(primary.season, secondary.season),
    eventCountry: firstNonEmpty(primary.eventCountry, secondary.eventCountry),
    startTimeUtc: primary.startTimeUtc,
    startTimeUkLabel: primary.startTimeUkLabel,
    imageUrl: firstNonEmpty(primary.imageUrl, secondary.imageUrl),
    broadcasters: mergeSportsBroadcasts([...primary.broadcasters, ...secondary.broadcasters]),
  };
}

function mergeSportsListingsBySport(
  listingsBySport: readonly SportsListingsBySport[][],
): SportsListingsBySport[] {
  const mergedListings = new Map<string, SportsListing>();
  const listingFallbackIndex = new Map<string, string>();

  for (const countryListings of listingsBySport) {
    for (const sportListings of countryListings) {
      for (const listing of sportListings.listings) {
        const exactKey = buildSportsListingKey(listing);
        const fallbackKey = buildSportsListingFallbackKey(listing);
        const canonicalKey = listingFallbackIndex.get(fallbackKey) ?? exactKey;
        const existing = mergedListings.get(canonicalKey) ?? mergedListings.get(exactKey);
        const mergedListing =
          existing
            ? mergeSportsListing(existing, listing)
            : {
                ...listing,
                broadcasters: mergeSportsBroadcasts(listing.broadcasters),
              };

        if (canonicalKey !== exactKey) {
          mergedListings.delete(exactKey);
        }

        mergedListings.set(canonicalKey, mergedListing);
        listingFallbackIndex.set(fallbackKey, canonicalKey);
        listingFallbackIndex.set(buildSportsListingFallbackKey(mergedListing), canonicalKey);
      }
    }
  }

  const grouped = new Map<string, SportsListing[]>();
  for (const listing of mergedListings.values()) {
    const current = grouped.get(listing.sportName) ?? [];
    current.push(listing);
    grouped.set(listing.sportName, current);
  }

  return [...grouped.entries()]
    .map(([sportName, listings]) => ({
      sportName,
      listings: listings.sort((leftListing, rightListing) =>
        leftListing.startTimeUtc.localeCompare(rightListing.startTimeUtc),
      ),
    }))
    .sort((leftSport, rightSport) =>
      leftSport.sportName.localeCompare(rightSport.sportName, UK_LOCALE),
    );
}

function mergeSportsLiveEvent(
  left: SportsLiveEvent,
  right: SportsLiveEvent,
): SportsLiveEvent {
  const [primary, secondary] = pickDeterministicPair(
    left,
    right,
    (leftEvent, rightEvent) => leftEvent.eventId.localeCompare(rightEvent.eventId, UK_LOCALE),
  );

  return {
    eventId: primary.eventId,
    eventName: firstNonEmpty(primary.eventName, secondary.eventName) ?? primary.eventName,
    sportName: firstNonEmpty(primary.sportName, secondary.sportName),
    leagueName: firstNonEmpty(primary.leagueName, secondary.leagueName),
    statusLabel: firstNonEmpty(primary.statusLabel, secondary.statusLabel) ?? primary.statusLabel,
    scoreLabel: firstNonEmpty(primary.scoreLabel, secondary.scoreLabel),
    startTimeUkLabel: firstNonEmpty(primary.startTimeUkLabel, secondary.startTimeUkLabel),
    imageUrl: firstNonEmpty(primary.imageUrl, secondary.imageUrl),
    broadcasters: mergeSportsBroadcasts([...primary.broadcasters, ...secondary.broadcasters]),
  };
}

function mergeSportsLiveEvents(eventsByCountry: readonly SportsLiveEvent[][]): SportsLiveEvent[] {
  const mergedEvents = new Map<string, SportsLiveEvent>();
  const liveEventFallbackIndex = new Map<string, string>();

  for (const countryEvents of eventsByCountry) {
    for (const event of countryEvents) {
      const fallbackKey = buildSportsLiveEventFallbackKey(event);
      const canonicalKey = fallbackKey ? (liveEventFallbackIndex.get(fallbackKey) ?? event.eventId) : event.eventId;
      const existing = mergedEvents.get(canonicalKey) ?? mergedEvents.get(event.eventId);
      const mergedEvent =
        existing
          ? mergeSportsLiveEvent(existing, event)
          : {
              ...event,
              broadcasters: mergeSportsBroadcasts(event.broadcasters),
            };

      if (canonicalKey !== event.eventId) {
        mergedEvents.delete(event.eventId);
      }

      mergedEvents.set(canonicalKey, mergedEvent);

      if (fallbackKey) {
        liveEventFallbackIndex.set(fallbackKey, canonicalKey);
      }

      const mergedFallbackKey = buildSportsLiveEventFallbackKey(mergedEvent);
      if (mergedFallbackKey) {
        liveEventFallbackIndex.set(mergedFallbackKey, canonicalKey);
      }
    }
  }

  return [...mergedEvents.values()].sort((left, right) =>
    left.eventName.localeCompare(right.eventName, UK_LOCALE),
  );
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

function isWithinSportsSearchWindow(input: {
  dateEvent: string | null;
  windowStartDate: string;
  windowEndDate: string;
}): boolean {
  if (!input.dateEvent || !/^\d{4}-\d{2}-\d{2}$/u.test(input.dateEvent)) {
    return false;
  }

  return input.dateEvent >= input.windowStartDate && input.dateEvent <= input.windowEndDate;
}

function sortSportsSearchResults(left: SportsSearchResult, right: SportsSearchResult): number {
  const leftDate = left.dateEvent ?? '9999-99-99';
  const rightDate = right.dateEvent ?? '9999-99-99';
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  return left.eventName.localeCompare(right.eventName, UK_LOCALE);
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

  private pickVisibleBroadcasters(input: {
    broadcasters: SportsBroadcast[];
    broadcastCountry: string;
  }): SportsBroadcast[] {
    const countryMatches = input.broadcasters.filter((broadcaster) =>
      matchesCountry({
        actual: broadcaster.country,
        expected: input.broadcastCountry,
      }),
    );

    return (countryMatches.length > 0 ? countryMatches : input.broadcasters).sort((left, right) =>
      left.channelName.localeCompare(right.channelName, UK_LOCALE),
    );
  }

  private async collectCountryResults<T>(input: {
    broadcastCountries: readonly string[];
    fetchCountry: (broadcastCountry: string) => Promise<Result<T, AppError>>;
    merge: (values: readonly T[]) => T;
  }): Promise<Result<T, AppError>> {
    const broadcastCountries = normalizeBroadcastCountries(input.broadcastCountries);
    const successful: T[] = [];
    let firstError: AppError | null = null;

    for (const broadcastCountry of broadcastCountries) {
      const result = await input.fetchCountry(broadcastCountry);
      if (result.isOk()) {
        successful.push(result.value);
        continue;
      }

      firstError ??= result.error;
    }

    if (successful.length === 0) {
      return err(
        firstError ??
          new AppError(
            'SPORTS_API_REQUEST_FAILED',
            'Sports data could not be loaded from TheSportsDB. Check the API key and try again.',
            502,
          ),
      );
    }

    return ok(input.merge(successful));
  }

  private async lookupTeam(query: string): Promise<SportsApiV2TeamSearch | null> {
    const teamPayload = await this.requestV2<SportsApiV2TeamSearchPayload>({
      path: `/search/team/${toApiPathSegment(query)}`,
    });

    return pickBestTeamSearchResult(query, extractTeamSearchRows(teamPayload));
  }

  private async lookupLeague(query: string): Promise<SportsApiV2LeagueSearch | null> {
    const leaguePayload = await this.requestV2<SportsApiV2LeagueSearchPayload>({
      path: `/search/league/${toApiPathSegment(query)}`,
    });

    return pickBestLeagueSearchResult(query, extractLeagueSearchRows(leaguePayload));
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

  private async searchSingleTeamScheduleEvents(query: string): Promise<SportsSearchResult[]> {
    if (parseVersusQuery(query)) {
      return [];
    }

    const teamPayload = await this.requestV2<SportsApiV2TeamSearchPayload>({
      path: `/search/team/${toApiPathSegment(query)}`,
    });
    const team = pickBestTeamSearchResult(query, extractTeamSearchRows(teamPayload));
    const teamId = firstNonEmpty(team?.idTeam);

    if (!team || !teamId) {
      return [];
    }

    const schedulePayload = await this.requestV2<SportsApiV2TeamSchedulePayload>({
      path: `/schedule/full/team/${encodeURIComponent(teamId)}`,
    });

    const uniqueResults = new Map<string, SportsSearchResult>();
    for (const result of this.mapTeamScheduleResults(schedulePayload.schedule ?? [])) {
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

  public async listDailyListingsForLocalDateAcrossCountries(input: {
    localDate: string;
    timezone: string;
    broadcastCountries: string[];
  }): Promise<Result<SportsListingsBySport[], AppError>> {
    return this.collectCountryResults({
      broadcastCountries: input.broadcastCountries,
      fetchCountry: async (broadcastCountry) =>
        this.listDailyListingsForLocalDate({
          localDate: input.localDate,
          timezone: input.timezone,
          broadcastCountry,
        }),
      merge: (values) => mergeSportsListingsBySport(values),
    });
  }

  public async searchEvents(query: string): Promise<Result<SportsSearchResult[], AppError>> {
    const normalizedQuery = normalizeWhitespace(query);
    if (normalizedQuery.length < 2) {
      return ok([]);
    }

    const eventSearchQuery = normalizeForSearch(query);
    const searchWindowStartDate = formatLocalDateKey(new Date(), this.env.SPORTS_DEFAULT_TIMEZONE);
    const searchWindowEndDate = addDaysToDateKey(searchWindowStartDate, 7);
    const cacheKey = `${normalizedQuery.toLowerCase()}:${searchWindowStartDate}:${searchWindowEndDate}`;
    try {
      const cached = this.searchCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return ok(cached.value);
      }

      const payload = await this.requestV2<SportsApiV2EventSearchPayload>({
        path: `/search/event/${toApiPathSegment(eventSearchQuery)}`,
      });

      const directResults = this.mapSportsSearchResults(extractEventSearchRows(payload));
      const combinedResults = new Map<string, SportsSearchResult>();
      for (const result of directResults) {
        if (
          isWithinSportsSearchWindow({
            dateEvent: result.dateEvent,
            windowStartDate: searchWindowStartDate,
            windowEndDate: searchWindowEndDate,
          })
        ) {
          combinedResults.set(result.eventId, result);
        }
      }

      if (parseVersusQuery(normalizedQuery)) {
        const headToHeadResults = await this.searchHeadToHeadEvents(normalizedQuery);
        for (const result of headToHeadResults) {
          if (
            !combinedResults.has(result.eventId) &&
            isWithinSportsSearchWindow({
              dateEvent: result.dateEvent,
              windowStartDate: searchWindowStartDate,
              windowEndDate: searchWindowEndDate,
            })
          ) {
            combinedResults.set(result.eventId, result);
          }
        }
      } else if (combinedResults.size === 0) {
        const teamScheduleResults = await this.searchSingleTeamScheduleEvents(normalizedQuery);
        for (const result of teamScheduleResults) {
          if (
            !combinedResults.has(result.eventId) &&
            isWithinSportsSearchWindow({
              dateEvent: result.dateEvent,
              windowStartDate: searchWindowStartDate,
              windowEndDate: searchWindowEndDate,
            })
          ) {
            combinedResults.set(result.eventId, result);
          }
        }
      }

      const results = [...combinedResults.values()].sort(sortSportsSearchResults);

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
      const visibleBroadcasters = this.pickVisibleBroadcasters({
        broadcasters: extractTvBroadcasts(tvPayload),
        broadcastCountry: input.broadcastCountry,
      });

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

  public async listLiveEvents(input: {
    timezone: string;
    broadcastCountry: string;
  }): Promise<Result<SportsLiveEvent[], AppError>> {
    try {
      const payload = await this.requestV2<SportsApiV2LiveScorePayload>({
        path: '/livescore/all',
      });

      const events = extractLiveScoreRows(payload);
      const results = await Promise.all(
        events.map(async (event) => {
          const eventId = firstNonEmpty(event.idEvent);
          const eventName = firstNonEmpty(
            event.strEvent,
            firstNonEmpty(event.strHomeTeam) && firstNonEmpty(event.strAwayTeam)
              ? `${firstNonEmpty(event.strHomeTeam)} vs ${firstNonEmpty(event.strAwayTeam)}`
              : null,
          );
          if (!eventId || !eventName) {
            return null;
          }

          let broadcasters: SportsBroadcast[] = [];
          try {
            const tvPayload = await this.requestV1<SportsApiTvPayload>({
              endpoint: 'lookuptv.php',
              params: {
                id: eventId,
              },
            });
            broadcasters = this.pickVisibleBroadcasters({
              broadcasters: extractTvBroadcasts(tvPayload),
              broadcastCountry: input.broadcastCountry,
            });
          } catch (error) {
            logger.warn(
              {
                eventId,
                err: toLoggableError(error),
              },
              'sports live event TV enrichment failed',
            );
            broadcasters = [];
          }

          const eventDateTime = parseUtcDateTime({
            timestamp: event.strTimestamp,
            date: event.dateEvent,
            time: event.strTime,
          });

          return {
            eventId,
            eventName,
            sportName: firstNonEmpty(event.strSport),
            leagueName: firstNonEmpty(event.strLeague),
            statusLabel: firstNonEmpty(event.strStatus) ?? 'Live',
            scoreLabel: buildScoreLabel({
              homeScore: event.intHomeScore,
              awayScore: event.intAwayScore,
              score: event.intScore,
            }),
            startTimeUkLabel: eventDateTime ? formatUkTime(eventDateTime, input.timezone) : null,
            imageUrl: firstNonEmpty(event.strThumb, event.strPoster),
            broadcasters,
          } satisfies SportsLiveEvent;
        }),
      );

      return ok(
        results
          .filter((event): event is SportsLiveEvent => event !== null)
          .sort((left, right) => left.eventName.localeCompare(right.eventName, UK_LOCALE)),
      );
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  public async listLiveEventsAcrossCountries(input: {
    timezone: string;
    broadcastCountries: string[];
  }): Promise<Result<SportsLiveEvent[], AppError>> {
    return this.collectCountryResults({
      broadcastCountries: input.broadcastCountries,
      fetchCountry: async (broadcastCountry) =>
        this.listLiveEvents({
          timezone: input.timezone,
          broadcastCountry,
        }),
      merge: (values) => mergeSportsLiveEvents(values),
    });
  }

  public async getEventHighlights(input: {
    eventId: string;
  }): Promise<Result<SportsEventHighlight | null, AppError>> {
    try {
      let highlight: SportsApiV2EventHighlightsRow | null = null;
      try {
        const highlightsPayload = await this.requestV2<SportsApiV2EventHighlightsPayload>({
          path: `/lookup/event_highlights/${encodeURIComponent(input.eventId)}`,
        });
        highlight = extractEventHighlightsRows(highlightsPayload)[0] ?? null;
      } catch {
        highlight = null;
      }

      const highlightVideoUrl = firstNonEmpty(highlight?.strVideo);

      if (highlight && highlightVideoUrl) {
        return ok({
          eventId: firstNonEmpty(highlight.idEvent) ?? input.eventId,
          eventName: firstNonEmpty(highlight.strEvent),
          sportName: firstNonEmpty(highlight.strSport),
          videoUrl: highlightVideoUrl,
          imageUrl: firstNonEmpty(highlight.strThumb, highlight.strPoster, highlight.strFanart),
        });
      }

      const eventPayload = await this.requestV2<{ lookup?: SportsApiV2EventLookup[] | null }>({
        path: `/lookup/event/${encodeURIComponent(input.eventId)}`,
      });
      const event = eventPayload.lookup?.[0];
      const eventVideoUrl = firstNonEmpty(event?.strVideo);
      if (!event || !eventVideoUrl) {
        return ok(null);
      }

      return ok({
        eventId: firstNonEmpty(event.idEvent) ?? input.eventId,
        eventName: firstNonEmpty(event.strEvent),
        sportName: firstNonEmpty(event.strSport),
        videoUrl: eventVideoUrl,
        imageUrl: firstNonEmpty(
          event.strThumb,
          event.strPoster,
          event.strFanart,
          event.strBanner,
          highlight?.strThumb,
          highlight?.strPoster,
          highlight?.strFanart,
        ),
      });
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  public async getStandings(input: {
    league: string;
  }): Promise<Result<SportsStandings | null, AppError>> {
    try {
      const league = await this.lookupLeague(input.league);
      const leagueId = firstNonEmpty(league?.idLeague);
      if (!league || !leagueId) {
        return ok(null);
      }

      const payload = await this.requestV1<SportsApiV1StandingsPayload>({
        endpoint: 'lookuptable.php',
        params: {
          l: leagueId,
        },
      });

      return ok({
        leagueId,
        leagueName: firstNonEmpty(league.strLeague) ?? input.league,
        sportName: firstNonEmpty(league.strSport),
        imageUrl: firstNonEmpty(league.strBadge),
        rows: (payload.table ?? [])
          .map((row) => {
            const teamName = firstNonEmpty(row.name);
            if (!teamName) {
              return null;
            }

            return {
              rank: toNumberValue(row.rank),
              teamId: firstNonEmpty(row.teamid),
              teamName,
              played: toNumberValue(row.played),
              wins: toNumberValue(row.win),
              draws: toNumberValue(row.draw),
              losses: toNumberValue(row.loss),
              goalsFor: toNumberValue(row.goalsfor),
              goalsAgainst: toNumberValue(row.goalsagainst),
              goalDifference: toNumberValue(row.goalsdifference),
              points: toNumberValue(row.total),
            } satisfies SportsStandingsRow;
          })
          .filter((row): row is SportsStandingsRow => row !== null),
      });
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  public async getFixtures(input: {
    query: string;
  }): Promise<Result<SportsSearchResult[], AppError>> {
    try {
      const team = await this.lookupTeam(input.query);
      const teamId = firstNonEmpty(team?.idTeam);
      if (teamId) {
        const payload = await this.requestV2<SportsApiV2TeamSchedulePayload>({
          path: `/schedule/next/team/${encodeURIComponent(teamId)}`,
        });
        return ok(this.mapTeamScheduleResults(payload.schedule ?? []));
      }

      const league = await this.lookupLeague(input.query);
      const leagueId = firstNonEmpty(league?.idLeague);
      if (!leagueId) {
        return ok([]);
      }

      const payload = await this.requestV2<SportsApiV2TeamSchedulePayload>({
        path: `/schedule/next/league/${encodeURIComponent(leagueId)}`,
      });
      return ok(this.mapTeamScheduleResults(payload.schedule ?? []));
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  public async getResults(input: {
    query: string;
  }): Promise<Result<SportsSearchResult[], AppError>> {
    try {
      const team = await this.lookupTeam(input.query);
      const teamId = firstNonEmpty(team?.idTeam);
      if (teamId) {
        const payload = await this.requestV2<SportsApiV2TeamSchedulePayload>({
          path: `/schedule/previous/team/${encodeURIComponent(teamId)}`,
        });
        return ok(this.mapTeamScheduleResults(payload.schedule ?? []));
      }

      const league = await this.lookupLeague(input.query);
      const leagueId = firstNonEmpty(league?.idLeague);
      if (!leagueId) {
        return ok([]);
      }

      const payload = await this.requestV2<SportsApiV2TeamSchedulePayload>({
        path: `/schedule/previous/league/${encodeURIComponent(leagueId)}`,
      });
      return ok(this.mapTeamScheduleResults(payload.schedule ?? []));
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  public async getTeamDetails(input: {
    query: string;
  }): Promise<Result<SportsTeamDetails | null, AppError>> {
    try {
      const team = await this.lookupTeam(input.query);
      const teamId = firstNonEmpty(team?.idTeam);
      if (!team || !teamId) {
        return ok(null);
      }

      const [teamPayload, playersPayload] = await Promise.all([
        this.requestV2<SportsApiV2TeamLookupPayload>({
          path: `/lookup/team/${encodeURIComponent(teamId)}`,
        }),
        this.requestV2<SportsApiV2PlayerPayload>({
          path: `/list/players/${encodeURIComponent(teamId)}`,
        }),
      ]);

      const teamDetails = extractTeamLookupRows(teamPayload)[0];
      if (!teamDetails) {
        return ok(null);
      }

      return ok({
        teamId: firstNonEmpty(teamDetails.idTeam) ?? teamId,
        teamName: firstNonEmpty(teamDetails.strTeam) ?? firstNonEmpty(team.strTeam) ?? input.query,
        sportName: firstNonEmpty(teamDetails.strSport, team.strSport),
        leagueName: firstNonEmpty(teamDetails.strLeague, team.strLeague),
        country: firstNonEmpty(teamDetails.strCountry),
        stadiumName: firstNonEmpty(teamDetails.strStadium),
        description: firstNonEmpty(teamDetails.strDescriptionEN),
        imageUrl: firstNonEmpty(teamDetails.strBadge, teamDetails.strTeamBadge),
        bannerUrl: firstNonEmpty(teamDetails.strTeamBanner, teamDetails.strBanner),
        players: extractPlayerRows(playersPayload)
          .map((player) => {
            const playerId = firstNonEmpty(player.idPlayer);
            const playerName = firstNonEmpty(player.strPlayer);
            if (!playerId || !playerName) {
              return null;
            }

            return {
              playerId,
              playerName,
              position: firstNonEmpty(player.strPosition),
              imageUrl: firstNonEmpty(player.strThumb, player.strCutout),
            } satisfies SportsTeamPlayerSummary;
          })
          .filter((player): player is SportsTeamPlayerSummary => player !== null),
      });
    } catch (error) {
      return err(this.toSportsApiError(error));
    }
  }

  public async getPlayerDetails(input: {
    query: string;
  }): Promise<Result<SportsPlayerDetails | null, AppError>> {
    try {
      const searchPayload = await this.requestV2<SportsApiV2PlayerPayload>({
        path: `/search/player/${toApiPathSegment(input.query)}`,
      });
      const player = pickBestPlayerResult(input.query, extractPlayerRows(searchPayload));
      const playerId = firstNonEmpty(player?.idPlayer);
      if (!player || !playerId) {
        return ok(null);
      }

      const lookupPayload = await this.requestV2<SportsApiV2PlayerPayload>({
        path: `/lookup/player/${encodeURIComponent(playerId)}`,
      });
      const details = extractPlayerRows(lookupPayload)[0] ?? player;

      return ok({
        playerId: firstNonEmpty(details.idPlayer) ?? playerId,
        playerName: firstNonEmpty(details.strPlayer) ?? input.query,
        teamName: firstNonEmpty(details.strTeam),
        position: firstNonEmpty(details.strPosition),
        dateBorn: firstNonEmpty(details.dateBorn),
        description: firstNonEmpty(details.strDescriptionEN),
        imageUrl: firstNonEmpty(details.strThumb),
        cutoutUrl: firstNonEmpty(details.strCutout),
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

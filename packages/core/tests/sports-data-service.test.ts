import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pickBestSportsSearchResult,
  SportsDataService,
  type SportsSearchResult,
} from '../src/services/sports-data-service.js';
import { resetEnvForTests } from '../src/config/env.js';

const ORIGINAL_SPORTS_API_KEY = process.env.SPORTS_API_KEY;
const ORIGINAL_SPORTS_API_BASE_URL = process.env.SPORTS_API_BASE_URL;
const ORIGINAL_SPORTS_API_V1_BASE_URL = process.env.SPORTS_API_V1_BASE_URL;

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('pickBestSportsSearchResult', () => {
  afterEach(() => {
    resetEnvForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();

    if (ORIGINAL_SPORTS_API_KEY == null) {
      delete process.env.SPORTS_API_KEY;
    } else {
      process.env.SPORTS_API_KEY = ORIGINAL_SPORTS_API_KEY;
    }

    if (ORIGINAL_SPORTS_API_BASE_URL == null) {
      delete process.env.SPORTS_API_BASE_URL;
    } else {
      process.env.SPORTS_API_BASE_URL = ORIGINAL_SPORTS_API_BASE_URL;
    }

    if (ORIGINAL_SPORTS_API_V1_BASE_URL == null) {
      delete process.env.SPORTS_API_V1_BASE_URL;
    } else {
      process.env.SPORTS_API_V1_BASE_URL = ORIGINAL_SPORTS_API_V1_BASE_URL;
    }
  });

  it('prefers the closest event name match', () => {
    const results: SportsSearchResult[] = [
      {
        eventId: '2',
        eventName: 'Celtic vs Rangers Legends',
        sportName: 'Soccer',
        leagueName: 'Legends',
        dateEvent: '2026-03-22',
        imageUrl: null,
      },
      {
        eventId: '1',
        eventName: 'Rangers vs Celtic',
        sportName: 'Soccer',
        leagueName: 'Scottish Premiership',
        dateEvent: '2026-03-21',
        imageUrl: null,
      },
    ];

    const best = pickBestSportsSearchResult('rangers v celtic', results);

    expect(best?.eventId).toBe('1');
  });

  it('builds daily listings from the v2 TV day feed and filters by broadcast country', async () => {
    process.env.SPORTS_API_KEY = 'premium-key';
    process.env.SPORTS_API_BASE_URL = 'https://example.com/api/v2/json';
    process.env.SPORTS_API_V1_BASE_URL = 'https://example.com/api/v1/json';
    resetEnvForTests();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          filter: [],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          filter: [
            {
              idEvent: 'evt-1',
              strSport: 'Soccer',
              strEvent: 'Rangers vs Celtic',
              strEventThumb: 'https://img.test/event-thumb.jpg',
              idChannel: 'chan-1',
              strCountry: 'United Kingdom',
              strChannel: 'Sky Sports Main Event',
              strSeason: '2025-2026',
              dateEvent: '2026-03-20',
              strTime: '15:00:00',
              strTimeStamp: '2026-03-20T15:00:00+00:00',
              strEventCountry: 'Scotland',
              strLogo: 'https://img.test/sky-logo.png',
            },
            {
              idEvent: 'evt-1',
              strSport: 'Soccer',
              strEvent: 'Rangers vs Celtic',
              strEventThumb: 'https://img.test/event-thumb.jpg',
              idChannel: 'chan-2',
              strCountry: 'United Kingdom',
              strChannel: 'TNT Sports 1',
              strSeason: '2025-2026',
              dateEvent: '2026-03-20',
              strTime: '15:00:00',
              strTimeStamp: '2026-03-20T15:00:00+00:00',
              strEventCountry: 'Scotland',
              strLogo: 'https://img.test/tnt-logo.png',
            },
            {
              idEvent: 'evt-2',
              strSport: 'Soccer',
              strEvent: 'Other Fixture',
              idChannel: 'chan-3',
              strCountry: 'United States',
              strChannel: 'ESPN',
              dateEvent: '2026-03-20',
              strTime: '18:00:00',
              strTimeStamp: '2026-03-20T18:00:00+00:00',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new SportsDataService();
    const result = await service.listDailyListingsForLocalDate({
      localDate: '2026-03-20',
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/api/v2/json/filter/tv/day/2026-03-19');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://example.com/api/v2/json/filter/tv/day/2026-03-20');

    expect(result.value).toEqual([
      {
        sportName: 'Soccer',
        listings: [
          {
            eventId: 'evt-1',
            sportName: 'Soccer',
            eventName: 'Rangers vs Celtic',
            season: '2025-2026',
            eventCountry: 'Scotland',
            startTimeUtc: '2026-03-20T15:00:00.000Z',
            startTimeUkLabel: '15:00',
            imageUrl: 'https://img.test/event-thumb.jpg',
            broadcasters: [
              {
                channelId: 'chan-1',
                channelName: 'Sky Sports Main Event',
                country: 'United Kingdom',
                logoUrl: 'https://img.test/sky-logo.png',
              },
              {
                channelId: 'chan-2',
                channelName: 'TNT Sports 1',
                country: 'United Kingdom',
                logoUrl: 'https://img.test/tnt-logo.png',
              },
            ],
          },
        ],
      },
    ]);
  });

  it('reads event broadcasters from tvevent lookup responses', async () => {
    process.env.SPORTS_API_KEY = 'premium-key';
    process.env.SPORTS_API_BASE_URL = 'https://example.com/api/v2/json';
    process.env.SPORTS_API_V1_BASE_URL = 'https://example.com/api/v1/json';
    resetEnvForTests();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          lookup: [
            {
              idEvent: 'evt-1',
              strEvent: 'Rangers vs Celtic',
              strSport: 'Soccer',
              strLeague: 'Scottish Premiership',
              dateEvent: '2026-03-20',
              strTime: '15:00:00',
              strTimestamp: '2026-03-20T15:00:00+00:00',
              strVenue: 'Ibrox Stadium',
              strCountry: 'Scotland',
              strCity: 'Glasgow',
              strThumb: 'https://img.test/event-thumb.jpg',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          tvevent: [
            {
              idChannel: 'chan-1',
              strCountry: 'United Kingdom',
              strChannel: 'Sky Sports Main Event',
              strLogo: 'https://img.test/sky-logo.png',
            },
            {
              idChannel: 'chan-2',
              strCountry: 'United States',
              strChannel: 'ESPN',
              strLogo: 'https://img.test/espn-logo.png',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new SportsDataService();
    const result = await service.getEventDetails({
      eventId: 'evt-1',
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      sportName: 'Soccer',
      leagueName: 'Scottish Premiership',
      venueName: 'Ibrox Stadium',
      broadcasters: [
        {
          channelId: 'chan-1',
          channelName: 'Sky Sports Main Event',
          country: 'United Kingdom',
          logoUrl: 'https://img.test/sky-logo.png',
        },
      ],
    });
  });

  it('filters direct event search results to today through the next 7 days', async () => {
    process.env.SPORTS_API_KEY = 'premium-key';
    process.env.SPORTS_API_BASE_URL = 'https://example.com/api/v2/json';
    process.env.SPORTS_API_V1_BASE_URL = 'https://example.com/api/v1/json';
    resetEnvForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:00:00Z'));

    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse({
        search: [
          {
            idEvent: 511661,
            strEvent: 'Dundee FC vs Rangers',
            strLeague: 'Scottish Premier League',
            dateEvent: '2026-03-24',
            strThumb: null,
            strSport: 'Soccer',
          },
          {
            idEvent: 511662,
            strEvent: 'Rangers vs Hearts',
            strLeague: 'Scottish Premier League',
            dateEvent: '2026-03-30',
            strThumb: 'https://img.test/rangers-hearts.jpg',
            strSport: 'Soccer',
          },
          {
            idEvent: 511663,
            strEvent: 'Rangers Legends',
            strLeague: 'Legends League',
            dateEvent: '2016-08-13',
            strThumb: null,
            strSport: 'Soccer',
          },
          {
            idEvent: 511664,
            strEvent: 'Rangers vs Aberdeen',
            strLeague: 'Scottish Premier League',
            dateEvent: '2026-03-31',
            strThumb: null,
            strSport: 'Soccer',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new SportsDataService();
    const result = await service.searchEvents('rangers');

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual([
      {
        eventId: '511661',
        eventName: 'Dundee FC vs Rangers',
        sportName: 'Soccer',
        leagueName: 'Scottish Premier League',
        dateEvent: '2026-03-24',
        imageUrl: null,
      },
      {
        eventId: '511662',
        eventName: 'Rangers vs Hearts',
        sportName: 'Soccer',
        leagueName: 'Scottish Premier League',
        dateEvent: '2026-03-30',
        imageUrl: 'https://img.test/rangers-hearts.jpg',
      },
    ]);
  });

  it('falls back to team schedules for head-to-head search queries', async () => {
    process.env.SPORTS_API_KEY = 'premium-key';
    process.env.SPORTS_API_BASE_URL = 'https://example.com/api/v2/json';
    process.env.SPORTS_API_V1_BASE_URL = 'https://example.com/api/v1/json';
    resetEnvForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T10:00:00Z'));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          Message: 'No data found',
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          search: [
            {
              idTeam: 133642,
              strTeam: 'Rangers',
              strSport: 'Soccer',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          search: [
            {
              idTeam: 133647,
              strTeam: 'Celtic',
              strSport: 'Soccer',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          schedule: [
            {
              idEvent: 2270800,
              strEvent: 'Rangers vs Celtic',
              idHomeTeam: 133642,
              idAwayTeam: 133647,
              strLeague: 'Scottish Premier League',
              strSport: 'Soccer',
              dateEvent: '2026-03-24',
              strThumb: 'https://img.test/rangers-celtic.jpg',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          schedule: [
            {
              idEvent: 2270700,
              strEvent: 'St Mirren vs Rangers',
              idHomeTeam: 133649,
              idAwayTeam: 133642,
              strLeague: 'Scottish Premier League',
              strSport: 'Soccer',
              dateEvent: '2026-03-19',
              strThumb: 'https://img.test/stmirren-rangers.jpg',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new SportsDataService();
    const result = await service.searchEvents('Rangers v Celtic');

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/api/v2/json/search/event/rangers_vs_celtic');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://example.com/api/v2/json/search/team/rangers');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://example.com/api/v2/json/search/team/celtic');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('https://example.com/api/v2/json/schedule/next/team/133642');
    expect(fetchMock.mock.calls[4]?.[0]).toBe('https://example.com/api/v2/json/schedule/previous/team/133642');

    expect(result.value).toEqual([
      {
        eventId: '2270800',
        eventName: 'Rangers vs Celtic',
        sportName: 'Soccer',
        leagueName: 'Scottish Premier League',
        dateEvent: '2026-03-24',
        imageUrl: 'https://img.test/rangers-celtic.jpg',
      },
    ]);
  });
});

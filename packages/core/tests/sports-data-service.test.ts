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

  it('falls back to a single team schedule for team-name searches with no direct event hits', async () => {
    process.env.SPORTS_API_KEY = 'premium-key';
    process.env.SPORTS_API_BASE_URL = 'https://example.com/api/v2/json';
    process.env.SPORTS_API_V1_BASE_URL = 'https://example.com/api/v1/json';
    resetEnvForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:00:00Z'));

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
              idTeam: 134830,
              strTeam: 'New York Rangers',
              strTeamShort: 'NY Rangers',
              strSport: 'Ice Hockey',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          schedule: [
            {
              idEvent: 900001,
              strEvent: 'New York Rangers vs New Jersey Devils',
              strLeague: 'NHL',
              strSport: 'Ice Hockey',
              dateEvent: '2026-03-23',
              strThumb: 'https://img.test/rangers-devils.jpg',
            },
            {
              idEvent: 900002,
              strEvent: 'Pittsburgh Penguins vs New York Rangers',
              strLeague: 'NHL',
              strSport: 'Ice Hockey',
              dateEvent: '2026-03-27',
              strThumb: 'https://img.test/pens-rangers.jpg',
            },
            {
              idEvent: 900003,
              strEvent: 'Boston Bruins vs New York Rangers',
              strLeague: 'NHL',
              strSport: 'Ice Hockey',
              dateEvent: '2026-03-31',
              strThumb: 'https://img.test/bruins-rangers.jpg',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new SportsDataService();
    const result = await service.searchEvents('New York Rangers');

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/api/v2/json/search/event/new_york_rangers');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://example.com/api/v2/json/search/team/new_york_rangers');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://example.com/api/v2/json/schedule/full/team/134830');

    expect(result.value).toEqual([
      {
        eventId: '900001',
        eventName: 'New York Rangers vs New Jersey Devils',
        sportName: 'Ice Hockey',
        leagueName: 'NHL',
        dateEvent: '2026-03-23',
        imageUrl: 'https://img.test/rangers-devils.jpg',
      },
      {
        eventId: '900002',
        eventName: 'Pittsburgh Penguins vs New York Rangers',
        sportName: 'Ice Hockey',
        leagueName: 'NHL',
        dateEvent: '2026-03-27',
        imageUrl: 'https://img.test/pens-rangers.jpg',
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

  it('maps live scores into live event summaries', async () => {
    process.env.SPORTS_API_KEY = 'premium-key';
    process.env.SPORTS_API_BASE_URL = 'https://example.com/api/v2/json';
    process.env.SPORTS_API_V1_BASE_URL = 'https://example.com/api/v1/json';
    resetEnvForTests();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          events: [
            {
              idEvent: 'evt-1',
              strEvent: 'Rangers vs Celtic',
              strSport: 'Soccer',
              strLeague: 'Scottish Premiership',
              strStatus: 'Live',
              intHomeScore: '2',
              intAwayScore: '1',
              strHomeTeam: 'Rangers',
              strAwayTeam: 'Celtic',
              dateEvent: '2026-03-20',
              strTime: '15:00:00',
              strTimestamp: '2026-03-20T15:00:00+00:00',
              strThumb: 'https://img.test/live-event.jpg',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          tvshows: [
            {
              idChannel: 'chan-1',
              strTvChannel: 'Sky Sports Main Event',
              strCountry: 'United Kingdom',
              strLogo: 'https://img.test/sky-logo.png',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new SportsDataService();
    const result = await service.listLiveEvents({
      timezone: 'Europe/London',
      broadcastCountry: 'United Kingdom',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/api/v2/json/livescore/all');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://example.com/api/v1/json/premium-key/lookuptv.php?id=evt-1');

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value[0]).toMatchObject({
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      sportName: 'Soccer',
      leagueName: 'Scottish Premiership',
      statusLabel: 'Live',
      scoreLabel: '2-1',
      startTimeUkLabel: '15:00',
      imageUrl: 'https://img.test/live-event.jpg',
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

  it('returns highlight links for a finished event', async () => {
    process.env.SPORTS_API_KEY = 'premium-key';
    process.env.SPORTS_API_BASE_URL = 'https://example.com/api/v2/json';
    process.env.SPORTS_API_V1_BASE_URL = 'https://example.com/api/v1/json';
    resetEnvForTests();

    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse({
        highlights: [
          {
            idEvent: 'evt-1',
            strSport: 'Soccer',
            strEvent: 'Rangers vs Celtic',
            strVideo: 'https://youtube.com/watch?v=highlights',
            strFanart: 'https://img.test/highlights.jpg',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new SportsDataService();
    const result = await service.getEventHighlights({ eventId: 'evt-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/v2/json/lookup/event_highlights/evt-1',
      expect.objectContaining({
        headers: {
          'X-API-KEY': 'premium-key',
        },
      }),
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      eventId: 'evt-1',
      eventName: 'Rangers vs Celtic',
      sportName: 'Soccer',
      videoUrl: 'https://youtube.com/watch?v=highlights',
      imageUrl: 'https://img.test/highlights.jpg',
    });
  });

  it('returns standings, fixtures, results, team, and player lookup payloads', async () => {
    process.env.SPORTS_API_KEY = 'premium-key';
    process.env.SPORTS_API_BASE_URL = 'https://example.com/api/v2/json';
    process.env.SPORTS_API_V1_BASE_URL = 'https://example.com/api/v1/json';
    resetEnvForTests();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          search: [
            {
              idLeague: '4328',
              strLeague: 'Scottish Premiership',
              strSport: 'Soccer',
              strBadge: 'https://img.test/league-badge.png',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          table: [
            {
              name: 'Rangers',
              teamid: '133642',
              played: '30',
              goalsfor: '65',
              goalsagainst: '22',
              goalsdifference: '43',
              win: '21',
              draw: '5',
              loss: '4',
              total: '68',
              rank: '1',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          search: [
            {
              idTeam: '133642',
              strTeam: 'Rangers',
              strTeamShort: 'RFC',
              strAlternate: 'Glasgow Rangers',
              strSport: 'Soccer',
              strLeague: 'Scottish Premiership',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          schedule: [
            {
              idEvent: 'fix-1',
              strEvent: 'Rangers vs Hearts',
              strLeague: 'Scottish Premiership',
              strSport: 'Soccer',
              dateEvent: '2026-03-25',
              strThumb: 'https://img.test/fixture.jpg',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          search: [
            {
              idTeam: '133642',
              strTeam: 'Rangers',
              strTeamShort: 'RFC',
              strAlternate: 'Glasgow Rangers',
              strSport: 'Soccer',
              strLeague: 'Scottish Premiership',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          schedule: [
            {
              idEvent: 'res-1',
              strEvent: 'Celtic vs Rangers',
              strLeague: 'Scottish Premiership',
              strSport: 'Soccer',
              dateEvent: '2026-03-18',
              strThumb: 'https://img.test/result.jpg',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          search: [
            {
              idTeam: '133642',
              strTeam: 'Rangers',
              strTeamShort: 'RFC',
              strAlternate: 'Glasgow Rangers',
              strSport: 'Soccer',
              strLeague: 'Scottish Premiership',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          teams: [
            {
              idTeam: '133642',
              strTeam: 'Rangers',
              strTeamShort: 'RFC',
              strLeague: 'Scottish Premiership',
              strSport: 'Soccer',
              strCountry: 'Scotland',
              strStadium: 'Ibrox Stadium',
              strBadge: 'https://img.test/team-badge.png',
              strTeamBanner: 'https://img.test/team-banner.jpg',
              strDescriptionEN: 'Rangers Football Club',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          player: [
            {
              idPlayer: '34145937',
              strPlayer: 'James Tavernier',
              strTeam: 'Rangers',
              strPosition: 'Defender',
              dateBorn: '1991-10-31',
              strThumb: 'https://img.test/player-thumb.jpg',
              strCutout: 'https://img.test/player-cutout.png',
              strDescriptionEN: 'Captain of Rangers.',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          player: [
            {
              idPlayer: '34145937',
              strPlayer: 'James Tavernier',
              strTeam: 'Rangers',
              strPosition: 'Defender',
              dateBorn: '1991-10-31',
              strThumb: 'https://img.test/player-thumb.jpg',
              strCutout: 'https://img.test/player-cutout.png',
              strDescriptionEN: 'Captain of Rangers.',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          players: [
            {
              idPlayer: '34145937',
              strPlayer: 'James Tavernier',
              strTeam: 'Rangers',
              strPosition: 'Defender',
              dateBorn: '1991-10-31',
              strThumb: 'https://img.test/player-thumb.jpg',
              strCutout: 'https://img.test/player-cutout.png',
              strDescriptionEN: 'Captain of Rangers.',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new SportsDataService();

    const standings = await service.getStandings({ league: 'Scottish Premiership' });
    const fixtures = await service.getFixtures({ query: 'Rangers' });
    const results = await service.getResults({ query: 'Rangers' });
    const team = await service.getTeamDetails({ query: 'Rangers' });
    const player = await service.getPlayerDetails({ query: 'James Tavernier' });

    expect(standings.isOk()).toBe(true);
    expect(fixtures.isOk()).toBe(true);
    expect(results.isOk()).toBe(true);
    expect(team.isOk()).toBe(true);
    expect(player.isOk()).toBe(true);

    if (standings.isErr() || fixtures.isErr() || results.isErr() || team.isErr() || player.isErr()) {
      throw new Error('Expected all service results to be ok');
    }

    expect(standings.value).toMatchObject({
      leagueId: '4328',
      leagueName: 'Scottish Premiership',
      rows: [
        {
          rank: 1,
          teamId: '133642',
          teamName: 'Rangers',
          points: 68,
          played: 30,
          goalDifference: 43,
        },
      ],
    });

    expect(fixtures.value).toEqual([
      {
        eventId: 'fix-1',
        eventName: 'Rangers vs Hearts',
        sportName: 'Soccer',
        leagueName: 'Scottish Premiership',
        dateEvent: '2026-03-25',
        imageUrl: 'https://img.test/fixture.jpg',
      },
    ]);

    expect(results.value).toEqual([
      {
        eventId: 'res-1',
        eventName: 'Celtic vs Rangers',
        sportName: 'Soccer',
        leagueName: 'Scottish Premiership',
        dateEvent: '2026-03-18',
        imageUrl: 'https://img.test/result.jpg',
      },
    ]);

    expect(team.value).toMatchObject({
      teamId: '133642',
      teamName: 'Rangers',
      sportName: 'Soccer',
      leagueName: 'Scottish Premiership',
      country: 'Scotland',
      stadiumName: 'Ibrox Stadium',
      imageUrl: 'https://img.test/team-badge.png',
    });

    expect(player.value).toMatchObject({
      playerId: '34145937',
      playerName: 'James Tavernier',
      teamName: 'Rangers',
      position: 'Defender',
      dateBorn: '1991-10-31',
      imageUrl: 'https://img.test/player-thumb.jpg',
    });
  });
});

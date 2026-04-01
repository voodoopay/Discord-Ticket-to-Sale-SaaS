import { describe, expect, it } from 'vitest';

import {
  buildSearchResultEmbed,
  buildSportEventEmbed,
} from './sports-embeds.js';

describe('sports embeds', () => {
  it('renders listing times with the configured timezone label instead of UK-only copy', () => {
    const embed = buildSportEventEmbed(
      {
        eventId: 'evt-1',
        eventName: 'Knicks vs Celtics',
        sportName: 'Basketball',
        season: null,
        eventCountry: 'United States',
        startTimeUtc: '2026-03-20T23:00:00.000Z',
        startTimeUkLabel: '19:00',
        imageUrl: null,
        broadcasters: [{ channelId: 'chan-1', channelName: 'ESPN', country: 'United States', logoUrl: null }],
      },
      'America/New_York',
    ).toJSON();

    expect(embed.description).toContain('Start time (America/New_York): **19:00**');
    expect(embed.description).not.toContain('Start time (UK)');
    expect(embed.footer?.text).toBe('Times shown in the configured server timezone (America/New_York).');
  });

  it('renders search details with the configured timezone label instead of UK-only copy', () => {
    const embed = buildSearchResultEmbed(
      {
        eventId: 'evt-1',
        eventName: 'Knicks vs Celtics',
        sportName: 'Basketball',
        leagueName: 'NBA',
        venueName: 'Madison Square Garden',
        country: 'United States',
        city: 'New York',
        dateUkLabel: 'Friday, 20 March 2026',
        startTimeUkLabel: '19:00',
        imageUrl: null,
        description: null,
        broadcasters: [{ channelId: 'chan-1', channelName: 'ESPN', country: 'United States', logoUrl: null }],
      },
      'America/New_York',
    ).toJSON();

    expect(embed.description).toContain('Start time (America/New_York): **19:00**');
    expect(embed.description).not.toContain('Start time (UK)');
    expect(embed.footer?.text).toBe('Times shown in the configured server timezone (America/New_York).');
  });
});

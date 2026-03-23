import { EmbedBuilder } from 'discord.js';
import type { SportsEventDetails, SportsListing, SportsSearchResult } from '@voodoo/core';

const SPORTS_COLOR = 0x0f766e;

function formatBroadcasters(value: { channelName: string; country: string | null }[]): string {
  if (value.length === 0) {
    return 'No broadcaster data available.';
  }

  const visible = value.slice(0, 10).map((item) =>
    item.country ? `${item.channelName} (${item.country})` : item.channelName,
  );
  const remaining = value.length - visible.length;

  return remaining > 0 ? `${visible.join(', ')}\n+ ${remaining} more channel(s)` : visible.join(', ');
}

export function buildSportHeaderMessage(input: {
  sportName: string;
  dateLabel: string;
  broadcastCountry: string;
  listingsCount: number;
}): string {
  return [
    `**${input.sportName}**`,
    `UK TV listings for ${input.dateLabel}.`,
    `Tracked broadcaster country: ${input.broadcastCountry}.`,
    `Events today: ${input.listingsCount}.`,
  ].join('\n');
}

export function buildEmptySportEmbed(input: {
  sportName: string;
  dateLabel: string;
  broadcastCountry: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(`No ${input.sportName} listings found`)
    .setDescription(
      `No televised ${input.sportName} events are currently listed for ${input.dateLabel} on ${input.broadcastCountry} broadcasters.`,
    );
}

export function buildSportEventEmbed(listing: SportsListing): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(listing.eventName)
    .setDescription(
      [
        `Start time (UK): **${listing.startTimeUkLabel}**`,
        `Channels: ${formatBroadcasters(listing.broadcasters)}`,
        listing.eventCountry ? `Event country: ${listing.eventCountry}` : null,
        listing.season ? `Season: ${listing.season}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: 'Times shown in UK time (Europe/London).' });

  if (listing.imageUrl) {
    embed.setThumbnail(listing.imageUrl);
  }

  return embed;
}

export function buildSearchResultEmbed(details: SportsEventDetails): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(details.eventName)
    .setDescription(
      [
        details.leagueName ? `League: **${details.leagueName}**` : null,
        details.sportName ? `Sport: **${details.sportName}**` : null,
        details.dateUkLabel ? `Date: **${details.dateUkLabel}**` : null,
        details.startTimeUkLabel ? `Start time (UK): **${details.startTimeUkLabel}**` : null,
        details.venueName ? `Venue: ${details.venueName}` : null,
        details.city || details.country
          ? `Location: ${[details.city, details.country].filter(Boolean).join(', ')}`
          : null,
        `Channels: ${formatBroadcasters(details.broadcasters)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: 'Times shown in UK time (Europe/London).' });

  if (details.imageUrl) {
    embed.setThumbnail(details.imageUrl);
  }

  return embed;
}

export function buildSearchFallbackEmbed(result: SportsSearchResult): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(result.eventName)
    .setDescription(
      [
        result.leagueName ? `League: **${result.leagueName}**` : null,
        result.sportName ? `Sport: **${result.sportName}**` : null,
        result.dateEvent ? `Date: **${result.dateEvent}**` : null,
        'Detailed channel and start-time data is not available right now.',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: 'Search is limited to today through the next 7 days.' });
}

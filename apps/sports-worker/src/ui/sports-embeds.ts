import { EmbedBuilder } from 'discord.js';
import {
  SPORTS_LIVE_EVENT_CLEANUP_WINDOW_MINUTES,
  type SportsEventDetails,
  type SportsEventHighlight,
  type SportsListing,
  type SportsLiveEvent,
  type SportsPlayerDetails,
  type SportsSearchResult,
  type SportsStandings,
  type SportsTeamDetails,
} from '@voodoo/core';

const SPORTS_COLOR = 0x0f766e;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_ROSTER_PLAYERS = 10;

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

function buildTimezoneFooter(timezone: string): string {
  return `Times shown in the configured server timezone (${timezone}).`;
}

export function formatBroadcastCountriesLabel(broadcastCountries: readonly string[]): string {
  const normalizedCountries = broadcastCountries
    .map((country) => country.trim())
    .filter((country) => country.length > 0);

  if (normalizedCountries.length === 0) {
    return 'the configured broadcasters';
  }

  if (normalizedCountries.length === 1) {
    return normalizedCountries[0]!;
  }

  return new Intl.ListFormat('en', {
    style: 'long',
    type: 'conjunction',
  }).format(normalizedCountries);
}

export function buildSportHeaderMessage(input: {
  sportName: string;
  dateLabel: string;
  broadcastCountries: string[];
  listingsCount: number;
  degraded?: boolean;
  failedCountries?: string[];
}): string {
  const countriesLabel = formatBroadcastCountriesLabel(input.broadcastCountries);
  const failedCountriesLabel =
    input.degraded && input.failedCountries && input.failedCountries.length > 0
      ? formatBroadcastCountriesLabel(input.failedCountries)
      : null;

  return [
    `**${input.sportName}**`,
    `TV listings for ${input.dateLabel} from tracked broadcasters in ${countriesLabel}.`,
    input.degraded
      ? `Tracked broadcaster countries in this update: ${countriesLabel}.`
      : `Tracked broadcaster countries: ${countriesLabel}.`,
    failedCountriesLabel
      ? `Coverage is degraded. Missing broadcaster countries: ${failedCountriesLabel}.`
      : null,
    `Events today: ${input.listingsCount}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function truncateText(value: string | null | undefined, maxLength = MAX_DESCRIPTION_LENGTH): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatSignedNumber(value: number | null): string {
  if (value == null) {
    return '-';
  }

  return value > 0 ? `+${value}` : String(value);
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

export function buildSportEventEmbed(listing: SportsListing, timezone: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(listing.eventName)
    .setDescription(
      [
        `Start time (${timezone}): **${listing.startTimeUkLabel}**`,
        `Channels: ${formatBroadcasters(listing.broadcasters)}`,
        listing.eventCountry ? `Event country: ${listing.eventCountry}` : null,
        listing.season ? `Season: ${listing.season}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: buildTimezoneFooter(timezone) });

  if (listing.imageUrl) {
    embed.setThumbnail(listing.imageUrl);
  }

  return embed;
}

export function buildLiveEventHeaderMessage(event: SportsLiveEvent): string {
  return [
    `**${event.eventName}**`,
    `${event.sportName ?? 'Live sport'} is currently televised live.`,
    event.statusLabel ? `Status: ${event.statusLabel}` : null,
    event.scoreLabel ? `Live score: ${event.scoreLabel}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildLiveEventEmbed(event: SportsLiveEvent): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(event.eventName)
    .setDescription(
      [
        event.leagueName ? `League: **${event.leagueName}**` : null,
        event.sportName ? `Sport: **${event.sportName}**` : null,
        event.statusLabel ? `Status: **${event.statusLabel}**` : null,
        event.scoreLabel ? `Score: **${event.scoreLabel}**` : null,
        event.startTimeUkLabel ? `Kickoff (UK): **${event.startTimeUkLabel}**` : null,
        `Channels: ${formatBroadcasters(event.broadcasters)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: 'Temporary live-event channel managed by the sports worker.' });

  if (event.imageUrl) {
    embed.setThumbnail(event.imageUrl);
  }

  return embed;
}

export function buildFinishedLiveEventEmbed(input: {
  eventName: string;
  sportName: string;
  deleteAfterUtc: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(`${input.eventName} finished`)
    .setDescription(
      [
        `Sport: **${input.sportName}**`,
        `This temporary live-event channel is waiting for the ${SPORTS_LIVE_EVENT_CLEANUP_WINDOW_MINUTES}-minute cleanup window to expire.`,
        `Scheduled cleanup after (UTC): **${input.deleteAfterUtc}**`,
      ].join('\n'),
    );
}

export function buildSearchResultEmbed(details: SportsEventDetails, timezone: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(details.eventName)
    .setDescription(
      [
        details.leagueName ? `League: **${details.leagueName}**` : null,
        details.sportName ? `Sport: **${details.sportName}**` : null,
        details.dateUkLabel ? `Date: **${details.dateUkLabel}**` : null,
        details.startTimeUkLabel ? `Start time (${timezone}): **${details.startTimeUkLabel}**` : null,
        details.venueName ? `Venue: ${details.venueName}` : null,
        details.city || details.country
          ? `Location: ${[details.city, details.country].filter(Boolean).join(', ')}`
          : null,
        `Channels: ${formatBroadcasters(details.broadcasters)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: buildTimezoneFooter(timezone) });

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

export function buildLookupScheduleEmbed(input: {
  result: SportsSearchResult;
  label: 'Fixture' | 'Result';
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(input.result.eventName)
    .setDescription(
      [
        `Type: **${input.label}**`,
        input.result.leagueName ? `League: **${input.result.leagueName}**` : null,
        input.result.sportName ? `Sport: **${input.result.sportName}**` : null,
        input.result.dateEvent ? `Date: **${input.result.dateEvent}**` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: 'Use /match for a richer single-event view when event details are available.' });

  if (input.result.imageUrl) {
    embed.setThumbnail(input.result.imageUrl);
  }

  return embed;
}

export function buildHighlightEmbed(input: {
  eventName: string;
  sportName: string | null;
  highlight: SportsEventHighlight;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(input.eventName)
    .setDescription(
      [
        input.sportName ? `Sport: **${input.sportName}**` : null,
        `Watch highlights: ${input.highlight.videoUrl}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: 'Highlights availability depends on the upstream sports data provider.' });

  if (input.highlight.imageUrl) {
    embed.setThumbnail(input.highlight.imageUrl);
  }

  return embed;
}

export function buildMatchCenterEmbed(input: {
  details: SportsEventDetails;
  highlightUrl?: string | null;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(input.details.eventName)
    .setDescription(
      [
        input.details.leagueName ? `League: **${input.details.leagueName}**` : null,
        input.details.sportName ? `Sport: **${input.details.sportName}**` : null,
        input.details.dateUkLabel ? `Date: **${input.details.dateUkLabel}**` : null,
        input.details.startTimeUkLabel ? `Start time (UK): **${input.details.startTimeUkLabel}**` : null,
        input.details.venueName ? `Venue: ${input.details.venueName}` : null,
        input.details.city || input.details.country
          ? `Location: ${[input.details.city, input.details.country].filter(Boolean).join(', ')}`
          : null,
        `Channels: ${formatBroadcasters(input.details.broadcasters)}`,
        input.highlightUrl ? `Highlights: ${input.highlightUrl}` : null,
        truncateText(input.details.description),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: 'Times shown in UK time (Europe/London).' });

  if (input.details.imageUrl) {
    embed.setThumbnail(input.details.imageUrl);
  }

  return embed;
}

export function buildStandingsEmbed(standings: SportsStandings): EmbedBuilder {
  const visibleRows = standings.rows.slice(0, 10);
  const hiddenCount = standings.rows.length - visibleRows.length;
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(standings.leagueName)
    .setDescription(
      visibleRows.length === 0
        ? 'No table rows are available right now.'
        : visibleRows
            .map(
              (row) =>
                `${row.rank ?? '-'}\. ${row.teamName} - ${row.points ?? '-'} pts (P${row.played ?? '-'} W${row.wins ?? '-'} D${row.draws ?? '-'} L${row.losses ?? '-'} GD ${formatSignedNumber(row.goalDifference)})`,
            )
            .join('\n'),
    )
    .setFooter({
      text:
        hiddenCount > 0
          ? `Showing the top ${visibleRows.length} rows.`
          : 'Current standings table.',
    });

  if (standings.imageUrl) {
    embed.setThumbnail(standings.imageUrl);
  }

  return embed;
}

export function buildTeamProfileEmbed(team: SportsTeamDetails): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(team.teamName)
    .setDescription(
      [
        team.sportName ? `Sport: **${team.sportName}**` : null,
        team.leagueName ? `League: **${team.leagueName}**` : null,
        team.country ? `Country: ${team.country}` : null,
        team.stadiumName ? `Stadium: ${team.stadiumName}` : null,
        truncateText(team.description),
      ]
        .filter(Boolean)
        .join('\n'),
    );

  const rosterSummary = team.players
    .slice(0, MAX_ROSTER_PLAYERS)
    .map((player) =>
      player.position ? `${player.playerName} (${player.position})` : player.playerName,
    )
    .join('\n');

  if (rosterSummary.length > 0) {
    embed.addFields({
      name: 'Roster Snapshot',
      value:
        team.players.length > MAX_ROSTER_PLAYERS
          ? `${rosterSummary}\n+ ${team.players.length - MAX_ROSTER_PLAYERS} more player(s)`
          : rosterSummary,
    });
  }

  if (team.imageUrl) {
    embed.setThumbnail(team.imageUrl);
  }

  if (team.bannerUrl) {
    embed.setImage(team.bannerUrl);
  }

  return embed;
}

export function buildPlayerProfileEmbed(player: SportsPlayerDetails): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(SPORTS_COLOR)
    .setTitle(player.playerName)
    .setDescription(
      [
        player.teamName ? `Team: **${player.teamName}**` : null,
        player.position ? `Position: **${player.position}**` : null,
        player.dateBorn ? `Born: **${player.dateBorn}**` : null,
        truncateText(player.description),
      ]
        .filter(Boolean)
        .join('\n'),
    );

  if (player.imageUrl) {
    embed.setThumbnail(player.imageUrl);
  }

  if (player.cutoutUrl) {
    embed.setImage(player.cutoutUrl);
  }

  return embed;
}

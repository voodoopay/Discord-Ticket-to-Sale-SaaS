import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  SportsAccessService,
  SportsDataService,
  SportsService,
  getEnv,
  pickBestSportsSearchResult,
  type SportsSearchResult,
} from '@voodoo/core';

import { mapSportsError } from '../sports-runtime.js';

export const sportsAccessService = new SportsAccessService();
export const sportsDataService = new SportsDataService();
export const sportsService = new SportsService();
export const MAX_LOOKUP_EMBEDS = 10;

export type MatchingEventSource = 'recent-result' | 'upcoming-fixture';
export type MatchingEvent = {
  event: SportsSearchResult;
  source: MatchingEventSource;
};

function isSuperAdminUser(discordUserId: string): boolean {
  return getEnv().superAdminDiscordIds.includes(discordUserId);
}

function normalizeBroadcastCountries(
  broadcastCountries: readonly (string | null | undefined)[],
): string[] {
  const normalized = broadcastCountries
    .map((country) => country?.trim() ?? '')
    .filter((country) => country.length > 0);

  return normalized.length > 0 ? [...new Set(normalized)] : [getEnv().SPORTS_BROADCAST_COUNTRY];
}

export async function deferEphemeralReply(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

export async function sendEphemeralReply(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply({ content });
    return;
  }

  if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

export function getLookupPermissionError(
  interaction: ChatInputCommandInteraction,
): string | null {
  if (!interaction.inGuild() || !interaction.guildId) {
    return 'This command can only be used inside a Discord server.';
  }

  const requiredPermissions = [
    { bit: PermissionFlagsBits.ViewChannel, label: 'View Channel' },
    { bit: PermissionFlagsBits.SendMessages, label: 'Send Messages' },
    { bit: PermissionFlagsBits.EmbedLinks, label: 'Embed Links' },
  ] as const;

  const missing = requiredPermissions
    .filter((permission) => interaction.appPermissions?.has(permission.bit) !== true)
    .map((permission) => permission.label);

  if (missing.length > 0) {
    return `I am missing required channel permissions: ${missing.join(', ')}.`;
  }

  return null;
}

export function getLookupActivationMessage(commandName: string): string {
  return `This server is not activated for the sports worker yet. A super admin must grant access with \`/activation grant guild_id:<server-id> user_id:<user-id>\` before \`/${commandName}\` can be used here.`;
}

export async function resolveLookupContext(input: {
  interaction: ChatInputCommandInteraction;
  commandName: string;
}): Promise<
  | {
      guildId: string;
      timezone: string;
      broadcastCountries: string[];
      primaryBroadcastCountry: string;
    }
  | { error: string }
> {
  const { interaction, commandName } = input;
  if (!interaction.guildId) {
    return { error: 'This command can only be used inside a Discord server.' };
  }

  if (!isSuperAdminUser(interaction.user.id)) {
    const activationState = await sportsAccessService.getGuildActivationState({
      guildId: interaction.guildId,
    });
    if (activationState.isErr()) {
      return { error: mapSportsError(activationState.error) };
    }

    if (!activationState.value.activated) {
      return { error: getLookupActivationMessage(commandName) };
    }
  }

  const configResult = await sportsService.getGuildConfig({ guildId: interaction.guildId });
  if (configResult.isErr()) {
    return { error: mapSportsError(configResult.error) };
  }

  const env = getEnv();
  const broadcastCountries = normalizeBroadcastCountries(
    configResult.value?.broadcastCountries?.length
      ? configResult.value.broadcastCountries
      : [configResult.value?.broadcastCountry, env.SPORTS_BROADCAST_COUNTRY],
  );

  return {
    guildId: interaction.guildId,
    timezone: configResult.value?.timezone ?? env.SPORTS_DEFAULT_TIMEZONE,
    broadcastCountries,
    primaryBroadcastCountry: broadcastCountries[0] ?? env.SPORTS_BROADCAST_COUNTRY,
  };
}

export async function findBestMatchingEvent(input: {
  query: string;
  preference?: 'prefer-recent' | 'prefer-upcoming';
}): Promise<{ match: MatchingEvent | null } | { error: string }> {
  const searchResult = await sportsDataService.searchEvents(input.query);
  if (searchResult.isErr()) {
    return { error: mapSportsError(searchResult.error) };
  }

  const recentResults = await sportsDataService.getResults({ query: input.query });
  if (recentResults.isErr()) {
    return { error: mapSportsError(recentResults.error) };
  }

  const recentMatch = pickBestSportsSearchResult(input.query, recentResults.value);
  const upcomingMatch = pickBestSportsSearchResult(input.query, searchResult.value);
  const preferredMatches =
    input.preference === 'prefer-upcoming'
      ? [
          upcomingMatch
            ? ({ event: upcomingMatch, source: 'upcoming-fixture' } satisfies MatchingEvent)
            : null,
          recentMatch
            ? ({ event: recentMatch, source: 'recent-result' } satisfies MatchingEvent)
            : null,
        ]
      : [
          recentMatch
            ? ({ event: recentMatch, source: 'recent-result' } satisfies MatchingEvent)
            : null,
          upcomingMatch
            ? ({ event: upcomingMatch, source: 'upcoming-fixture' } satisfies MatchingEvent)
            : null,
        ];

  return {
    match: preferredMatches.find((value): value is MatchingEvent => value !== null) ?? null,
  };
}

export function matchesOptionalFilter(
  value: string | null | undefined,
  filter: string | null,
): boolean {
  if (!filter) {
    return true;
  }

  if (!value) {
    return false;
  }

  return value.toLowerCase().includes(filter.toLowerCase());
}

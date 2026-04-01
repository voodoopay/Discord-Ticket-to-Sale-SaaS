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

function isSuperAdminUser(discordUserId: string): boolean {
  return getEnv().superAdminDiscordIds.includes(discordUserId);
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
  | { guildId: string; timezone: string; broadcastCountry: string }
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
  return {
    guildId: interaction.guildId,
    timezone: configResult.value?.timezone ?? env.SPORTS_DEFAULT_TIMEZONE,
    broadcastCountry: configResult.value?.broadcastCountry ?? env.SPORTS_BROADCAST_COUNTRY,
  };
}

export async function findBestMatchingEvent(
  query: string,
): Promise<{ event: SportsSearchResult | null } | { error: string }> {
  const searchResult = await sportsDataService.searchEvents(query);
  if (searchResult.isErr()) {
    return { error: mapSportsError(searchResult.error) };
  }

  const directMatch = pickBestSportsSearchResult(query, searchResult.value);
  if (directMatch) {
    return { event: directMatch };
  }

  const recentResults = await sportsDataService.getResults({ query });
  if (recentResults.isErr()) {
    return { error: mapSportsError(recentResults.error) };
  }

  return {
    event: pickBestSportsSearchResult(query, recentResults.value),
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

import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  SportsAccessService,
  SportsDataService,
  SportsService,
  getEnv,
} from '@voodoo/core';

import { buildSearchFallbackEmbed, buildSearchResultEmbed } from '../ui/sports-embeds.js';
import { mapSportsError } from '../sports-runtime.js';

const sportsAccessService = new SportsAccessService();
const sportsDataService = new SportsDataService();
const sportsService = new SportsService();
const MAX_SEARCH_RESULT_EMBEDS = 10;

function isSuperAdminUser(discordUserId: string): boolean {
  return getEnv().superAdminDiscordIds.includes(discordUserId);
}

async function deferEphemeralReply(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

async function sendEphemeralReply(
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

function getSearchActivationMessage(): string {
  return 'This server is not activated for the sports worker yet. A super admin must grant access with `/activation grant guild_id:<server-id> user_id:<user-id>` before `/search` can be used here.';
}

function getSearchPermissionError(interaction: ChatInputCommandInteraction): string | null {
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

export const searchCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for a sports event and show the UK schedule details')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Example: Rangers v Celtic')
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(120),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const permissionError = getSearchPermissionError(interaction);
    if (permissionError) {
      await sendEphemeralReply(interaction, permissionError);
      return;
    }

    await deferEphemeralReply(interaction);

    try {
      const guildId = interaction.guildId as string;
      const isSuperAdmin = isSuperAdminUser(interaction.user.id);

      if (!isSuperAdmin) {
        const activationState = await sportsAccessService.getGuildActivationState({ guildId });
        if (activationState.isErr()) {
          await sendEphemeralReply(interaction, mapSportsError(activationState.error));
          return;
        }

        if (!activationState.value.activated) {
          await sendEphemeralReply(interaction, getSearchActivationMessage());
          return;
        }
      }

      const query = interaction.options.getString('query', true).trim();
      const searchResult = await sportsDataService.searchEvents(query);
      if (searchResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(searchResult.error));
        return;
      }

      if (searchResult.value.length === 0) {
        await sendEphemeralReply(
          interaction,
          `No televised sports event match was found for \`${query}\` from today through the next 7 days.`,
        );
        return;
      }

      const guildConfigResult = await sportsService.getGuildConfig({ guildId });
      if (guildConfigResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(guildConfigResult.error));
        return;
      }

      const env = getEnv();
      const timezone = guildConfigResult.value?.timezone ?? env.SPORTS_DEFAULT_TIMEZONE;
      const broadcastCountry =
        guildConfigResult.value?.broadcastCountry ?? env.SPORTS_BROADCAST_COUNTRY;
      const visibleResults = searchResult.value.slice(0, MAX_SEARCH_RESULT_EMBEDS);
      const embeds = await Promise.all(
        visibleResults.map(async (result) => {
          const detailsResult = await sportsDataService.getEventDetails({
            eventId: result.eventId,
            timezone,
            broadcastCountry,
          });

          if (detailsResult.isErr() || !detailsResult.value) {
            return buildSearchFallbackEmbed(result);
          }

          return buildSearchResultEmbed(detailsResult.value);
        }),
      );

      const hiddenCount = searchResult.value.length - visibleResults.length;
      const summaryParts = [
        `Found ${searchResult.value.length} upcoming televised event${searchResult.value.length === 1 ? '' : 's'} for \`${query}\` from today through the next 7 days.`,
        hiddenCount > 0 ? `Showing the first ${visibleResults.length}.` : null,
      ].filter((value): value is string => value !== null);

      await interaction.editReply({
        content: summaryParts.join(' '),
        embeds,
      });
    } catch (error) {
      await sendEphemeralReply(interaction, mapSportsError(error));
    }
  },
};

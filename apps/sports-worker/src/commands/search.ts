import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { SportsDataService } from '@voodoo/core';

import { buildSearchFallbackEmbed, buildSearchResultEmbed } from '../ui/sports-embeds.js';
import { mapSportsError } from '../sports-runtime.js';
import {
  deferEphemeralReply,
  getLookupPermissionError,
  resolveLookupContext,
  sendEphemeralReply,
} from './lookup-command-support.js';

const sportsDataService = new SportsDataService();
const MAX_SEARCH_RESULT_EMBEDS = 10;

export const searchCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for a sports event and show the configured schedule details')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Example: Rangers v Celtic')
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(120),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const permissionError = getLookupPermissionError(interaction);
    if (permissionError) {
      await sendEphemeralReply(interaction, permissionError);
      return;
    }

    await deferEphemeralReply(interaction);

    try {
      const context = await resolveLookupContext({
        interaction,
        commandName: 'search',
      });
      if ('error' in context) {
        await sendEphemeralReply(interaction, context.error);
        return;
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

      const visibleResults = searchResult.value.slice(0, MAX_SEARCH_RESULT_EMBEDS);
      const embeds = await Promise.all(
        visibleResults.map(async (result) => {
          const detailsResult = await sportsDataService.getEventDetails({
            eventId: result.eventId,
            timezone: context.timezone,
            broadcastCountry: context.primaryBroadcastCountry,
          });

          if (detailsResult.isErr() || !detailsResult.value) {
            return buildSearchFallbackEmbed(result);
          }

          return buildSearchResultEmbed(detailsResult.value, context.timezone);
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

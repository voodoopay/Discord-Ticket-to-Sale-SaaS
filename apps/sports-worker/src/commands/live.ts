import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { mapSportsError } from '../sports-runtime.js';
import { buildLiveEventEmbed } from '../ui/sports-embeds.js';
import {
  MAX_LOOKUP_EMBEDS,
  deferEphemeralReply,
  getLookupPermissionError,
  matchesOptionalFilter,
  resolveLookupContext,
  sendEphemeralReply,
  sportsDataService,
} from './lookup-command-support.js';

export const liveCommand = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Show current live televised sports events')
    .addStringOption((option) =>
      option.setName('sport').setDescription('Optional sport filter').setMaxLength(60),
    )
    .addStringOption((option) =>
      option.setName('league').setDescription('Optional league filter').setMaxLength(80),
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
        commandName: 'live',
      });
      if ('error' in context) {
        await sendEphemeralReply(interaction, context.error);
        return;
      }

      const sportFilter = interaction.options.getString('sport')?.trim() || null;
      const leagueFilter = interaction.options.getString('league')?.trim() || null;
      const liveResult = await sportsDataService.listLiveEventsAcrossCountries({
        timezone: context.timezone,
        broadcastCountries: context.broadcastCountries,
      });
      if (liveResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(liveResult.error));
        return;
      }

      const visibleEvents = liveResult.value.data
        .filter((event) => event.broadcasters.length > 0)
        .filter(
          (event) =>
            matchesOptionalFilter(event.sportName, sportFilter) &&
            matchesOptionalFilter(event.leagueName, leagueFilter),
        );

      if (visibleEvents.length === 0) {
        await sendEphemeralReply(
          interaction,
          `No live televised events were found right now${sportFilter || leagueFilter ? ' for the selected filters' : ''}.`,
        );
        return;
      }

      const embeds = visibleEvents
        .slice(0, MAX_LOOKUP_EMBEDS)
        .map((event) => buildLiveEventEmbed(event));
      const hiddenCount = visibleEvents.length - embeds.length;

      await interaction.editReply({
        content: [
          `Found ${visibleEvents.length} live televised event${visibleEvents.length === 1 ? '' : 's'}.`,
          hiddenCount > 0 ? `Showing the first ${embeds.length}.` : null,
        ]
          .filter(Boolean)
          .join(' '),
        embeds,
      });
    } catch (error) {
      await sendEphemeralReply(interaction, mapSportsError(error));
    }
  },
};

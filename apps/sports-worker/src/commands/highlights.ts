import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { mapSportsError } from '../sports-runtime.js';
import { buildHighlightEmbed } from '../ui/sports-embeds.js';
import {
  deferEphemeralReply,
  findBestMatchingEvent,
  getLookupPermissionError,
  resolveLookupContext,
  sendEphemeralReply,
  sportsDataService,
} from './lookup-command-support.js';

export const highlightsCommand = {
  data: new SlashCommandBuilder()
    .setName('highlights')
    .setDescription('Return on-demand highlights for a finished or matching event')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Team or event name')
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
        commandName: 'highlights',
      });
      if ('error' in context) {
        await sendEphemeralReply(interaction, context.error);
        return;
      }

      const query = interaction.options.getString('query', true).trim();
      const eventMatch = await findBestMatchingEvent(query);
      if ('error' in eventMatch) {
        await sendEphemeralReply(interaction, eventMatch.error);
        return;
      }

      if (!eventMatch.event) {
        await sendEphemeralReply(
          interaction,
          `No matching event or recent result was found for \`${query}\`.`,
        );
        return;
      }

      const highlightsResult = await sportsDataService.getEventHighlights({
        eventId: eventMatch.event.eventId,
      });
      if (highlightsResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(highlightsResult.error));
        return;
      }

      if (!highlightsResult.value) {
        await sendEphemeralReply(
          interaction,
          `No on-demand highlights are available yet for \`${eventMatch.event.eventName}\`.`,
        );
        return;
      }

      await interaction.editReply({
        content: `Highlights for \`${eventMatch.event.eventName}\`.`,
        embeds: [
          buildHighlightEmbed({
            eventName: eventMatch.event.eventName,
            sportName: eventMatch.event.sportName,
            highlight: highlightsResult.value,
          }),
        ],
      });
    } catch (error) {
      await sendEphemeralReply(interaction, mapSportsError(error));
    }
  },
};

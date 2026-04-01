import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { mapSportsError } from '../sports-runtime.js';
import { buildLookupScheduleEmbed, buildMatchCenterEmbed } from '../ui/sports-embeds.js';
import {
  deferEphemeralReply,
  findBestMatchingEvent,
  getLookupPermissionError,
  resolveLookupContext,
  sendEphemeralReply,
  sportsDataService,
} from './lookup-command-support.js';

export const matchCommand = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('Return a richer match-centre response for a team or event')
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
        commandName: 'match',
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

      const [detailsResult, highlightsResult] = await Promise.all([
        sportsDataService.getEventDetails({
          eventId: eventMatch.event.eventId,
          timezone: context.timezone,
          broadcastCountry: context.broadcastCountry,
        }),
        sportsDataService.getEventHighlights({
          eventId: eventMatch.event.eventId,
        }),
      ]);
      if (detailsResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(detailsResult.error));
        return;
      }
      if (highlightsResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(highlightsResult.error));
        return;
      }

      await interaction.editReply({
        content: `Match centre for \`${eventMatch.event.eventName}\`.`,
        embeds: detailsResult.value
          ? [
              buildMatchCenterEmbed({
                details: detailsResult.value,
                highlightUrl: highlightsResult.value?.videoUrl ?? null,
              }),
            ]
          : [
              buildLookupScheduleEmbed({
                result: eventMatch.event,
                label: 'Fixture',
              }),
            ],
      });
    } catch (error) {
      await sendEphemeralReply(interaction, mapSportsError(error));
    }
  },
};

import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { mapSportsError } from '../sports-runtime.js';
import { buildLookupScheduleEmbed } from '../ui/sports-embeds.js';
import {
  MAX_LOOKUP_EMBEDS,
  deferEphemeralReply,
  getLookupPermissionError,
  resolveLookupContext,
  sendEphemeralReply,
  sportsDataService,
} from './lookup-command-support.js';

export const resultsCommand = {
  data: new SlashCommandBuilder()
    .setName('results')
    .setDescription('Show recent results for a team or league')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Team or league name')
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
        commandName: 'results',
      });
      if ('error' in context) {
        await sendEphemeralReply(interaction, context.error);
        return;
      }

      const query = interaction.options.getString('query', true).trim();
      const resultsResult = await sportsDataService.getResults({ query });
      if (resultsResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(resultsResult.error));
        return;
      }

      if (resultsResult.value.length === 0) {
        await sendEphemeralReply(
          interaction,
          `No recent results were found for \`${query}\`.`,
        );
        return;
      }

      const visibleResults = resultsResult.value.slice(0, MAX_LOOKUP_EMBEDS);
      await interaction.editReply({
        content: [
          `Recent results for \`${query}\`: ${resultsResult.value.length} match${resultsResult.value.length === 1 ? '' : 'es'} found.`,
          resultsResult.value.length > visibleResults.length
            ? `Showing the first ${visibleResults.length}.`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
        embeds: visibleResults.map((result) =>
          buildLookupScheduleEmbed({
            result,
            label: 'Result',
          }),
        ),
      });
    } catch (error) {
      await sendEphemeralReply(interaction, mapSportsError(error));
    }
  },
};

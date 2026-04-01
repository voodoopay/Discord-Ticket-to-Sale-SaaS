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

export const fixturesCommand = {
  data: new SlashCommandBuilder()
    .setName('fixtures')
    .setDescription('Show upcoming fixtures for a team or league')
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
        commandName: 'fixtures',
      });
      if ('error' in context) {
        await sendEphemeralReply(interaction, context.error);
        return;
      }

      const query = interaction.options.getString('query', true).trim();
      const fixturesResult = await sportsDataService.getFixtures({ query });
      if (fixturesResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(fixturesResult.error));
        return;
      }

      if (fixturesResult.value.length === 0) {
        await sendEphemeralReply(
          interaction,
          `No upcoming fixtures were found for \`${query}\`.`,
        );
        return;
      }

      const visibleFixtures = fixturesResult.value.slice(0, MAX_LOOKUP_EMBEDS);
      await interaction.editReply({
        content: [
          `Upcoming fixtures for \`${query}\`: ${fixturesResult.value.length} match${fixturesResult.value.length === 1 ? '' : 'es'} found.`,
          fixturesResult.value.length > visibleFixtures.length
            ? `Showing the first ${visibleFixtures.length}.`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
        embeds: visibleFixtures.map((result) =>
          buildLookupScheduleEmbed({
            result,
            label: 'Fixture',
          }),
        ),
      });
    } catch (error) {
      await sendEphemeralReply(interaction, mapSportsError(error));
    }
  },
};

import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { mapSportsError } from '../sports-runtime.js';
import { buildStandingsEmbed } from '../ui/sports-embeds.js';
import {
  deferEphemeralReply,
  getLookupPermissionError,
  resolveLookupContext,
  sendEphemeralReply,
  sportsDataService,
} from './lookup-command-support.js';

export const standingsCommand = {
  data: new SlashCommandBuilder()
    .setName('standings')
    .setDescription('Show the latest league standings')
    .addStringOption((option) =>
      option
        .setName('league')
        .setDescription('League name')
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
        commandName: 'standings',
      });
      if ('error' in context) {
        await sendEphemeralReply(interaction, context.error);
        return;
      }

      const league = interaction.options.getString('league', true).trim();
      const standingsResult = await sportsDataService.getStandings({ league });
      if (standingsResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(standingsResult.error));
        return;
      }

      if (!standingsResult.value || standingsResult.value.rows.length === 0) {
        await sendEphemeralReply(
          interaction,
          `No standings were found for \`${league}\`.`,
        );
        return;
      }

      await interaction.editReply({
        content: `Standings for \`${standingsResult.value.leagueName}\`.`,
        embeds: [buildStandingsEmbed(standingsResult.value)],
      });
    } catch (error) {
      await sendEphemeralReply(interaction, mapSportsError(error));
    }
  },
};

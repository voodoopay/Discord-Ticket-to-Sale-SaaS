import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { mapSportsError } from '../sports-runtime.js';
import { buildPlayerProfileEmbed } from '../ui/sports-embeds.js';
import {
  deferEphemeralReply,
  getLookupPermissionError,
  resolveLookupContext,
  sendEphemeralReply,
  sportsDataService,
} from './lookup-command-support.js';

export const playerCommand = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Show a player page style summary')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Player name')
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
        commandName: 'player',
      });
      if ('error' in context) {
        await sendEphemeralReply(interaction, context.error);
        return;
      }

      const query = interaction.options.getString('query', true).trim();
      const playerResult = await sportsDataService.getPlayerDetails({ query });
      if (playerResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(playerResult.error));
        return;
      }

      if (!playerResult.value) {
        await sendEphemeralReply(interaction, `No player profile was found for \`${query}\`.`);
        return;
      }

      await interaction.editReply({
        content: `Player profile for \`${playerResult.value.playerName}\`.`,
        embeds: [buildPlayerProfileEmbed(playerResult.value)],
      });
    } catch (error) {
      await sendEphemeralReply(interaction, mapSportsError(error));
    }
  },
};

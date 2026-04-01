import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { mapSportsError } from '../sports-runtime.js';
import { buildTeamProfileEmbed } from '../ui/sports-embeds.js';
import {
  deferEphemeralReply,
  getLookupPermissionError,
  resolveLookupContext,
  sendEphemeralReply,
  sportsDataService,
} from './lookup-command-support.js';

export const teamCommand = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Show a team page style summary')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Team name')
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
        commandName: 'team',
      });
      if ('error' in context) {
        await sendEphemeralReply(interaction, context.error);
        return;
      }

      const query = interaction.options.getString('query', true).trim();
      const teamResult = await sportsDataService.getTeamDetails({ query });
      if (teamResult.isErr()) {
        await sendEphemeralReply(interaction, mapSportsError(teamResult.error));
        return;
      }

      if (!teamResult.value) {
        await sendEphemeralReply(interaction, `No team profile was found for \`${query}\`.`);
        return;
      }

      await interaction.editReply({
        content: `Team profile for \`${teamResult.value.teamName}\`.`,
        embeds: [buildTeamProfileEmbed(teamResult.value)],
      });
    } catch (error) {
      await sendEphemeralReply(interaction, mapSportsError(error));
    }
  },
};

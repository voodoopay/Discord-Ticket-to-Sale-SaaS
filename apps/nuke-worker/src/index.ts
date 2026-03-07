import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { getEnv, logger } from '@voodoo/core';

import { mapNukeError, nukeCommand, startNukeScheduler } from './commands/nuke.js';

type Command = {
  data: { name: string };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
};

function resolveNukeWorkerToken(): string {
  const env = getEnv();
  const token = env.NUKE_DISCORD_TOKEN.trim();
  if (token.length > 0) {
    return token;
  }

  throw new Error('NUKE_DISCORD_TOKEN is required for apps/nuke-worker.');
}

const env = getEnv();
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = new Collection<string, Command>();
commands.set(nukeCommand.data.name, nukeCommand as unknown as Command);

client.once(Events.ClientReady, () => {
  logger.info({ botUser: client.user?.tag }, 'nuke-worker ready');
  startNukeScheduler(client, env.NUKE_POLL_INTERVAL_MS);
  logger.info({ pollIntervalMs: env.NUKE_POLL_INTERVAL_MS }, 'nuke scheduler loop started');
});

async function sendInteractionFailure(interaction: Interaction, message: string): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (!command?.autocomplete) {
      await interaction.respond([]);
      return;
    }

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      logger.error(
        { err: error, commandName: interaction.commandName, guildId: interaction.guildId },
        'nuke-worker autocomplete handler failed',
      );
      await interaction.respond([]);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = commands.get(interaction.commandName);
  if (!command) {
    await sendInteractionFailure(interaction, `Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(
      { err: error, commandName: interaction.commandName, guildId: interaction.guildId },
      'nuke-worker interaction handler failed',
    );
    await sendInteractionFailure(interaction, mapNukeError(error));
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction);
});

void client.login(resolveNukeWorkerToken());

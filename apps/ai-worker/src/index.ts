import {
  Client,
  Collection,
  Events,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { getEnv, logger } from '@voodoo/core';

import { activationCommand } from './commands/activation.js';
import { createAiClientOptions, mapAiWorkerError } from './runtime.js';

type Command = {
  data: { name: string };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

function resolveAiWorkerToken(): string {
  const env = getEnv();
  const token = env.AI_DISCORD_TOKEN.trim();
  if (token.length > 0) {
    return token;
  }

  throw new Error('AI_DISCORD_TOKEN is required for apps/ai-worker.');
}

const client = new Client(createAiClientOptions());

const commands = new Collection<string, Command>();
commands.set(activationCommand.data.name, activationCommand as unknown as Command);

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
      'ai-worker interaction handler failed',
    );
    await sendInteractionFailure(interaction, mapAiWorkerError(error));
  }
}

client.once(Events.ClientReady, () => {
  logger.info({ botUser: client.user?.tag }, 'ai-worker ready');
});

client.on(Events.InteractionCreate, (interaction: Interaction) => {
  void handleInteraction(interaction);
});

void client.login(resolveAiWorkerToken());

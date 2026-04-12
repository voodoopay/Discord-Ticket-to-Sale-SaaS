import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { getEnv, logger } from '@voodoo/core';

import { activationCommand } from './commands/activation.js';
import { channelCopyCommand } from './commands/channel-copy.js';

type Command = {
  data: { name: string };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

function resolveChannelCopyWorkerToken(): string {
  const env = getEnv();
  const token = env.CHANNEL_COPY_DISCORD_TOKEN.trim();
  if (token.length > 0) {
    return token;
  }

  throw new Error('CHANNEL_COPY_DISCORD_TOKEN is required for apps/channel-copy-worker.');
}

function mapChannelCopyWorkerError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Channel-copy worker failed due to an internal error.';
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = new Collection<string, Command>();
commands.set(activationCommand.data.name, activationCommand as unknown as Command);
commands.set(channelCopyCommand.data.name, channelCopyCommand as unknown as Command);

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
      'channel-copy-worker interaction handler failed',
    );
    await sendInteractionFailure(interaction, mapChannelCopyWorkerError(error));
  }
}

client.once(Events.ClientReady, () => {
  logger.info({ botUser: client.user?.tag }, 'channel-copy-worker ready');
});

client.on(Events.InteractionCreate, (interaction: Interaction) => {
  void handleInteraction(interaction);
});

void client.login(resolveChannelCopyWorkerToken());

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
import { fixturesCommand } from './commands/fixtures.js';
import { highlightsCommand } from './commands/highlights.js';
import { liveCommand } from './commands/live.js';
import { matchCommand } from './commands/match.js';
import { playerCommand } from './commands/player.js';
import { resultsCommand } from './commands/results.js';
import { searchCommand } from './commands/search.js';
import { standingsCommand } from './commands/standings.js';
import { sportsCommand } from './commands/sports.js';
import { teamCommand } from './commands/team.js';
import { startLiveEventScheduler } from './live-event-runtime.js';
import { mapSportsError, startSportsScheduler } from './sports-runtime.js';

type Command = {
  data: { name: string };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

function resolveSportsWorkerToken(): string {
  const env = getEnv();
  const token = env.SPORTS_DISCORD_TOKEN.trim();
  if (token.length > 0) {
    return token;
  }

  throw new Error('SPORTS_DISCORD_TOKEN is required for apps/sports-worker.');
}

const env = getEnv();
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = new Collection<string, Command>();
commands.set(activationCommand.data.name, activationCommand as unknown as Command);
commands.set(fixturesCommand.data.name, fixturesCommand as unknown as Command);
commands.set(highlightsCommand.data.name, highlightsCommand as unknown as Command);
commands.set(liveCommand.data.name, liveCommand as unknown as Command);
commands.set(matchCommand.data.name, matchCommand as unknown as Command);
commands.set(playerCommand.data.name, playerCommand as unknown as Command);
commands.set(resultsCommand.data.name, resultsCommand as unknown as Command);
commands.set(searchCommand.data.name, searchCommand as unknown as Command);
commands.set(standingsCommand.data.name, standingsCommand as unknown as Command);
commands.set(sportsCommand.data.name, sportsCommand as unknown as Command);
commands.set(teamCommand.data.name, teamCommand as unknown as Command);

client.once(Events.ClientReady, () => {
  logger.info({ botUser: client.user?.tag }, 'sports-worker ready');
  startSportsScheduler(client, env.SPORTS_POLL_INTERVAL_MS);
  startLiveEventScheduler(client, env.SPORTS_POLL_INTERVAL_MS);
  logger.info({ pollIntervalMs: env.SPORTS_POLL_INTERVAL_MS }, 'sports scheduler loop started');
  logger.info({ pollIntervalMs: env.SPORTS_POLL_INTERVAL_MS }, 'live event scheduler loop started');
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
      'sports-worker interaction handler failed',
    );
    await sendInteractionFailure(interaction, mapSportsError(error));
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction);
});

void client.login(resolveSportsWorkerToken());

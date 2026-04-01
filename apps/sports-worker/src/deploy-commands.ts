import { REST, Routes } from 'discord.js';
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

function resolveDeployConfig(): { token: string; clientId: string } {
  const env = getEnv();
  const token = env.SPORTS_DISCORD_TOKEN.trim();
  const clientId = env.SPORTS_DISCORD_CLIENT_ID.trim();

  if (token.length === 0) {
    throw new Error('SPORTS_DISCORD_TOKEN is required to deploy sports commands.');
  }

  if (clientId.length === 0) {
    throw new Error('SPORTS_DISCORD_CLIENT_ID is required to deploy sports commands.');
  }

  return { token, clientId };
}

async function deploy(): Promise<void> {
  const { token, clientId } = resolveDeployConfig();
  const rest = new REST({ version: '10' }).setToken(token);
  const payload = [
    sportsCommand.data.toJSON(),
    searchCommand.data.toJSON(),
    liveCommand.data.toJSON(),
    highlightsCommand.data.toJSON(),
    matchCommand.data.toJSON(),
    standingsCommand.data.toJSON(),
    fixturesCommand.data.toJSON(),
    resultsCommand.data.toJSON(),
    teamCommand.data.toJSON(),
    playerCommand.data.toJSON(),
    activationCommand.data.toJSON(),
  ];
  const guildId = process.env.DISCORD_TEST_GUILD_ID?.trim();

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: payload });
    logger.info({ guildId, clientId }, 'deployed sports guild application commands');
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), { body: payload });
  logger.info({ clientId }, 'deployed sports global application commands');
}

void deploy();

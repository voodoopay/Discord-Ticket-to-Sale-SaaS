import { REST, Routes } from 'discord.js';
import { getEnv, logger } from '@voodoo/core';

import { activationCommand } from './commands/activation.js';

function resolveDeployConfig(): { token: string; clientId: string } {
  const env = getEnv();
  const token = env.AI_DISCORD_TOKEN.trim();
  const clientId = env.AI_DISCORD_CLIENT_ID.trim();

  if (token.length === 0) {
    throw new Error('AI_DISCORD_TOKEN is required to deploy AI worker commands.');
  }

  if (clientId.length === 0) {
    throw new Error('AI_DISCORD_CLIENT_ID is required to deploy AI worker commands.');
  }

  return { token, clientId };
}

async function deploy(): Promise<void> {
  const { token, clientId } = resolveDeployConfig();
  const rest = new REST({ version: '10' }).setToken(token);
  const payload = [activationCommand.data.toJSON()];
  const guildId = process.env.DISCORD_TEST_GUILD_ID?.trim();

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: payload });
    logger.info({ guildId, clientId }, 'deployed ai-worker guild application commands');
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), { body: payload });
  logger.info({ clientId }, 'deployed ai-worker global application commands');
}

void deploy();

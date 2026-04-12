import { GatewayIntentBits, type ClientOptions } from 'discord.js';

export function createChannelCopyClientOptions(): ClientOptions {
  return {
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
  };
}

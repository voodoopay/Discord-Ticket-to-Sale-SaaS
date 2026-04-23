import { GatewayIntentBits, type ClientOptions } from 'discord.js';

export function createAiClientOptions(): ClientOptions {
  return {
    intents: [GatewayIntentBits.Guilds],
  };
}

export function mapAiWorkerError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'AI worker failed due to an internal error.';
}

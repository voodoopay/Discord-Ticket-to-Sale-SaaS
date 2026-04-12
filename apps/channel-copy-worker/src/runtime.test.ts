import { GatewayIntentBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { createChannelCopyClientOptions } from './runtime.js';

describe('channel-copy runtime', () => {
  it('requests message content so source message bodies are available to the worker', () => {
    const options = createChannelCopyClientOptions();

    expect(options.intents).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.MessageContent,
    ]);
  });
});

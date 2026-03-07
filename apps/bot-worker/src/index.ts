import { Client, Collection, Events, GatewayIntentBits, MessageFlags, type Interaction } from 'discord.js';
import { getEnv, logger } from '@voodoo/core';

import { saleCommand } from './commands/sale.js';
import { pointsCommand } from './commands/points.js';
import { handlePaidOrderFulfillment } from './commands/paid-order-fulfillment.js';
import { handleReferModal, referCommand } from './commands/refer.js';
import {
  handleSaleAction,
  handleSaleBack,
  handleSaleButtonStart,
  handleSaleCancel,
  handleSaleModal,
  handleSaleSelect,
} from './commands/sale-interactions.js';

type Command = {
  data: { name: string };
  execute: (interaction: any) => Promise<void>;
};

const env = getEnv();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const commands = new Collection<string, Command>();
commands.set(saleCommand.data.name, saleCommand as unknown as Command);
commands.set(pointsCommand.data.name, pointsCommand as unknown as Command);
commands.set(referCommand.data.name, referCommand as unknown as Command);

client.once(Events.ClientReady, () => {
  logger.info({ botUser: client.user?.tag }, 'bot-worker ready');
});

async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) {
        await interaction.reply({
          content: `Unknown command: ${interaction.commandName}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await command.execute(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('sale:start:')) {
      await handleSaleSelect(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('sale:modal:')) {
      await handleSaleModal(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('refer:modal:')) {
      await handleReferModal(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'sale:start') {
      await handleSaleButtonStart(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('sale:back:')) {
      await handleSaleBack(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('sale:action:')) {
      await handleSaleAction(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'sale:cancel') {
      await handleSaleCancel(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('paid-order:fulfillment:')) {
      await handlePaidOrderFulfillment(interaction);
      return;
    }
  } catch (error) {
    logger.error({ err: error }, 'interaction handler failed');

    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: 'An error occurred while handling this interaction.',
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: 'An error occurred while handling this interaction.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction);
});

void client.login(env.DISCORD_TOKEN);

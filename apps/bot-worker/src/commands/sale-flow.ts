import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import { SaleService, TenantRepository, type SaleCheckoutOption } from '@voodoo/core';

import { canStartSale } from '../permissions/sale-permissions.js';
import { createSaleDraft } from '../flows/sale-draft-store.js';

const tenantRepository = new TenantRepository();
const saleService = new SaleService();

function normalizeCategoryLabel(category: string): string {
  const trimmed = category.trim();
  if (!trimmed) {
    return 'Uncategorized';
  }

  return trimmed;
}

async function resolveTenantFromGuild(guildId: string): Promise<{ tenantId: string; guildId: string } | null> {
  return tenantRepository.getTenantByGuildId(guildId);
}

async function enforceSalePreconditions(input: {
  guildId: string;
  channelId: string;
  member: GuildMember;
}): Promise<
  | { ok: true; tenantId: string; tipEnabled: boolean; defaultCurrency: string }
  | { ok: false; message: string }
> {
  const tenant = await resolveTenantFromGuild(input.guildId);
  if (!tenant) {
    return { ok: false, message: 'This guild is not connected to any tenant in the SaaS dashboard.' };
  }

  const configResult = await saleService.getGuildRuntimeConfig({
    tenantId: tenant.tenantId,
    guildId: input.guildId,
  });

  if (configResult.isErr()) {
    return { ok: false, message: configResult.error.message };
  }

  if (!canStartSale(input.member, configResult.value.staffRoleIds)) {
    return {
      ok: false,
      message:
        'You are missing required permissions to start sales here. Configure staff roles or use Manage Server.',
    };
  }

  return {
    ok: true,
    tenantId: tenant.tenantId,
    tipEnabled: configResult.value.tipEnabled,
    defaultCurrency: configResult.value.defaultCurrency,
  };
}

async function runSaleStart(input: {
  guildId: string;
  channel: GuildTextBasedChannel;
  member: GuildMember;
  staffUserId: string;
  customerUserId: string;
  editReply: (payload: { content: string; components?: ActionRowBuilder<StringSelectMenuBuilder>[] }) => Promise<unknown>;
}): Promise<void> {
  const preconditions = await enforceSalePreconditions({
    guildId: input.guildId,
    channelId: input.channel.id,
    member: input.member,
  });

  if (!preconditions.ok) {
    await input.editReply({ content: preconditions.message, components: [] });
    return;
  }

  const botMemberId = input.member.guild.members.me?.id;
  const botPerms =
    botMemberId && 'permissionsFor' in input.channel ? input.channel.permissionsFor(botMemberId) : null;

  if (!botPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    await input.editReply({
      content: 'I am missing channel permissions (View Channel / Send Messages) to run sale actions in this ticket.',
      components: [],
    });
    return;
  }

  const optionsResult = await saleService.getSaleOptions({
    tenantId: preconditions.tenantId,
    guildId: input.guildId,
  });

  if (optionsResult.isErr()) {
    await input.editReply({ content: optionsResult.error.message, components: [] });
    return;
  }

  const products = optionsResult.value.filter((product) => product.variants.length > 0);
  if (products.length === 0) {
    await input.editReply({
      content: [
        'No active products/variants are configured for this server yet.',
        `Server ID: \`${input.guildId}\``,
        'Check dashboard: select this exact server, ensure product is Active, and each product has at least one price option.',
      ].join('\n'),
      components: [],
    });
    return;
  }

  const categoryCounts = new Map<string, { label: string; productCount: number }>();
  for (const product of products) {
    const normalizedCategory = normalizeCategoryLabel(product.category);
    const key = normalizedCategory.toLowerCase();
    const existing = categoryCounts.get(key);
    if (existing) {
      existing.productCount += 1;
      continue;
    }

    categoryCounts.set(key, {
      label: normalizedCategory,
      productCount: 1,
    });
  }

  const categoryOptions = Array.from(categoryCounts.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((category) => ({
      label: category.label.slice(0, 100),
      description: `${category.productCount} product(s)`.slice(0, 100),
      value: category.label,
    }));

  if (categoryOptions.length === 0) {
    await input.editReply({
      content: [
        'No active products/variants are configured for this server yet.',
        `Server ID: \`${input.guildId}\``,
        'Check dashboard: select this exact server, ensure product is Active, and each product has at least one price option.',
      ].join('\n'),
      components: [],
    });
    return;
  }

  const draft = createSaleDraft({
    tenantId: preconditions.tenantId,
    guildId: input.guildId,
    ticketChannelId: input.channel.id,
    staffDiscordUserId: input.staffUserId,
    customerDiscordUserId: input.customerUserId,
    tipEnabled: preconditions.tipEnabled,
    defaultCurrency: preconditions.defaultCurrency,
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`sale:start:${draft.id}:category`)
    .setPlaceholder('Select category')
    .addOptions(categoryOptions.slice(0, 25));

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await input.editReply({
    content: `Step 1/4: Select category for <@${input.customerUserId}>`,
    components: [row],
  });
}

export async function startSaleFlowFromCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.channel || !interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used inside a Discord server channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const customer = interaction.options.getUser('customer') ?? interaction.user;

  await runSaleStart({
    guildId: interaction.guildId,
    channel: interaction.channel,
    member,
    staffUserId: interaction.user.id,
    customerUserId: customer.id,
    editReply: interaction.editReply.bind(interaction),
  });
}

export async function startSaleFlowFromButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId || !interaction.channel || !interaction.guild) {
    await interaction.reply({
      content: 'This button can only be used inside a Discord server channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const member = await interaction.guild.members.fetch(interaction.user.id);

  await runSaleStart({
    guildId: interaction.guildId,
    channel: interaction.channel,
    member,
    staffUserId: interaction.user.id,
    customerUserId: interaction.user.id,
    editReply: interaction.editReply.bind(interaction),
  });
}

export async function sendCheckoutMessage(
  channel: GuildTextBasedChannel,
  input: {
    checkoutUrl: string;
    checkoutOptions?: SaleCheckoutOption[];
    orderSessionId: string;
    customerDiscordUserId: string;
  },
): Promise<void> {
  const isSendable = (channel as { isSendable?: () => boolean }).isSendable;
  if (typeof isSendable === 'function' && !isSendable.call(channel)) {
    throw new Error(
      'Bot cannot post checkout messages in this channel. Check Send Messages permissions and thread state.',
    );
  }

  await channel.send({
    content: [
      `Sale created for <@${input.customerDiscordUserId}>.`,
      `Order Session: \`${input.orderSessionId}\``,
      'Choose payment method below.',
      '',
      'Payment update will be posted here once paid. This may take up to 30 minutes. Do NOT pay again.',
    ].join('\n'),
    embeds: [buildCheckoutLinksEmbed({ checkoutUrl: input.checkoutUrl, checkoutOptions: input.checkoutOptions })],
  });
}

function toMaskedLink(label: string, url: string): string {
  const safeUrl = url.replace(/\)/g, '%29');
  return `[${label}](<${safeUrl}>)`;
}

export function buildCheckoutLinkLines(input: {
  checkoutUrl: string;
  checkoutOptions?: SaleCheckoutOption[];
}): string[] {
  const checkoutOptions =
    input.checkoutOptions && input.checkoutOptions.length > 0
      ? input.checkoutOptions
      : [{ method: 'pay' as const, label: 'Pay', url: input.checkoutUrl }];

  if (checkoutOptions.length === 1 && checkoutOptions[0]?.method === 'pay') {
    return [`${toMaskedLink('Click Here To Pay', checkoutOptions[0].url)}`];
  }

  return checkoutOptions.slice(0, 5).map((option) => `- ${toMaskedLink(option.label, option.url)}`);
}

export function buildCheckoutLinksEmbed(input: {
  checkoutUrl: string;
  checkoutOptions?: SaleCheckoutOption[];
}): EmbedBuilder {
  return new EmbedBuilder().setTitle('Payment Options').setDescription(buildCheckoutLinkLines(input).join('\n'));
}


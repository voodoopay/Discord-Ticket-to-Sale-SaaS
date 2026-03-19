import {
  ChannelType,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type CacheType,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type InteractionDeferReplyOptions,
  type InteractionReplyOptions,
  type Message,
  type ModalSubmitInteraction,
  type PartialMessage,
  type Role,
  type TextBasedChannel,
} from 'discord.js';
import {
  AppError,
  JoinGateAccessService,
  JoinGateService,
  SaleService,
  TenantRepository,
  logger,
  type JoinGateConfigInput,
  type JoinGateLookupType,
  type JoinGateMessageLike,
} from '@voodoo/core';
import { ulid } from 'ulid';

import {
  EMAIL_INPUT_ID,
  PANEL_EMBED_TITLE,
  buildJoinGateEmailModal,
  buildJoinGatePrompt,
  buildJoinGateStatusMessage,
  lookupFailureMessage,
  parseJoinGateModalCustomId,
  parseJoinGateStartCustomId,
  sanitizeTicketChannelName,
  shortStatusLabel,
  type JoinGateStatusMessageInput,
} from './join-gate-ui.js';

const tenantRepository = new TenantRepository();
const joinGateService = new JoinGateService();
const joinGateAccessService = new JoinGateAccessService();
const saleService = new SaleService();

type GuildConfigRecord = NonNullable<Awaited<ReturnType<TenantRepository['getGuildConfig']>>>;

type JoinGateContext = {
  tenantId: string;
  config: GuildConfigRecord;
  guild: Guild;
};

type JoinGateStatusSummary = JoinGateStatusMessageInput & {
  config: GuildConfigRecord;
};

type LookupSyncResult = {
  clearedCount: number;
  messagesScanned: number;
  emailsIndexed: number;
};

type FullSyncResult = {
  currentCustomer: LookupSyncResult;
  newCustomer: LookupSyncResult;
};

type InstallPanelResult = {
  channelId: string;
  messageId: string;
  created: boolean;
};

type FetchableTextChannel = TextBasedChannel & {
  id: string;
  messages: {
    fetch: (options?: { limit?: number; before?: string }) => Promise<Map<string, Message>>;
  };
  send: (options: string | Record<string, unknown>) => Promise<Message>;
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getMissingJoinGateConfigFields(config: GuildConfigRecord): string[] {
  if (!config.joinGateEnabled) {
    return [];
  }

  const configInput: JoinGateConfigInput = {
    joinGateEnabled: config.joinGateEnabled,
    joinGateFallbackChannelId: config.joinGateFallbackChannelId,
    joinGateVerifiedRoleId: config.joinGateVerifiedRoleId,
    joinGateTicketCategoryId: config.joinGateTicketCategoryId,
    joinGateCurrentLookupChannelId: config.joinGateCurrentLookupChannelId,
    joinGateNewLookupChannelId: config.joinGateNewLookupChannelId,
  };

  const missing: string[] = [];
  if (!hasText(configInput.joinGateFallbackChannelId)) {
    missing.push('Fallback verify channel');
  }
  if (!hasText(configInput.joinGateVerifiedRoleId)) {
    missing.push('Verified role');
  }
  if (!hasText(configInput.joinGateTicketCategoryId)) {
    missing.push('Ticket category');
  }
  if (!hasText(configInput.joinGateCurrentLookupChannelId)) {
    missing.push('Current-customer lookup channel');
  }
  if (!hasText(configInput.joinGateNewLookupChannelId)) {
    missing.push('New-customer lookup channel');
  }

  return missing;
}

function privateReplyOptions(interaction: Interaction<CacheType>): InteractionReplyOptions | null {
  return interaction.inGuild() ? { flags: MessageFlags.Ephemeral as const } : null;
}

function privateDeferReplyOptions(interaction: Interaction<CacheType>): InteractionDeferReplyOptions | undefined {
  return interaction.inGuild() ? { flags: MessageFlags.Ephemeral as const } : undefined;
}

function toJoinGateMessageLike(message: Pick<Message, 'content' | 'embeds'>): JoinGateMessageLike {
  return {
    content: message.content,
    embeds: message.embeds.map((embed) => ({
      title: embed.title,
      description: embed.description,
      fields: embed.fields.map((field) => ({
        name: field.name,
        value: field.value,
      })),
      footer: embed.footer?.text ? { text: embed.footer.text } : null,
      author: embed.author?.name ? { name: embed.author.name } : null,
    })),
  };
}

function isTextMessageChannel(channel: unknown): channel is FetchableTextChannel {
  return typeof channel === 'object' && channel !== null && 'send' in channel && 'messages' in channel;
}

async function resolveJoinGateContext(guild: Guild): Promise<JoinGateContext | null> {
  const tenant = await tenantRepository.getTenantByGuildId(guild.id);
  if (!tenant) {
    return null;
  }

  const config = await tenantRepository.getGuildConfig({
    tenantId: tenant.tenantId,
    guildId: guild.id,
  });
  if (!config) {
    return null;
  }

  return {
    tenantId: tenant.tenantId,
    config,
    guild,
  };
}

async function isJoinGateActivatedForContext(context: JoinGateContext): Promise<boolean> {
  const activationState = await joinGateAccessService.getGuildActivationState({
    tenantId: context.tenantId,
    guildId: context.guild.id,
  });
  if (activationState.isErr()) {
    throw activationState.error;
  }

  return activationState.value.activated;
}

async function requireActivatedJoinGate(context: JoinGateContext): Promise<void> {
  if (await isJoinGateActivatedForContext(context)) {
    return;
  }

  throw new AppError(
    'JOIN_GATE_LOCKED',
    'This join-gate worker is locked for this server. A super admin must activate this server by granting a Discord ID access before verification can run.',
    403,
  );
}

async function safeIsJoinGateActivatedForContext(input: {
  context: JoinGateContext;
  logEvent: string;
  extra?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    return await isJoinGateActivatedForContext(input.context);
  } catch (error) {
    logger.error(
      {
        err: error,
        guildId: input.context.guild.id,
        tenantId: input.context.tenantId,
        ...input.extra,
      },
      input.logEvent,
    );
    return false;
  }
}

async function resolveGuildMember(input: {
  client: Client;
  guildId: string;
  userId: string;
}): Promise<{ guild: Guild; member: GuildMember }> {
  const guild = input.client.guilds.cache.get(input.guildId) ?? (await input.client.guilds.fetch(input.guildId));
  const member = await guild.members.fetch(input.userId);

  return { guild, member };
}

async function resolveBotMember(guild: Guild): Promise<GuildMember | null> {
  try {
    return await guild.members.fetchMe();
  } catch {
    return guild.members.me ?? null;
  }
}

function detectLookupType(config: GuildConfigRecord, channelId: string): JoinGateLookupType | null {
  if (config.joinGateCurrentLookupChannelId === channelId) {
    return 'current_customer';
  }
  if (config.joinGateNewLookupChannelId === channelId) {
    return 'new_customer';
  }

  return null;
}

async function describeRuntimeWarnings(guild: Guild, config: GuildConfigRecord): Promise<string[]> {
  const warnings: string[] = [];
  const botMember = await resolveBotMember(guild);
  if (!botMember) {
    warnings.push('The bot member is not available in this server yet.');
    return warnings;
  }

  const guildPermissions = botMember.permissions;
  if (!guildPermissions.has(PermissionFlagsBits.ManageChannels)) {
    warnings.push('Missing guild permission: Manage Channels');
  }
  if (!guildPermissions.has(PermissionFlagsBits.ManageRoles)) {
    warnings.push('Missing guild permission: Manage Roles');
  }
  if (!guildPermissions.has(PermissionFlagsBits.KickMembers)) {
    warnings.push('Missing guild permission: Kick Members');
  }

  const verifiedRole = hasText(config.joinGateVerifiedRoleId)
    ? guild.roles.cache.get(config.joinGateVerifiedRoleId)
    : null;
  if (hasText(config.joinGateVerifiedRoleId) && !verifiedRole) {
    warnings.push('Configured verified role no longer exists.');
  }
  if (verifiedRole && botMember.roles.highest.comparePositionTo(verifiedRole) <= 0) {
    warnings.push('The bot role must be above the configured verified role.');
  }

  const fallbackChannel = hasText(config.joinGateFallbackChannelId)
    ? await guild.channels.fetch(config.joinGateFallbackChannelId).catch(() => null)
    : null;
  if (hasText(config.joinGateFallbackChannelId)) {
    if (!fallbackChannel || !isTextMessageChannel(fallbackChannel)) {
      warnings.push('Configured fallback verify channel is missing or not text-based.');
    } else {
      const perms = fallbackChannel.permissionsFor(botMember);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        warnings.push('Fallback verify channel is missing View Channel or Send Messages for the bot.');
      }
    }
  }

  for (const lookup of [
    { label: 'Current-customer lookup channel', channelId: config.joinGateCurrentLookupChannelId },
    { label: 'New-customer lookup channel', channelId: config.joinGateNewLookupChannelId },
  ]) {
    if (!hasText(lookup.channelId)) {
      continue;
    }

    const channel = await guild.channels.fetch(lookup.channelId).catch(() => null);
    if (!channel || !isTextMessageChannel(channel)) {
      warnings.push(`${lookup.label} is missing or not text-based.`);
      continue;
    }

    const perms = channel.permissionsFor(botMember);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
      warnings.push(`${lookup.label} is missing View Channel or Read Message History for the bot.`);
    }
  }

  if (hasText(config.joinGateTicketCategoryId)) {
    const category = await guild.channels.fetch(config.joinGateTicketCategoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      warnings.push('Configured ticket category is missing or not a category channel.');
    } else {
      const perms = category.permissionsFor(botMember);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
        warnings.push('Ticket category is missing View Channel or Manage Channels for the bot.');
      }
    }
  }

  if (config.joinGateEnabled) {
    warnings.push(
      'Developer Portal requirement: enable GUILD_MEMBERS and MESSAGE_CONTENT privileged intents for the join-gate bot.',
    );
  }

  return warnings;
}
export async function getJoinGateStatusSummary(guild: Guild): Promise<JoinGateStatusSummary> {
  const context = await resolveJoinGateContext(guild);
  if (!context) {
    throw new AppError('JOIN_GATE_GUILD_NOT_CONNECTED', 'This server is not connected to a tenant configuration.', 404);
  }

  const missingConfig = getMissingJoinGateConfigFields(context.config);
  const runtimeWarnings = await describeRuntimeWarnings(guild, context.config);
  const [currentLookupCountResult, newLookupCountResult] = await Promise.all([
    hasText(context.config.joinGateCurrentLookupChannelId)
      ? joinGateService.countLookupEntries({
          tenantId: context.tenantId,
          guildId: guild.id,
          lookupType: 'current_customer',
          sourceChannelId: context.config.joinGateCurrentLookupChannelId,
        })
      : Promise.resolve({ isErr: () => false, value: 0 } as const),
    hasText(context.config.joinGateNewLookupChannelId)
      ? joinGateService.countLookupEntries({
          tenantId: context.tenantId,
          guildId: guild.id,
          lookupType: 'new_customer',
          sourceChannelId: context.config.joinGateNewLookupChannelId,
        })
      : Promise.resolve({ isErr: () => false, value: 0 } as const),
  ]);

  if (currentLookupCountResult.isErr()) {
    throw currentLookupCountResult.error;
  }
  if (newLookupCountResult.isErr()) {
    throw newLookupCountResult.error;
  }

  return {
    config: context.config,
    missingConfig,
    runtimeWarnings,
    currentLookupCount: currentLookupCountResult.value,
    newLookupCount: newLookupCountResult.value,
  };
}

function requireEnabledJoinGate(context: JoinGateContext): void {
  if (!context.config.joinGateEnabled) {
    throw new AppError('JOIN_GATE_DISABLED', 'Join gate is disabled for this server.', 409);
  }

  const missingConfig = getMissingJoinGateConfigFields(context.config);
  if (missingConfig.length > 0) {
    throw new AppError(
      'JOIN_GATE_CONFIG_INCOMPLETE',
      `Join gate is enabled but incomplete: ${missingConfig.join(', ')}`,
      422,
    );
  }
}

async function requireTextChannel(guild: Guild, channelId: string, label: string): Promise<FetchableTextChannel> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !isTextMessageChannel(channel)) {
    throw new AppError('JOIN_GATE_CHANNEL_INVALID', `${label} is missing or not text-based.`, 422);
  }

  return channel;
}

async function syncLookupSourceChannel(
  context: JoinGateContext,
  lookupType: JoinGateLookupType,
  channelId: string,
): Promise<LookupSyncResult> {
  const clearResult = await joinGateService.clearLookupSource({
    tenantId: context.tenantId,
    guildId: context.guild.id,
    lookupType,
    sourceChannelId: channelId,
  });
  if (clearResult.isErr()) {
    throw clearResult.error;
  }

  const channel = await requireTextChannel(
    context.guild,
    channelId,
    lookupType === 'current_customer' ? 'Current-customer lookup channel' : 'New-customer lookup channel',
  );

  let before: string | undefined;
  let messagesScanned = 0;
  let emailsIndexed = 0;

  while (true) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });

    if (batch.size === 0) {
      break;
    }

    const messages = [...batch.values()];
    for (const message of messages) {
      const syncResult = await joinGateService.syncLookupMessage({
        tenantId: context.tenantId,
        guildId: context.guild.id,
        lookupType,
        sourceChannelId: channelId,
        sourceMessageId: message.id,
        message: toJoinGateMessageLike(message),
      });
      if (syncResult.isErr()) {
        throw syncResult.error;
      }

      messagesScanned += 1;
      emailsIndexed += syncResult.value.emails.length;
    }

    if (messages.length < 100) {
      break;
    }

    before = messages[messages.length - 1]?.id;
    if (!before) {
      break;
    }
  }

  return {
    clearedCount: clearResult.value,
    messagesScanned,
    emailsIndexed,
  };
}

export async function syncConfiguredLookupChannelsForGuild(guild: Guild): Promise<FullSyncResult> {
  const context = await resolveJoinGateContext(guild);
  if (!context) {
    throw new AppError('JOIN_GATE_GUILD_NOT_CONNECTED', 'This server is not connected to a tenant configuration.', 404);
  }

  await requireActivatedJoinGate(context);
  requireEnabledJoinGate(context);

  const currentChannelId = context.config.joinGateCurrentLookupChannelId;
  const newChannelId = context.config.joinGateNewLookupChannelId;
  if (!hasText(currentChannelId) || !hasText(newChannelId)) {
    throw new AppError('JOIN_GATE_CONFIG_INCOMPLETE', 'Lookup channels are not configured.', 422);
  }

  const currentCustomer = await syncLookupSourceChannel(context, 'current_customer', currentChannelId);
  const newCustomer = await syncLookupSourceChannel(context, 'new_customer', newChannelId);

  return {
    currentCustomer,
    newCustomer,
  };
}

export async function installOrRefreshFallbackPanel(guild: Guild): Promise<InstallPanelResult> {
  const context = await resolveJoinGateContext(guild);
  if (!context) {
    throw new AppError('JOIN_GATE_GUILD_NOT_CONNECTED', 'This server is not connected to a tenant configuration.', 404);
  }

  await requireActivatedJoinGate(context);
  requireEnabledJoinGate(context);

  const fallbackChannelId = context.config.joinGateFallbackChannelId;
  if (!hasText(fallbackChannelId)) {
    throw new AppError('JOIN_GATE_CONFIG_INCOMPLETE', 'Fallback verify channel is not configured.', 422);
  }

  const channel = await requireTextChannel(guild, fallbackChannelId, 'Fallback verify channel');
  const payload = buildJoinGatePrompt({
    guildId: guild.id,
    guildName: guild.name,
    delivery: 'fallback',
  });

  const recentMessages = await channel.messages.fetch({ limit: 25 });
  const existing = [...recentMessages.values()].find(
    (message) => message.author.id === guild.client.user?.id && message.embeds[0]?.title === PANEL_EMBED_TITLE,
  );

  if (existing) {
    await existing.edit(payload);
    return {
      channelId: channel.id,
      messageId: existing.id,
      created: false,
    };
  }

  const created = await channel.send(payload);
  return {
    channelId: channel.id,
    messageId: created.id,
    created: true,
  };
}

type VerificationResources = {
  botMember: GuildMember;
  verifiedRole: Role;
  ticketCategory: CategoryChannel;
};

async function resolveVerificationResources(context: JoinGateContext): Promise<VerificationResources> {
  const botMember = await resolveBotMember(context.guild);
  if (!botMember) {
    throw new AppError('JOIN_GATE_BOT_MEMBER_MISSING', 'The bot member is not available in this server yet.', 500);
  }

  if (!botMember.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
    throw new AppError(
      'JOIN_GATE_PERMISSIONS_MISSING',
      'The join-gate bot is missing Manage Channels or Manage Roles in this server.',
      403,
    );
  }

  const verifiedRoleId = context.config.joinGateVerifiedRoleId;
  if (!hasText(verifiedRoleId)) {
    throw new AppError('JOIN_GATE_CONFIG_INCOMPLETE', 'Verified role is not configured.', 422);
  }
  const verifiedRole = context.guild.roles.cache.get(verifiedRoleId);
  if (!verifiedRole) {
    throw new AppError('JOIN_GATE_ROLE_MISSING', 'The configured verified role no longer exists.', 422);
  }
  if (botMember.roles.highest.comparePositionTo(verifiedRole) <= 0) {
    throw new AppError(
      'JOIN_GATE_ROLE_HIERARCHY_INVALID',
      'The join-gate bot role must be above the configured verified role.',
      422,
    );
  }

  const ticketCategoryId = context.config.joinGateTicketCategoryId;
  if (!hasText(ticketCategoryId)) {
    throw new AppError('JOIN_GATE_CONFIG_INCOMPLETE', 'Ticket category is not configured.', 422);
  }
  const rawCategory = await context.guild.channels.fetch(ticketCategoryId).catch(() => null);
  if (!rawCategory || rawCategory.type !== ChannelType.GuildCategory) {
    throw new AppError('JOIN_GATE_CATEGORY_INVALID', 'The configured ticket category is missing or invalid.', 422);
  }

  const perms = rawCategory.permissionsFor(botMember);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
    throw new AppError(
      'JOIN_GATE_CATEGORY_PERMISSIONS_MISSING',
      'The bot needs View Channel and Manage Channels in the ticket category.',
      403,
    );
  }

  return {
    botMember,
    verifiedRole,
    ticketCategory: rawCategory,
  };
}

function buildTicketOpeningMessage(input: {
  memberId: string;
  email: string;
  path: JoinGateLookupType;
}): string {
  return [
    `Verification ticket opened for <@${input.memberId}>.`,
    `Email: \`${input.email}\``,
    `Status: ${shortStatusLabel(input.path)}`,
    '',
    'Staff can continue the conversation with this member here.',
  ].join('\n');
}

async function createVerificationTicket(input: {
  context: JoinGateContext;
  member: GuildMember;
  path: JoinGateLookupType;
  email: string;
  resources: VerificationResources;
}): Promise<{ channelId: string }> {
  const ticketChannel = await input.context.guild.channels.create({
    name: sanitizeTicketChannelName(input.member.displayName || input.member.user.username, ulid()),
    type: ChannelType.GuildText,
    parent: input.resources.ticketCategory.id,
    permissionOverwrites: [
      {
        id: input.context.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: input.member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: input.resources.botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
      ...Array.from(new Set(input.context.config.staffRoleIds)).map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      })),
    ],
  });

  const ticketFlagResult = await saleService.setTicketChannelFlag({
    tenantId: input.context.tenantId,
    guildId: input.context.guild.id,
    channelId: ticketChannel.id,
    isTicket: true,
  });
  if (ticketFlagResult.isErr()) {
    throw ticketFlagResult.error;
  }

  await ticketChannel.send({
    content: buildTicketOpeningMessage({
      memberId: input.member.id,
      email: input.email,
      path: input.path,
    }),
  });

  await input.member.roles.add(input.resources.verifiedRole, 'Join gate verification succeeded.');

  const completeResult = await joinGateService.completeVerification({
    tenantId: input.context.tenantId,
    guildId: input.context.guild.id,
    discordUserId: input.member.id,
    ticketChannelId: ticketChannel.id,
  });
  if (completeResult.isErr()) {
    throw completeResult.error;
  }

  return {
    channelId: ticketChannel.id,
  };
}

export async function handleMemberJoin(member: GuildMember): Promise<void> {
  const context = await resolveJoinGateContext(member.guild);
  if (!context || !context.config.joinGateEnabled) {
    return;
  }

  if (
    !(await safeIsJoinGateActivatedForContext({
      context,
      logEvent: 'join gate activation check failed during member join',
      extra: { memberId: member.id },
    }))
  ) {
    return;
  }

  const registerResult = await joinGateService.registerJoin({
    tenantId: context.tenantId,
    guildId: member.guild.id,
    discordUserId: member.id,
  });
  if (registerResult.isErr()) {
    logger.error({ err: registerResult.error, guildId: member.guild.id, memberId: member.id }, 'join gate register join failed');
    return;
  }

  try {
    await member.send(
      buildJoinGatePrompt({
        guildId: member.guild.id,
        guildName: member.guild.name,
        delivery: 'dm',
      }),
    );

    const statusResult = await joinGateService.markDmStatus({
      tenantId: context.tenantId,
      guildId: member.guild.id,
      discordUserId: member.id,
      dmStatus: 'sent',
    });
    if (statusResult.isErr()) {
      logger.warn({ err: statusResult.error, guildId: member.guild.id, memberId: member.id }, 'join gate failed to record sent dm');
    }
  } catch (error) {
    const statusResult = await joinGateService.markDmStatus({
      tenantId: context.tenantId,
      guildId: member.guild.id,
      discordUserId: member.id,
      dmStatus: 'blocked',
    });
    if (statusResult.isErr()) {
      logger.warn({ err: statusResult.error, guildId: member.guild.id, memberId: member.id }, 'join gate failed to record blocked dm');
    }

    logger.warn({ err: error, guildId: member.guild.id, memberId: member.id }, 'join gate dm prompt failed');
  }
}

export async function handleJoinGateButton(interaction: ButtonInteraction): Promise<boolean> {
  const parsed = parseJoinGateStartCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  try {
    const { guild, member } = await resolveGuildMember({
      client: interaction.client,
      guildId: parsed.guildId,
      userId: interaction.user.id,
    });
    const context = await resolveJoinGateContext(guild);
    if (!context) {
      throw new AppError('JOIN_GATE_GUILD_NOT_CONNECTED', 'This server is not connected to a tenant configuration.', 404);
    }

    await requireActivatedJoinGate(context);
    requireEnabledJoinGate(context);

    const setSelectionResult = await joinGateService.setSelection({
      tenantId: context.tenantId,
      guildId: guild.id,
      discordUserId: member.id,
      path: parsed.path,
    });
    if (setSelectionResult.isErr()) {
      throw setSelectionResult.error;
    }

    await interaction.showModal(buildJoinGateEmailModal(guild.id, parsed.path));
  } catch (error) {
    const replyOptions = privateReplyOptions(interaction);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: mapJoinGateError(error),
        ...(replyOptions ?? {}),
      });
    } else {
      await interaction.reply({
        content: mapJoinGateError(error),
        ...(replyOptions ?? {}),
      });
    }
  }

  return true;
}

export async function handleJoinGateModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const parsed = parseJoinGateModalCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  await interaction.deferReply(privateDeferReplyOptions(interaction));

  try {
    const { guild, member } = await resolveGuildMember({
      client: interaction.client,
      guildId: parsed.guildId,
      userId: interaction.user.id,
    });
    const context = await resolveJoinGateContext(guild);
    if (!context) {
      throw new AppError('JOIN_GATE_GUILD_NOT_CONNECTED', 'This server is not connected to a tenant configuration.', 404);
    }

    await requireActivatedJoinGate(context);
    requireEnabledJoinGate(context);

    const email = interaction.fields.getTextInputValue(EMAIL_INPUT_ID);
    const submitResult = await joinGateService.submitEmail({
      tenantId: context.tenantId,
      guildId: guild.id,
      discordUserId: member.id,
      path: parsed.path,
      email,
    });
    if (submitResult.isErr()) {
      throw submitResult.error;
    }

    if (submitResult.value.status === 'already_verified') {
      await interaction.editReply({ content: 'You are already verified in this server.' });
      return true;
    }

    if (submitResult.value.status === 'already_kicked') {
      await interaction.editReply({
        content: 'Your verification access is already closed. Please contact staff directly if you need help.',
      });
      return true;
    }

    if (submitResult.value.status === 'retry') {
      await interaction.editReply({
        content: `${lookupFailureMessage(parsed.path)} Attempts remaining: ${submitResult.value.attemptsRemaining}.`,
      });
      return true;
    }

    if (submitResult.value.status === 'kick_required') {
      await interaction.editReply({
        content: `${lookupFailureMessage(parsed.path)} You have reached the maximum number of attempts and will now be removed from the server.`,
      });

      try {
        await member.kick('Join-gate verification failed after 3 email attempts.');
        const markKickedResult = await joinGateService.markKicked({
          tenantId: context.tenantId,
          guildId: guild.id,
          discordUserId: member.id,
        });
        if (markKickedResult.isErr()) {
          logger.warn({ err: markKickedResult.error, guildId: guild.id, memberId: member.id }, 'join gate failed to persist kicked status');
        }
      } catch (error) {
        const replyOptions = privateReplyOptions(interaction);

        await interaction.followUp({
          content:
            'I could not remove you from the server because the bot is missing Kick Members or the role hierarchy is too low.',
          ...(replyOptions ?? {}),
        });
        logger.warn({ err: error, guildId: guild.id, memberId: member.id }, 'join gate member kick failed');
      }

      return true;
    }

    const resources = await resolveVerificationResources(context);
    const ticket = await createVerificationTicket({
      context,
      member,
      path: parsed.path,
      email: submitResult.value.email.emailDisplay,
      resources,
    });

    await interaction.editReply({
      content: `Your email was confirmed and your private staff ticket is ready: <#${ticket.channelId}>. Access has been unlocked.`,
    });
  } catch (error) {
    await interaction.editReply({ content: mapJoinGateError(error) });
  }

  return true;
}

export async function handleLookupMessageUpsert(message: Message | PartialMessage): Promise<void> {
  if (!message.guildId || !message.channelId) {
    return;
  }

  const guild = message.guild ?? (await message.client.guilds.fetch(message.guildId).catch(() => null));
  if (!guild) {
    return;
  }

  const context = await resolveJoinGateContext(guild);
  if (!context || !context.config.joinGateEnabled) {
    return;
  }

  if (
    !(await safeIsJoinGateActivatedForContext({
      context,
      logEvent: 'join gate activation check failed during lookup message upsert',
      extra: { channelId: message.channelId, messageId: message.id },
    }))
  ) {
    return;
  }

  const lookupType = detectLookupType(context.config, message.channelId);
  if (!lookupType) {
    return;
  }

  const fullMessage = message.partial ? await message.fetch().catch(() => null) : message;
  if (!fullMessage) {
    return;
  }

  const syncResult = await joinGateService.syncLookupMessage({
    tenantId: context.tenantId,
    guildId: guild.id,
    lookupType,
    sourceChannelId: message.channelId,
    sourceMessageId: fullMessage.id,
    message: toJoinGateMessageLike(fullMessage),
  });
  if (syncResult.isErr()) {
    logger.error({ err: syncResult.error, guildId: guild.id, channelId: message.channelId, messageId: fullMessage.id }, 'join gate lookup sync failed');
  }
}

export async function handleLookupMessageDelete(message: Message | PartialMessage): Promise<void> {
  if (!message.guildId || !message.channelId) {
    return;
  }

  const guild = message.guild ?? (await message.client.guilds.fetch(message.guildId).catch(() => null));
  if (!guild) {
    return;
  }

  const context = await resolveJoinGateContext(guild);
  if (!context || !context.config.joinGateEnabled) {
    return;
  }

  if (
    !(await safeIsJoinGateActivatedForContext({
      context,
      logEvent: 'join gate activation check failed during lookup message delete',
      extra: { channelId: message.channelId, messageId: message.id },
    }))
  ) {
    return;
  }

  const lookupType = detectLookupType(context.config, message.channelId);
  if (!lookupType) {
    return;
  }

  const deleteResult = await joinGateService.deleteLookupMessage({
    tenantId: context.tenantId,
    guildId: guild.id,
    lookupType,
    sourceChannelId: message.channelId,
    sourceMessageId: message.id,
  });
  if (deleteResult.isErr()) {
    logger.error({ err: deleteResult.error, guildId: guild.id, channelId: message.channelId, messageId: message.id }, 'join gate lookup delete failed');
  }
}

export function mapJoinGateError(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Join gate worker failed due to an unexpected error. Please try again and check logs.';
}

export async function runJoinGateStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const summary = await getJoinGateStatusSummary(interaction.guild!);
  await interaction.editReply({ content: buildJoinGateStatusMessage(summary) });
}

export async function runJoinGateSync(interaction: ChatInputCommandInteraction): Promise<void> {
  const result = await syncConfiguredLookupChannelsForGuild(interaction.guild!);
  await interaction.editReply({
    content: [
      'Lookup index sync completed.',
      `Current-customer lookup: ${result.currentCustomer.messagesScanned} message(s), ${result.currentCustomer.emailsIndexed} email(s), ${result.currentCustomer.clearedCount} stale row(s) cleared.`,
      `New-customer lookup: ${result.newCustomer.messagesScanned} message(s), ${result.newCustomer.emailsIndexed} email(s), ${result.newCustomer.clearedCount} stale row(s) cleared.`,
    ].join('\n'),
  });
}

export async function runJoinGateInstall(interaction: ChatInputCommandInteraction): Promise<void> {
  const result = await installOrRefreshFallbackPanel(interaction.guild!);
  await interaction.editReply({
    content: `${result.created ? 'Posted' : 'Refreshed'} the fallback verify panel in <#${result.channelId}>.`,
  });
}

export function bindJoinGateReadyHandlers(client: Client): void {
  client.once(Events.ClientReady, () => {
    logger.info({ botUser: client.user?.tag }, 'join-gate-worker ready');
    void (async () => {
      for (const guild of client.guilds.cache.values()) {
        try {
          const context = await resolveJoinGateContext(guild);
          if (!context || !context.config.joinGateEnabled) {
            continue;
          }

          if (
            !(await safeIsJoinGateActivatedForContext({
              context,
              logEvent: 'join gate activation check failed during startup sync',
            }))
          ) {
            continue;
          }

          await syncConfiguredLookupChannelsForGuild(guild);
          logger.info({ guildId: guild.id }, 'join gate startup lookup sync finished');
        } catch (error) {
          logger.warn({ err: error, guildId: guild.id }, 'join gate startup lookup sync failed');
        }
      }
    })();
  });
}

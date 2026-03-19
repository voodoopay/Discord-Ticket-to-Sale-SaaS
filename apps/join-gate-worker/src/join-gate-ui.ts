import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export type JoinGateUiLookupType = 'current_customer' | 'new_customer';

export type JoinGateStatusMessageInput = {
  config: {
    joinGateStaffRoleIds?: string[];
    joinGateEnabled?: boolean;
    joinGateFallbackChannelId?: string | null;
    joinGateVerifiedRoleId?: string | null;
    joinGateTicketCategoryId?: string | null;
    joinGateCurrentLookupChannelId?: string | null;
    joinGateNewLookupChannelId?: string | null;
    joinGatePanelTitle?: string | null;
    joinGatePanelMessage?: string | null;
  };
  missingConfig: string[];
  runtimeWarnings: string[];
  currentLookupCount: number;
  newLookupCount: number;
};

export const JOIN_GATE_START_PREFIX = 'join-gate:start';
export const JOIN_GATE_RESEND_DM_PREFIX = 'join-gate:resend-dm';
export const JOIN_GATE_MODAL_PREFIX = 'join-gate:email';
export const DEFAULT_JOIN_GATE_PANEL_TITLE = 'Verify Server Access';
export const PANEL_EMBED_TITLE = DEFAULT_JOIN_GATE_PANEL_TITLE;
export const EMAIL_INPUT_ID = 'email';

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function channelMention(channelId: string | null | undefined): string {
  return hasText(channelId) ? `<#${channelId}>` : 'Not configured';
}

function roleMention(roleId: string | null | undefined): string {
  return hasText(roleId) ? `<@&${roleId}>` : 'Not configured';
}

function roleMentions(roleIds: string[] | null | undefined): string {
  if (!roleIds || roleIds.length === 0) {
    return 'None configured';
  }

  return roleIds.map((roleId) => `<@&${roleId}>`).join(', ');
}

function compactPreview(value: string | null | undefined, fallback: string): string {
  if (!hasText(value)) {
    return fallback;
  }

  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= 90) {
    return `"${compact}"`;
  }

  return `"${compact.slice(0, 87)}..."`;
}

function buildPromptDescription(input: {
  guildName: string;
  delivery: 'dm' | 'fallback';
  panelMessage?: string | null;
}): string {
  const lines: string[] = [];

  if (input.delivery === 'dm') {
    lines.push(`Welcome to **${input.guildName}**.`);
  } else if (hasText(input.panelMessage)) {
    lines.push(input.panelMessage.trim());
    lines.push(`Use the buttons below if you just joined **${input.guildName}** and cannot see the rest of the server yet.`);
  } else {
    lines.push(`Use this panel if you just joined **${input.guildName}** and cannot see the rest of the server yet.`);
  }

  lines.push('Choose whether you are a current customer or a new customer, then enter your email address.');
  lines.push('If your email is confirmed, the bot will open a private ticket with staff and unlock your verified role.');
  lines.push('After 3 failed email attempts, you will be removed from the server.');

  if (input.delivery === 'fallback') {
    lines.push('If your DM did not arrive, use the Resend DM button below.');
  }

  return lines.join('\n');
}

export function buildJoinGateButtons(guildId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${JOIN_GATE_START_PREFIX}:${guildId}:current_customer`)
      .setLabel('Current Customer')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${JOIN_GATE_START_PREFIX}:${guildId}:new_customer`)
      .setLabel('New Customer')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function buildJoinGateResendDmButton(guildId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${JOIN_GATE_RESEND_DM_PREFIX}:${guildId}`)
      .setLabel('Resend DM')
      .setStyle(ButtonStyle.Success),
  );
}

export function buildJoinGatePrompt(input: {
  guildId: string;
  guildName: string;
  delivery: 'dm' | 'fallback';
  panelTitle?: string | null;
  panelMessage?: string | null;
}) {
  const embed = new EmbedBuilder()
    .setTitle(input.delivery === 'fallback' && hasText(input.panelTitle) ? input.panelTitle.trim() : PANEL_EMBED_TITLE)
    .setDescription(buildPromptDescription(input));

  return {
    embeds: [embed],
    components:
      input.delivery === 'fallback'
        ? [buildJoinGateButtons(input.guildId), buildJoinGateResendDmButton(input.guildId)]
        : [buildJoinGateButtons(input.guildId)],
  };
}

export function parseJoinGateStartCustomId(
  customId: string,
): { guildId: string; path: JoinGateUiLookupType } | null {
  const parts = customId.split(':');
  if (parts.length !== 4) {
    return null;
  }
  if (`${parts[0]}:${parts[1]}` !== JOIN_GATE_START_PREFIX) {
    return null;
  }

  const guildId = parts[2]?.trim();
  const path = parts[3]?.trim();
  if (!hasText(guildId)) {
    return null;
  }
  if (path !== 'current_customer' && path !== 'new_customer') {
    return null;
  }

  return { guildId, path };
}

export function parseJoinGateModalCustomId(
  customId: string,
): { guildId: string; path: JoinGateUiLookupType } | null {
  const parts = customId.split(':');
  if (parts.length !== 4) {
    return null;
  }
  if (`${parts[0]}:${parts[1]}` !== JOIN_GATE_MODAL_PREFIX) {
    return null;
  }

  const guildId = parts[2]?.trim();
  const path = parts[3]?.trim();
  if (!hasText(guildId)) {
    return null;
  }
  if (path !== 'current_customer' && path !== 'new_customer') {
    return null;
  }

  return { guildId, path };
}

export function parseJoinGateResendDmCustomId(customId: string): { guildId: string } | null {
  const parts = customId.split(':');
  if (parts.length !== 3) {
    return null;
  }
  if (`${parts[0]}:${parts[1]}` !== JOIN_GATE_RESEND_DM_PREFIX) {
    return null;
  }

  const guildId = parts[2]?.trim();
  if (!hasText(guildId)) {
    return null;
  }

  return { guildId };
}

export function buildJoinGateEmailModal(guildId: string, path: JoinGateUiLookupType): ModalBuilder {
  const title = path === 'current_customer' ? 'Current Customer Verification' : 'New Customer Verification';
  const input = new TextInputBuilder()
    .setCustomId(EMAIL_INPUT_ID)
    .setLabel('Email Address')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('name@example.com')
    .setRequired(true)
    .setMaxLength(320);

  return new ModalBuilder()
    .setCustomId(`${JOIN_GATE_MODAL_PREFIX}:${guildId}:${path}`)
    .setTitle(title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export function shortStatusLabel(path: JoinGateUiLookupType): string {
  return path === 'current_customer' ? 'confirmed customer' : 'new customer email confirmed';
}

export function lookupFailureMessage(path: JoinGateUiLookupType): string {
  return path === 'current_customer'
    ? 'No customer email connected to this email address. Try again.'
    : 'No referral or email connected to this email address. Try again.';
}

export function sanitizeTicketChannelName(baseName: string, suffix: string): string {
  const normalizedBase = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const safeBase = normalizedBase.length > 0 ? normalizedBase : 'member';
  const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 6) || 'verify';

  return `verify-${safeBase}-${safeSuffix}`.slice(0, 90);
}

export function buildJoinGateStatusMessage(input: JoinGateStatusMessageInput): string {
  const lines = [
    `Join Gate: ${input.config.joinGateEnabled ? 'Enabled' : 'Disabled'}`,
    `Fallback verify channel: ${channelMention(input.config.joinGateFallbackChannelId)}`,
    `Verified role: ${roleMention(input.config.joinGateVerifiedRoleId)}`,
    `Ticket category: ${channelMention(input.config.joinGateTicketCategoryId)}`,
    `Staff roles: ${roleMentions(input.config.joinGateStaffRoleIds)}`,
    `Fallback panel title: ${compactPreview(input.config.joinGatePanelTitle, `Default (${DEFAULT_JOIN_GATE_PANEL_TITLE})`)}`,
    `Fallback panel message: ${compactPreview(input.config.joinGatePanelMessage, 'Default welcome message')}`,
    `Current-customer lookup: ${channelMention(input.config.joinGateCurrentLookupChannelId)} (${input.currentLookupCount} indexed email(s))`,
    `New-customer lookup: ${channelMention(input.config.joinGateNewLookupChannelId)} (${input.newLookupCount} indexed email(s))`,
  ];

  if (input.missingConfig.length > 0) {
    lines.push(`Missing config: ${input.missingConfig.join(', ')}`);
  } else {
    lines.push('Missing config: none');
  }

  if (input.runtimeWarnings.length > 0) {
    lines.push('Runtime warnings:');
    for (const warning of input.runtimeWarnings) {
      lines.push(`- ${warning}`);
    }
  } else {
    lines.push('Runtime warnings: none');
  }

  return lines.join('\n');
}

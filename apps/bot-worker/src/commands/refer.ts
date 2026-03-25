import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { ReferralService, TenantRepository, getEnv, postMessageToDiscordChannel } from '@voodoo/core';

const tenantRepository = new TenantRepository();
const referralService = new ReferralService();
const env = getEnv();
const DEFAULT_REFERRAL_SUBMISSION_TEMPLATE =
  'Referral submitted successfully. We will reward points automatically after the first paid order.';

function buildReferModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId('refer:modal:submit').setTitle('Referral Submission');

  const referrerEmail = new TextInputBuilder()
    .setCustomId('referrer_email')
    .setLabel('Your email')
    .setRequired(true)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(320)
    .setPlaceholder('you@example.com');

  const referredEmail = new TextInputBuilder()
    .setCustomId('referred_email')
    .setLabel('New customer email')
    .setRequired(true)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(320)
    .setPlaceholder('newcustomer@example.com');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(referrerEmail),
    new ActionRowBuilder<TextInputBuilder>().addComponents(referredEmail),
  );

  return modal;
}

function renderSubmissionTemplate(input: {
  template: string | null | undefined;
  submitterDiscordId: string;
  referrerEmail: string;
  referredEmail: string;
}): string {
  const template =
    typeof input.template === 'string' && input.template.trim().length > 0
      ? input.template
      : DEFAULT_REFERRAL_SUBMISSION_TEMPLATE;

  const values: Record<string, string> = {
    submitter_mention: `<@${input.submitterDiscordId}>`,
    referrer_email: input.referrerEmail,
    referred_email: input.referredEmail,
  };

  return template.replace(/\{([a-z_]+)\}/gi, (token, key: string) => values[key.toLowerCase()] ?? token);
}

function formatSubmissionOutcomeMessage(input: {
  status: 'accepted' | 'duplicate' | 'self_blocked';
  successTemplate: string | null | undefined;
  submitterDiscordId: string;
  referrerEmail: string;
  referredEmail: string;
}): string {
  if (input.status === 'accepted') {
    return renderSubmissionTemplate({
      template: input.successTemplate,
      submitterDiscordId: input.submitterDiscordId,
      referrerEmail: input.referrerEmail,
      referredEmail: input.referredEmail,
    });
  }

  if (input.status === 'duplicate') {
    return 'This customer email already has a referral claim on record. The first valid claim remains active.';
  }

  return 'Referral blocked: your email and the new customer email cannot be the same.';
}

function formatReferralSubmissionLog(input: {
  submitterDiscordId: string;
  guildId: string;
  referrerEmail: string;
  referredEmail: string;
  status: 'accepted' | 'duplicate' | 'self_blocked';
}): string {
  const safeReferrer = input.referrerEmail.replace(/`/g, "'");
  const safeReferred = input.referredEmail.replace(/`/g, "'");

  return [
    '**Referral Submission**',
    `Server: \`${input.guildId}\``,
    `Submitter: <@${input.submitterDiscordId}>`,
    `Referrer Email: \`${safeReferrer}\``,
    `Referred Email: \`${safeReferred}\``,
    `Result: \`${input.status}\``,
  ].join('\n');
}

async function postReferralSubmissionLog(input: {
  referralLogChannelId: string | null;
  submitterDiscordId: string;
  guildId: string;
  referrerEmail: string;
  referredEmail: string;
  status: 'accepted' | 'duplicate' | 'self_blocked';
}): Promise<void> {
  if (!input.referralLogChannelId) {
    return;
  }

  await postMessageToDiscordChannel({
    botToken: env.DISCORD_TOKEN,
    channelId: input.referralLogChannelId,
    content: formatReferralSubmissionLog({
      submitterDiscordId: input.submitterDiscordId,
      guildId: input.guildId,
      referrerEmail: input.referrerEmail,
      referredEmail: input.referredEmail,
      status: input.status,
    }),
  });
}

export const referCommand = {
  data: new SlashCommandBuilder()
    .setName('refer')
    .setDescription('Submit a referral using your email and the new customer email'),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used inside a Discord server channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const tenant = await tenantRepository.getTenantByGuildId(interaction.guildId);
    if (!tenant) {
      await interaction.reply({
        content: 'This server is not connected to a merchant store yet.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const config = await tenantRepository.getGuildConfig({
      tenantId: tenant.tenantId,
      guildId: interaction.guildId,
    });
    if (!config?.referralsEnabled) {
      await interaction.reply({
        content: 'Referrals are currently disabled for this server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(buildReferModal());
  },
};

export async function handleReferModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.editReply({
      content: 'This referral form can only be submitted inside a Discord server channel.',
    });
    return;
  }

  const tenant = await tenantRepository.getTenantByGuildId(interaction.guildId);
  if (!tenant) {
    await interaction.editReply({
      content: 'This server is not connected to a merchant store yet.',
    });
    return;
  }

  const referrerEmailRaw = interaction.fields.getTextInputValue('referrer_email');
  const referredEmailRaw = interaction.fields.getTextInputValue('referred_email');

  const created = await referralService.createClaimFromCommand({
    tenantId: tenant.tenantId,
    guildId: interaction.guildId,
    referrerDiscordUserId: interaction.user.id,
    referrerEmail: referrerEmailRaw,
    referredEmail: referredEmailRaw,
  });

  if (created.isErr()) {
    await interaction.editReply({
      content: created.error.message,
    });
    return;
  }

  const config = await tenantRepository.getGuildConfig({
    tenantId: tenant.tenantId,
    guildId: interaction.guildId,
  });

  try {
    await postReferralSubmissionLog({
      referralLogChannelId: config?.referralLogChannelId ?? null,
      submitterDiscordId: interaction.user.id,
      guildId: interaction.guildId,
      referrerEmail: referrerEmailRaw.trim(),
      referredEmail: referredEmailRaw.trim(),
      status: created.value.status,
    });
  } catch {
    // Do not fail user-facing referral response if owner log posting fails.
  }

  await interaction.editReply({
    content: formatSubmissionOutcomeMessage({
      status: created.value.status,
      successTemplate: config?.referralSubmissionTemplate,
      submitterDiscordId: interaction.user.id,
      referrerEmail: referrerEmailRaw.trim(),
      referredEmail: referredEmailRaw.trim(),
    }),
  });
}

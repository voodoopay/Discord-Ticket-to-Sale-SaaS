import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import type { FormFieldValidation, TenantMemberRole } from '../../../domain/types.js';

export const users = mysqlTable(
  'users',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    discordUserId: varchar('discord_user_id', { length: 32 }).notNull(),
    username: varchar('username', { length: 100 }).notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    discordUserIdUnique: uniqueIndex('users_discord_user_id_uq').on(table.discordUserId),
  }),
);

export const superAdmins = mysqlTable(
  'super_admins',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    userId: varchar('user_id', { length: 26 }).notNull(),
    discordUserId: varchar('discord_user_id', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    discordUserIdUnique: uniqueIndex('super_admins_discord_user_id_uq').on(table.discordUserId),
    userIdUnique: uniqueIndex('super_admins_user_id_uq').on(table.userId),
  }),
);

export const tenants = mysqlTable(
  'tenants',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    status: mysqlEnum('status', ['active', 'disabled']).notNull().default('active'),
    ownerUserId: varchar('owner_user_id', { length: 26 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('tenants_status_idx').on(table.status),
    createdAtIdx: index('tenants_created_at_idx').on(table.createdAt),
  }),
);

export const tenantMembers = mysqlTable(
  'tenant_members',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    userId: varchar('user_id', { length: 26 }).notNull(),
    role: mysqlEnum('role', ['owner', 'admin', 'member']).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantUserUnique: uniqueIndex('tenant_members_tenant_user_uq').on(table.tenantId, table.userId),
    tenantIdx: index('tenant_members_tenant_idx').on(table.tenantId),
  }),
);

export const tenantGuilds = mysqlTable(
  'tenant_guilds',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    guildName: varchar('guild_name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildUnique: uniqueIndex('tenant_guilds_tenant_guild_uq').on(table.tenantId, table.guildId),
    tenantGuildIdx: index('tenant_guilds_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('tenant_guilds_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const telegramChatLinks = mysqlTable(
  'telegram_chat_links',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    chatId: varchar('chat_id', { length: 32 }).notNull(),
    chatTitle: varchar('chat_title', { length: 120 }).notNull(),
    linkedByDiscordUserId: varchar('linked_by_discord_user_id', { length: 32 }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    chatIdUnique: uniqueIndex('telegram_chat_links_chat_id_uq').on(table.chatId),
    tenantGuildUnique: uniqueIndex('telegram_chat_links_tenant_guild_uq').on(table.tenantId, table.guildId),
    tenantGuildIdx: index('telegram_chat_links_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('telegram_chat_links_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const guildConfigs = mysqlTable(
  'guild_configs',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    paidLogChannelId: varchar('paid_log_channel_id', { length: 32 }),
    staffRoleIds: json('staff_role_ids').$type<string[]>().notNull().default([]),
    defaultCurrency: varchar('default_currency', { length: 3 }).notNull().default('USD'),
    couponsEnabled: boolean('coupons_enabled').notNull().default(true),
    pointsEnabled: boolean('points_enabled').notNull().default(true),
    referralsEnabled: boolean('referrals_enabled').notNull().default(true),
    telegramEnabled: boolean('telegram_enabled').notNull().default(false),
    tipEnabled: boolean('tip_enabled').notNull().default(false),
    pointsEarnCategoryKeys: json('points_earn_category_keys').$type<string[]>().notNull().default([]),
    pointsRedeemCategoryKeys: json('points_redeem_category_keys').$type<string[]>().notNull().default([]),
    pointValueMinor: int('point_value_minor').notNull().default(1),
    referralRewardMinor: int('referral_reward_minor').notNull().default(0),
    referralRewardCategoryKeys: json('referral_reward_category_keys').$type<string[]>().notNull().default([]),
    referralLogChannelId: varchar('referral_log_channel_id', { length: 32 }),
    referralThankYouTemplate: text('referral_thank_you_template')
      .notNull()
      .default(
        'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.',
      ),
    referralSubmissionTemplate: text('referral_submission_template')
      .notNull()
      .default(
        'Referral submitted successfully. We will reward points automatically after the first paid order.',
      ),
    ticketMetadataKey: varchar('ticket_metadata_key', { length: 64 }).notNull().default('isTicket'),
    joinGateEnabled: boolean('join_gate_enabled').notNull().default(false),
    joinGateStaffRoleIds: json('join_gate_staff_role_ids').$type<string[]>().notNull().default([]),
    joinGateFallbackChannelId: varchar('join_gate_fallback_channel_id', { length: 32 }),
    joinGateVerifiedRoleId: varchar('join_gate_verified_role_id', { length: 32 }),
    joinGateTicketCategoryId: varchar('join_gate_ticket_category_id', { length: 32 }),
    joinGateCurrentLookupChannelId: varchar('join_gate_current_lookup_channel_id', { length: 32 }),
    joinGateNewLookupChannelId: varchar('join_gate_new_lookup_channel_id', { length: 32 }),
    joinGatePanelTitle: varchar('join_gate_panel_title', { length: 120 }),
    joinGatePanelMessage: text('join_gate_panel_message'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildUnique: uniqueIndex('guild_configs_tenant_guild_uq').on(table.tenantId, table.guildId),
    tenantGuildIdx: index('guild_configs_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('guild_configs_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const joinGateMembers = mysqlTable(
  'join_gate_members',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    discordUserId: varchar('discord_user_id', { length: 32 }).notNull(),
    status: mysqlEnum('status', ['pending', 'awaiting_email', 'matched', 'verified', 'kicked'])
      .notNull()
      .default('pending'),
    selectedPath: mysqlEnum('selected_path', ['current_customer', 'new_customer']),
    failedAttempts: int('failed_attempts').notNull().default(0),
    verifiedEmailNormalized: varchar('verified_email_normalized', { length: 320 }),
    verifiedEmailDisplay: varchar('verified_email_display', { length: 320 }),
    ticketChannelId: varchar('ticket_channel_id', { length: 32 }),
    dmStatus: mysqlEnum('dm_status', ['unknown', 'sent', 'blocked', 'failed']).notNull().default('unknown'),
    joinedAt: timestamp('joined_at', { mode: 'date' }).defaultNow().notNull(),
    selectedAt: timestamp('selected_at', { mode: 'date' }),
    matchedAt: timestamp('matched_at', { mode: 'date' }),
    verifiedAt: timestamp('verified_at', { mode: 'date' }),
    kickedAt: timestamp('kicked_at', { mode: 'date' }),
    dmSentAt: timestamp('dm_sent_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildUserUnique: uniqueIndex('join_gate_members_tenant_guild_user_uq').on(
      table.tenantId,
      table.guildId,
      table.discordUserId,
    ),
    tenantGuildStatusIdx: index('join_gate_members_tenant_guild_status_idx').on(
      table.tenantId,
      table.guildId,
      table.status,
    ),
    tenantGuildIdx: index('join_gate_members_tenant_guild_idx').on(table.tenantId, table.guildId),
  }),
);

export const joinGateEmailIndex = mysqlTable(
  'join_gate_email_index',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    lookupType: mysqlEnum('lookup_type', ['current_customer', 'new_customer']).notNull(),
    sourceChannelId: varchar('source_channel_id', { length: 32 }).notNull(),
    sourceMessageId: varchar('source_message_id', { length: 32 }).notNull(),
    emailNormalized: varchar('email_normalized', { length: 320 }).notNull(),
    emailDisplay: varchar('email_display', { length: 320 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    messageEmailUnique: uniqueIndex('join_gate_email_index_tenant_guild_type_message_email_uq').on(
      table.tenantId,
      table.guildId,
      table.lookupType,
      table.sourceMessageId,
      table.emailNormalized,
    ),
    lookupEmailIdx: index('join_gate_email_index_lookup_email_idx').on(
      table.tenantId,
      table.guildId,
      table.lookupType,
      table.emailNormalized,
    ),
    messageIdx: index('join_gate_email_index_message_idx').on(table.sourceChannelId, table.sourceMessageId),
    tenantGuildIdx: index('join_gate_email_index_tenant_guild_idx').on(table.tenantId, table.guildId),
  }),
);

export const joinGateAuthorizedUsers = mysqlTable(
  'join_gate_authorized_users',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    discordUserId: varchar('discord_user_id', { length: 32 }).notNull(),
    grantedByDiscordUserId: varchar('granted_by_discord_user_id', { length: 32 }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildUserUnique: uniqueIndex('join_gate_authorized_users_tenant_guild_user_uq').on(
      table.tenantId,
      table.guildId,
      table.discordUserId,
    ),
    tenantGuildIdx: index('join_gate_authorized_users_tenant_guild_idx').on(
      table.tenantId,
      table.guildId,
    ),
  }),
);

export const discountCoupons = mysqlTable(
  'discount_coupons',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    code: varchar('code', { length: 40 }).notNull(),
    discountMinor: int('discount_minor').notNull(),
    active: boolean('active').notNull().default(true),
    allowedProductIds: json('allowed_product_ids').$type<string[]>().notNull().default([]),
    allowedVariantIds: json('allowed_variant_ids').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildCodeUnique: uniqueIndex('discount_coupons_tenant_guild_code_uq').on(
      table.tenantId,
      table.guildId,
      table.code,
    ),
    tenantGuildIdx: index('discount_coupons_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('discount_coupons_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const products = mysqlTable(
  'products',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    category: varchar('category', { length: 80 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildIdx: index('products_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('products_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const productVariants = mysqlTable(
  'product_variants',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    productId: varchar('product_id', { length: 26 }).notNull(),
    label: varchar('label', { length: 80 }).notNull(),
    priceMinor: int('price_minor').notNull(),
    referralRewardMinor: int('referral_reward_minor').notNull().default(0),
    currency: varchar('currency', { length: 3 }).notNull(),
    wooProductId: varchar('woo_product_id', { length: 64 }),
    wooCheckoutPath: varchar('woo_checkout_path', { length: 255 }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildIdx: index('product_variants_tenant_guild_idx').on(table.tenantId, table.guildId),
    productIdx: index('product_variants_product_idx').on(table.productId),
    tenantCreatedIdx: index('product_variants_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const productFormFields = mysqlTable(
  'product_form_fields',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    productId: varchar('product_id', { length: 26 }).notNull(),
    fieldKey: varchar('field_key', { length: 64 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    fieldType: mysqlEnum('field_type', ['short_text', 'long_text', 'email', 'number']).notNull(),
    required: boolean('required').notNull().default(true),
    sensitive: boolean('sensitive').notNull().default(false),
    sortOrder: int('sort_order').notNull(),
    validation: json('validation').$type<FormFieldValidation | null>(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    productFieldUnique: uniqueIndex('product_form_fields_product_field_uq').on(
      table.productId,
      table.fieldKey,
    ),
    tenantGuildIdx: index('product_form_fields_tenant_guild_idx').on(table.tenantId, table.guildId),
    productSortIdx: index('product_form_fields_product_sort_idx').on(table.productId, table.sortOrder),
    tenantCreatedIdx: index('product_form_fields_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const tenantIntegrationsWoo = mysqlTable(
  'tenant_integrations_woo',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    wpBaseUrl: varchar('wp_base_url', { length: 255 }).notNull(),
    tenantWebhookKey: varchar('tenant_webhook_key', { length: 64 }).notNull(),
    webhookSecretEncrypted: text('webhook_secret_encrypted').notNull(),
    consumerKeyEncrypted: text('consumer_key_encrypted').notNull(),
    consumerSecretEncrypted: text('consumer_secret_encrypted').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildUnique: uniqueIndex('tenant_integrations_woo_tenant_guild_uq').on(
      table.tenantId,
      table.guildId,
    ),
    webhookKeyUnique: uniqueIndex('tenant_integrations_woo_webhook_key_uq').on(table.tenantWebhookKey),
    tenantGuildIdx: index('tenant_integrations_woo_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('tenant_integrations_woo_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const tenantIntegrationsVoodooPay = mysqlTable(
  'tenant_integrations_voodoo_pay',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    merchantWalletAddress: varchar('merchant_wallet_address', { length: 128 }).notNull(),
    cryptoGatewayEnabled: boolean('crypto_gateway_enabled').notNull().default(false),
    cryptoAddFees: boolean('crypto_add_fees').notNull().default(false),
    cryptoWalletEvm: varchar('crypto_wallet_evm', { length: 191 }),
    cryptoWalletBtc: varchar('crypto_wallet_btc', { length: 191 }),
    cryptoWalletBitcoincash: varchar('crypto_wallet_bitcoincash', { length: 191 }),
    cryptoWalletLtc: varchar('crypto_wallet_ltc', { length: 191 }),
    cryptoWalletDoge: varchar('crypto_wallet_doge', { length: 191 }),
    cryptoWalletTrc20: varchar('crypto_wallet_trc20', { length: 191 }),
    cryptoWalletSolana: varchar('crypto_wallet_solana', { length: 191 }),
    checkoutDomain: varchar('checkout_domain', { length: 120 }).notNull().default('checkout.voodoo-pay.uk'),
    tenantWebhookKey: varchar('tenant_webhook_key', { length: 64 }).notNull(),
    callbackSecretEncrypted: text('callback_secret_encrypted').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildUnique: uniqueIndex('tenant_integrations_voodoo_pay_tenant_guild_uq').on(
      table.tenantId,
      table.guildId,
    ),
    webhookKeyUnique: uniqueIndex('tenant_integrations_voodoo_pay_webhook_key_uq').on(
      table.tenantWebhookKey,
    ),
    tenantGuildIdx: index('tenant_integrations_voodoo_pay_tenant_guild_idx').on(
      table.tenantId,
      table.guildId,
    ),
    tenantCreatedIdx: index('tenant_integrations_voodoo_pay_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);

export const orderSessions = mysqlTable(
  'order_sessions',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    ticketChannelId: varchar('ticket_channel_id', { length: 32 }).notNull(),
    staffUserId: varchar('staff_user_id', { length: 32 }).notNull(),
    customerDiscordId: varchar('customer_discord_id', { length: 32 }).notNull(),
    productId: varchar('product_id', { length: 26 }).notNull(),
    variantId: varchar('variant_id', { length: 26 }).notNull(),
    status: mysqlEnum('status', ['pending_payment', 'cancelled', 'paid'])
      .notNull()
      .default('pending_payment'),
    basketItems: json('basket_items')
      .$type<
        Array<{
          productId: string;
          productName: string;
          category: string;
          variantId: string;
          variantLabel: string;
          priceMinor: number;
          currency: string;
        }>
      >()
      .notNull()
      .default([]),
    couponCode: varchar('coupon_code', { length: 40 }),
    couponDiscountMinor: int('coupon_discount_minor').notNull().default(0),
    customerEmailNormalized: varchar('customer_email_normalized', { length: 320 }),
    pointsReserved: int('points_reserved').notNull().default(0),
    pointsDiscountMinor: int('points_discount_minor').notNull().default(0),
    pointsReservationState: mysqlEnum('points_reservation_state', [
      'none',
      'reserved',
      'released_expired',
      'released_cancelled',
      'consumed',
    ])
      .notNull()
      .default('none'),
    pointsConfigSnapshot: json('points_config_snapshot')
      .$type<{
        pointValueMinor: number;
        earnCategoryKeys: string[];
        redeemCategoryKeys: string[];
      }>()
      .notNull()
      .default({
        pointValueMinor: 1,
        earnCategoryKeys: [],
        redeemCategoryKeys: [],
      }),
    referralRewardMinorSnapshot: int('referral_reward_minor_snapshot').notNull().default(0),
    tipMinor: int('tip_minor').notNull().default(0),
    subtotalMinor: int('subtotal_minor').notNull().default(0),
    totalMinor: int('total_minor').notNull().default(0),
    answers: json('answers').$type<Record<string, string>>().notNull().default({}),
    checkoutUrl: text('checkout_url'),
    checkoutUrlCrypto: text('checkout_url_crypto'),
    checkoutTokenExpiresAt: timestamp('checkout_token_expires_at', { mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildIdx: index('order_sessions_tenant_guild_idx').on(table.tenantId, table.guildId),
    ticketChannelIdx: index('order_sessions_ticket_channel_idx').on(table.ticketChannelId),
    tenantCreatedIdx: index('order_sessions_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const referralClaims = mysqlTable(
  'referral_claims',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    referrerDiscordUserId: varchar('referrer_discord_user_id', { length: 32 }).notNull(),
    referrerEmailNormalized: varchar('referrer_email_normalized', { length: 320 }).notNull(),
    referrerEmailDisplay: varchar('referrer_email_display', { length: 320 }).notNull(),
    referredEmailNormalized: varchar('referred_email_normalized', { length: 320 }).notNull(),
    referredEmailDisplay: varchar('referred_email_display', { length: 320 }).notNull(),
    status: mysqlEnum('status', ['active', 'rewarded']).notNull().default('active'),
    rewardOrderSessionId: varchar('reward_order_session_id', { length: 26 }),
    rewardPoints: int('reward_points').notNull().default(0),
    rewardedAt: timestamp('rewarded_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildReferredUnique: uniqueIndex('referral_claims_tenant_guild_referred_email_uq').on(
      table.tenantId,
      table.guildId,
      table.referredEmailNormalized,
    ),
    tenantGuildIdx: index('referral_claims_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('referral_claims_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const customerFirstPaidOrders = mysqlTable(
  'customer_first_paid_orders',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    referredEmailNormalized: varchar('referred_email_normalized', { length: 320 }).notNull(),
    firstOrderSessionId: varchar('first_order_session_id', { length: 26 }).notNull(),
    firstPaidAt: timestamp('first_paid_at', { mode: 'date' }).defaultNow().notNull(),
    claimId: varchar('claim_id', { length: 26 }),
    rewardApplied: boolean('reward_applied').notNull().default(false),
    rewardPoints: int('reward_points').notNull().default(0),
    referralRewardMinorSnapshot: int('referral_reward_minor_snapshot').notNull().default(0),
    pointValueMinorSnapshot: int('point_value_minor_snapshot').notNull().default(1),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildReferredUnique: uniqueIndex('first_paid_orders_tenant_guild_referred_email_uq').on(
      table.tenantId,
      table.guildId,
      table.referredEmailNormalized,
    ),
    tenantGuildIdx: index('first_paid_orders_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('first_paid_orders_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const customerPointsAccounts = mysqlTable(
  'customer_points_accounts',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    emailNormalized: varchar('email_normalized', { length: 320 }).notNull(),
    emailDisplay: varchar('email_display', { length: 320 }).notNull(),
    balancePoints: int('balance_points').notNull().default(0),
    reservedPoints: int('reserved_points').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildEmailUnique: uniqueIndex('customer_points_accounts_tenant_guild_email_uq').on(
      table.tenantId,
      table.guildId,
      table.emailNormalized,
    ),
    tenantGuildIdx: index('customer_points_accounts_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('customer_points_accounts_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const customerPointsLedger = mysqlTable(
  'customer_points_ledger',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    emailNormalized: varchar('email_normalized', { length: 320 }).notNull(),
    deltaPoints: int('delta_points').notNull(),
    eventType: varchar('event_type', { length: 48 }).notNull(),
    orderSessionId: varchar('order_session_id', { length: 26 }),
    actorUserId: varchar('actor_user_id', { length: 26 }),
    metadata: json('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildIdx: index('customer_points_ledger_tenant_guild_idx').on(table.tenantId, table.guildId),
    orderSessionIdx: index('customer_points_ledger_order_session_idx').on(table.orderSessionId),
    tenantCreatedIdx: index('customer_points_ledger_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const ordersPaid = mysqlTable(
  'orders_paid',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    orderSessionId: varchar('order_session_id', { length: 26 }).notNull(),
    wooOrderId: varchar('woo_order_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    priceMinor: int('price_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    paymentReference: varchar('payment_reference', { length: 120 }),
    fulfillmentStatus: mysqlEnum('fulfillment_status', ['needs_action', 'fulfilled'])
      .notNull()
      .default('needs_action'),
    fulfilledAt: timestamp('fulfilled_at', { mode: 'date' }),
    fulfilledByDiscordUserId: varchar('fulfilled_by_discord_user_id', { length: 32 }),
    paidAt: timestamp('paid_at', { mode: 'date' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    orderSessionUnique: uniqueIndex('orders_paid_order_session_uq').on(table.orderSessionId),
    tenantGuildIdx: index('orders_paid_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('orders_paid_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const orderNotesCache = mysqlTable(
  'order_notes_cache',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    orderSessionId: varchar('order_session_id', { length: 26 }).notNull(),
    wooOrderId: varchar('woo_order_id', { length: 128 }).notNull(),
    latestInternalNote: text('latest_internal_note'),
    latestCustomerNote: text('latest_customer_note'),
    fetchedAt: timestamp('fetched_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    orderSessionUnique: uniqueIndex('order_notes_cache_order_session_uq').on(table.orderSessionId),
    tenantGuildIdx: index('order_notes_cache_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('order_notes_cache_tenant_fetched_idx').on(table.tenantId, table.fetchedAt),
  }),
);

export const webhookEvents = mysqlTable(
  'webhook_events',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }),
    provider: mysqlEnum('provider', ['woocommerce', 'voodoopay']).notNull().default('woocommerce'),
    providerDeliveryId: varchar('provider_delivery_id', { length: 80 }).notNull(),
    topic: varchar('topic', { length: 120 }).notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum('status', ['received', 'processed', 'failed', 'duplicate'])
      .notNull()
      .default('received'),
    attemptCount: int('attempt_count').notNull().default(0),
    failureReason: text('failure_reason'),
    nextRetryAt: timestamp('next_retry_at', { mode: 'date' }),
    processedAt: timestamp('processed_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantProviderDeliveryUnique: uniqueIndex('webhook_events_tenant_provider_delivery_uq').on(
      table.tenantId,
      table.provider,
      table.providerDeliveryId,
    ),
    tenantGuildIdx: index('webhook_events_tenant_guild_idx').on(table.tenantId, table.guildId),
    tenantCreatedIdx: index('webhook_events_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const channelNukeSchedules = mysqlTable(
  'channel_nuke_schedules',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    channelId: varchar('channel_id', { length: 32 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    localTimeHhmm: varchar('local_time_hhmm', { length: 5 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    nextRunAtUtc: timestamp('next_run_at_utc', { mode: 'date' }).notNull(),
    lastRunAtUtc: timestamp('last_run_at_utc', { mode: 'date' }),
    lastLocalRunDate: varchar('last_local_run_date', { length: 10 }),
    consecutiveFailures: int('consecutive_failures').notNull().default(0),
    updatedByDiscordUserId: varchar('updated_by_discord_user_id', { length: 32 }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildChannelUnique: uniqueIndex('channel_nuke_schedules_tenant_guild_channel_uq').on(
      table.tenantId,
      table.guildId,
      table.channelId,
    ),
    enabledNextRunIdx: index('channel_nuke_schedules_enabled_next_run_idx').on(
      table.enabled,
      table.nextRunAtUtc,
    ),
    tenantGuildIdx: index('channel_nuke_schedules_tenant_guild_idx').on(table.tenantId, table.guildId),
  }),
);

export const channelNukeRuns = mysqlTable(
  'channel_nuke_runs',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    scheduleId: varchar('schedule_id', { length: 26 }),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    channelId: varchar('channel_id', { length: 32 }).notNull(),
    triggerType: mysqlEnum('trigger_type', ['scheduled', 'manual', 'retry']).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'success', 'partial', 'failed', 'skipped'])
      .notNull()
      .default('queued'),
    attempt: int('attempt').notNull().default(0),
    oldChannelId: varchar('old_channel_id', { length: 32 }),
    newChannelId: varchar('new_channel_id', { length: 32 }),
    errorMessage: text('error_message'),
    actorDiscordUserId: varchar('actor_discord_user_id', { length: 32 }),
    correlationId: varchar('correlation_id', { length: 26 }).notNull(),
    startedAt: timestamp('started_at', { mode: 'date' }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex('channel_nuke_runs_idempotency_uq').on(table.idempotencyKey),
    scheduleIdx: index('channel_nuke_runs_schedule_idx').on(table.scheduleId),
    tenantCreatedIdx: index('channel_nuke_runs_tenant_created_idx').on(table.tenantId, table.createdAt),
  }),
);

export const channelNukeLocks = mysqlTable(
  'channel_nuke_locks',
  {
    lockKey: varchar('lock_key', { length: 96 }).primaryKey(),
    ownerId: varchar('owner_id', { length: 64 }).notNull(),
    leaseUntil: timestamp('lease_until', { mode: 'date' }).notNull(),
    heartbeatAt: timestamp('heartbeat_at', { mode: 'date' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    leaseUntilIdx: index('channel_nuke_locks_lease_until_idx').on(table.leaseUntil),
  }),
);

export const channelNukeAuthorizedUsers = mysqlTable(
  'channel_nuke_authorized_users',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    discordUserId: varchar('discord_user_id', { length: 32 }).notNull(),
    grantedByDiscordUserId: varchar('granted_by_discord_user_id', { length: 32 }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantGuildUserUnique: uniqueIndex('channel_nuke_authorized_users_tenant_guild_user_uq').on(
      table.tenantId,
      table.guildId,
      table.discordUserId,
    ),
    tenantGuildIdx: index('channel_nuke_authorized_users_tenant_guild_idx').on(
      table.tenantId,
      table.guildId,
    ),
  }),
);

export const sportsGuildConfigs = mysqlTable(
  'sports_guild_configs',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    managedCategoryChannelId: varchar('managed_category_channel_id', { length: 32 }),
    localTimeHhmm: varchar('local_time_hhmm', { length: 5 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    broadcastCountry: varchar('broadcast_country', { length: 120 }).notNull(),
    nextRunAtUtc: timestamp('next_run_at_utc', { mode: 'date' }).notNull(),
    lastRunAtUtc: timestamp('last_run_at_utc', { mode: 'date' }),
    lastLocalRunDate: varchar('last_local_run_date', { length: 10 }),
    updatedByDiscordUserId: varchar('updated_by_discord_user_id', { length: 32 }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    guildUnique: uniqueIndex('sports_guild_configs_guild_uq').on(table.guildId),
    enabledNextRunIdx: index('sports_guild_configs_enabled_next_run_idx').on(
      table.enabled,
      table.nextRunAtUtc,
    ),
  }),
);

export const sportsChannelBindings = mysqlTable(
  'sports_channel_bindings',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    sportId: varchar('sport_id', { length: 16 }),
    sportName: varchar('sport_name', { length: 80 }).notNull(),
    sportSlug: varchar('sport_slug', { length: 100 }).notNull(),
    channelId: varchar('channel_id', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    guildSportUnique: uniqueIndex('sports_channel_bindings_guild_sport_uq').on(
      table.guildId,
      table.sportName,
    ),
    guildChannelUnique: uniqueIndex('sports_channel_bindings_guild_channel_uq').on(
      table.guildId,
      table.channelId,
    ),
    guildIdx: index('sports_channel_bindings_guild_idx').on(table.guildId),
  }),
);

export const sportsAuthorizedUsers = mysqlTable(
  'sports_authorized_users',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    discordUserId: varchar('discord_user_id', { length: 32 }).notNull(),
    grantedByDiscordUserId: varchar('granted_by_discord_user_id', { length: 32 }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    guildUserUnique: uniqueIndex('sports_authorized_users_guild_user_uq').on(
      table.guildId,
      table.discordUserId,
    ),
    guildIdx: index('sports_authorized_users_guild_idx').on(table.guildId),
  }),
);

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }),
    userId: varchar('user_id', { length: 26 }),
    actorDiscordUserId: varchar('actor_discord_user_id', { length: 32 }),
    action: varchar('action', { length: 120 }).notNull(),
    resourceType: varchar('resource_type', { length: 80 }).notNull(),
    resourceId: varchar('resource_id', { length: 64 }),
    correlationId: varchar('correlation_id', { length: 26 }).notNull(),
    metadata: json('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantCreatedIdx: index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
    actionIdx: index('audit_logs_action_idx').on(table.action),
  }),
);

export const appSecrets = mysqlTable(
  'app_secrets',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    secretKey: varchar('secret_key', { length: 80 }).notNull(),
    valueEncrypted: text('value_encrypted').notNull(),
    rotatedAt: timestamp('rotated_at', { mode: 'date' }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    secretKeyUnique: uniqueIndex('app_secrets_secret_key_uq').on(table.secretKey),
  }),
);

export const ticketChannelMetadata = mysqlTable(
  'ticket_channel_metadata',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 26 }).notNull(),
    guildId: varchar('guild_id', { length: 32 }).notNull(),
    channelId: varchar('channel_id', { length: 32 }).notNull(),
    isTicket: boolean('is_ticket').notNull().default(true),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    tenantChannelUnique: uniqueIndex('ticket_channel_metadata_tenant_channel_uq').on(
      table.tenantId,
      table.guildId,
      table.channelId,
    ),
    tenantGuildIdx: index('ticket_channel_metadata_tenant_guild_idx').on(table.tenantId, table.guildId),
  }),
);

export type TenantMemberRoleValue = TenantMemberRole;

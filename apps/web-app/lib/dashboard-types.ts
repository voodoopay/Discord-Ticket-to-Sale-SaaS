export type FieldType = 'short_text' | 'long_text' | 'email' | 'number';

export type TenantSummary = {
  id: string;
  name: string;
  status: string;
};

export type TenantMemberRole = 'owner' | 'admin' | 'member';

export type DiscordGuildSummary = {
  id: string;
  name: string;
  iconUrl: string | null;
  owner: boolean;
  permissions: string;
};

export type MeResponse = {
  me: {
    userId: string;
    isSuperAdmin: boolean;
    tenantIds: string[];
  };
  tenants: TenantSummary[];
  discordGuilds: DiscordGuildSummary[];
  discordGuildsError: string;
};

export type GuildResources = {
  botInGuild: boolean;
  inviteUrl: string;
  guild: {
    id: string;
    name: string;
  };
  channels: Array<{
    id: string;
    name: string;
    type: number;
  }>;
  categoryChannels: Array<{
    id: string;
    name: string;
    type: number;
  }>;
  roles: Array<{
    id: string;
    name: string;
    color: number;
    position: number;
  }>;
};

export type GuildConfigRecord = {
  paidLogChannelId: string | null;
  staffRoleIds: string[];
  defaultCurrency: string;
  couponsEnabled: boolean;
  pointsEnabled: boolean;
  referralsEnabled: boolean;
  telegramEnabled: boolean;
  tipEnabled: boolean;
  pointsEarnCategoryKeys: string[];
  pointsRedeemCategoryKeys: string[];
  pointValueMinor: number;
  referralRewardMinor: number;
  referralRewardCategoryKeys: string[];
  referralLogChannelId: string | null;
  referralThankYouTemplate: string;
  referralSubmissionTemplate: string;
  ticketMetadataKey?: string;
  joinGateEnabled: boolean;
  joinGateFallbackChannelId: string | null;
  joinGateVerifiedRoleId: string | null;
  joinGateTicketCategoryId: string | null;
  joinGateCurrentLookupChannelId: string | null;
  joinGateNewLookupChannelId: string | null;
};

export type ProductVariantRecord = {
  id: string;
  label: string;
  priceMinor: number;
  referralRewardMinor: number;
  currency: string;
};

export type ProductFormFieldRecord = {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  sensitive: boolean;
  sortOrder: number;
};

export type ProductRecord = {
  id: string;
  category: string;
  name: string;
  description: string;
  active: boolean;
  variants: ProductVariantRecord[];
  formFields: ProductFormFieldRecord[];
};

export type CouponRecord = {
  id: string;
  code: string;
  discountMinor: number;
  active: boolean;
  allowedCategories: string[];
  allowedProductIds: string[];
  allowedVariantIds: string[];
};

export type PointsCustomerRecord = {
  emailNormalized: string;
  emailDisplay: string;
  balancePoints: number;
  reservedPoints: number;
  availablePoints: number;
};

export type PriceOptionDraft = {
  label: string;
  priceMajor: string;
  referralRewardMajor: string;
  currency: string;
};

export type QuestionDraft = {
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  sensitive: boolean;
  sortOrder: number;
};

export type VoodooCryptoWallets = {
  evm: string;
  btc: string;
  bitcoincash: string;
  ltc: string;
  doge: string;
  trc20: string;
  solana: string;
};

export type VoodooIntegrationRecord = {
  merchantWalletAddress: string;
  cryptoGatewayEnabled: boolean;
  cryptoAddFees: boolean;
  cryptoWallets: VoodooCryptoWallets;
  checkoutDomain: string;
  tenantWebhookKey: string;
  webhookUrl: string;
};

export type TelegramLinkState = {
  enabled: boolean;
  botUsername: string | null;
  inviteUrl: string | null;
  linkedChat: {
    chatId: string;
    chatTitle: string;
    linkedByDiscordUserId: string | null;
    updatedAt: string;
  } | null;
  guildName: string;
};

export type DashboardOverview = {
  timezone: string;
  todayKey: string;
  todaySalesMinor: number;
  todaySalesCount: number;
  paymentsConfigured: boolean;
  cryptoEnabled: boolean;
  couponsEnabled: boolean;
  pointsEnabled: boolean;
  referralsEnabled: boolean;
  telegramEnabled: boolean;
  telegramLinked: boolean;
  recentSales: Array<{
    id: string;
    orderSessionId: string;
    priceMinor: number;
    currency: string;
    status: string;
    fulfillmentStatus: 'needs_action' | 'fulfilled';
    paymentReference: string | null;
    paidAt: string;
    customerEmail: string | null;
    ticketChannelId: string | null;
    productId: string | null;
    variantId: string | null;
  }>;
};

export type WorkspaceMemberRecord = {
  userId: string;
  discordUserId: string;
  username: string;
  avatarUrl: string | null;
  role: TenantMemberRole;
  removable: boolean;
};

export type WorkspaceAccessState = {
  currentRole: TenantMemberRole | null;
  members: WorkspaceMemberRecord[];
  canManageMembers: boolean;
  canDisconnectGuild: boolean;
  canDisconnectTelegram: boolean;
};

'use client';

import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from 'react';

import { dashboardApi } from '@/lib/dashboard-api';
import type {
  DashboardOverview,
  GuildConfigRecord,
  GuildResources,
  ProductRecord,
  TelegramLinkState,
  VoodooIntegrationRecord,
  VoodooCryptoWallets,
} from '@/lib/dashboard-types';

type DashboardFlash = {
  tone: 'success' | 'error' | 'info';
  message: string;
} | null;

type DashboardCategorySummary = {
  name: string;
  productId: string;
  productCount: number;
  activeProductCount: number;
  questionCount: number;
};

type GeneratedTelegramLink = {
  token: string;
  command: string;
  botUsername: string | null;
  inviteUrl: string | null;
  expiresAt: string;
  guildName: string;
};

type SaveIntegrationInput = {
  merchantWalletAddress: string;
  checkoutDomain: string;
  callbackSecret?: string;
  cryptoGatewayEnabled: boolean;
  cryptoAddFees: boolean;
  cryptoWallets: VoodooCryptoWallets;
};

type DashboardContextValue = {
  tenantId: string;
  tenantName: string;
  guildId: string;
  guildName: string;
  initialLoading: boolean;
  refreshing: boolean;
  actionPending: boolean;
  error: string;
  flash: DashboardFlash;
  clearFlash: () => void;
  showFlash: (tone: 'success' | 'error' | 'info', message: string) => void;
  guildLinkTenantId: string | null;
  resources: GuildResources | null;
  config: GuildConfigRecord | null;
  overview: DashboardOverview | null;
  integration: VoodooIntegrationRecord | null;
  telegramState: TelegramLinkState | null;
  products: ProductRecord[];
  categories: DashboardCategorySummary[];
  isLinkedToCurrentTenant: boolean;
  isLinkedToOtherTenant: boolean;
  refreshBase: () => Promise<void>;
  connectGuild: () => Promise<void>;
  saveConfig: (updates: Partial<GuildConfigRecord>) => Promise<GuildConfigRecord>;
  refreshProducts: () => Promise<ProductRecord[]>;
  refreshIntegration: () => Promise<VoodooIntegrationRecord | null>;
  saveIntegration: (payload: SaveIntegrationInput) => Promise<void>;
  refreshOverview: () => Promise<DashboardOverview | null>;
  refreshTelegram: () => Promise<TelegramLinkState | null>;
  generateTelegramLink: () => Promise<GeneratedTelegramLink>;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

const EMPTY_WALLETS: VoodooCryptoWallets = {
  evm: '',
  btc: '',
  bitcoincash: '',
  ltc: '',
  doge: '',
  trc20: '',
  solana: '',
};

function getActionMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function DashboardProvider({
  tenantId,
  tenantName,
  guildId,
  guildName,
  children,
}: {
  tenantId: string;
  tenantName: string;
  guildId: string;
  guildName: string;
  children: ReactNode;
}) {
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState<DashboardFlash>(null);
  const [guildLinkTenantId, setGuildLinkTenantId] = useState<string | null>(null);
  const [resources, setResources] = useState<GuildResources | null>(null);
  const [config, setConfig] = useState<GuildConfigRecord | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [integration, setIntegration] = useState<VoodooIntegrationRecord | null>(null);
  const [telegramState, setTelegramState] = useState<TelegramLinkState | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);

  const refreshProducts = useEffectEvent(async () => {
    if (guildLinkTenantId !== tenantId) {
      setProducts([]);
      return [];
    }

    const response = await dashboardApi<{ products: ProductRecord[] }>(
      `/api/guilds/${encodeURIComponent(guildId)}/products?tenantId=${encodeURIComponent(tenantId)}`,
    );
    setProducts(response.products);
    return response.products;
  });

  const refreshIntegration = useEffectEvent(async () => {
    if (guildLinkTenantId !== tenantId) {
      setIntegration(null);
      return null;
    }

    const response = await dashboardApi<{ integration: VoodooIntegrationRecord | null }>(
      `/api/guilds/${encodeURIComponent(guildId)}/integrations/voodoopay?tenantId=${encodeURIComponent(tenantId)}`,
    );
    setIntegration(response.integration);
    return response.integration;
  });

  const refreshOverview = useEffectEvent(async () => {
    if (guildLinkTenantId !== tenantId) {
      setOverview(null);
      return null;
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await dashboardApi<{ overview: DashboardOverview }>(
      `/api/guilds/${encodeURIComponent(guildId)}/overview?tenantId=${encodeURIComponent(tenantId)}&timeZone=${encodeURIComponent(timeZone)}`,
    );
    setOverview(response.overview);
    return response.overview;
  });

  const refreshTelegram = useEffectEvent(async () => {
    if (guildLinkTenantId !== tenantId) {
      setTelegramState(null);
      return null;
    }

    const response = await dashboardApi<TelegramLinkState>(
      `/api/guilds/${encodeURIComponent(guildId)}/telegram-link-token?tenantId=${encodeURIComponent(tenantId)}`,
    );
    setTelegramState(response);
    return response;
  });

  const loadBaseData = useEffectEvent(async (showRefreshing: boolean) => {
    if (showRefreshing) {
      setRefreshing(true);
    }

    setError('');
    try {
      const [resourcesResponse, linkedResponse] = await Promise.all([
        dashboardApi<GuildResources>(`/api/discord/guilds/${encodeURIComponent(guildId)}/resources`),
        dashboardApi<{ tenantId: string | null }>(
          `/api/guilds/${encodeURIComponent(guildId)}/linked-tenant`,
        ),
      ]);

      setResources(resourcesResponse);
      setGuildLinkTenantId(linkedResponse.tenantId);

      if (linkedResponse.tenantId !== tenantId) {
        setConfig(null);
        setOverview(null);
        setIntegration(null);
        setTelegramState(null);
        setProducts([]);
        return;
      }

      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const [configResponse, integrationResponse, overviewResponse, telegramResponse, productsResponse] =
        await Promise.all([
          dashboardApi<{ config: GuildConfigRecord }>(
            `/api/guilds/${encodeURIComponent(guildId)}/config?tenantId=${encodeURIComponent(tenantId)}`,
          ),
          dashboardApi<{ integration: VoodooIntegrationRecord | null }>(
            `/api/guilds/${encodeURIComponent(guildId)}/integrations/voodoopay?tenantId=${encodeURIComponent(tenantId)}`,
          ),
          dashboardApi<{ overview: DashboardOverview }>(
            `/api/guilds/${encodeURIComponent(guildId)}/overview?tenantId=${encodeURIComponent(tenantId)}&timeZone=${encodeURIComponent(timeZone)}`,
          ),
          dashboardApi<TelegramLinkState>(
            `/api/guilds/${encodeURIComponent(guildId)}/telegram-link-token?tenantId=${encodeURIComponent(tenantId)}`,
          ),
          dashboardApi<{ products: ProductRecord[] }>(
            `/api/guilds/${encodeURIComponent(guildId)}/products?tenantId=${encodeURIComponent(tenantId)}`,
          ),
        ]);

      setConfig(configResponse.config);
      setIntegration(integrationResponse.integration);
      setOverview(overviewResponse.overview);
      setTelegramState(telegramResponse);
      setProducts(productsResponse.products);
    } catch (loadError) {
      setError(getActionMessage(loadError, 'Failed to load dashboard data.'));
    } finally {
      setRefreshing(false);
      setInitialLoading(false);
    }
  });

  useEffect(() => {
    void loadBaseData(false);
  }, [guildId, tenantId]);

  const categories: DashboardCategorySummary[] = (() => {
    const map = new Map<string, DashboardCategorySummary>();

    for (const product of products) {
      const key = product.category.trim().toLowerCase();
      if (!key) {
        continue;
      }

      const existing = map.get(key);
      if (existing) {
        existing.productCount += 1;
        existing.activeProductCount += product.active ? 1 : 0;
        continue;
      }

      map.set(key, {
        name: product.category,
        productId: product.id,
        productCount: 1,
        activeProductCount: product.active ? 1 : 0,
        questionCount: product.formFields.length,
      });
    }

    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
  })();

  async function refreshBase() {
    await loadBaseData(true);
  }

  async function connectGuild() {
    setActionPending(true);
    setFlash(null);
    setError('');
    try {
      await dashboardApi<{ ok: true }>(`/api/guilds/${encodeURIComponent(guildId)}/connect`, 'POST', {
        tenantId,
        guildName,
      });
      await loadBaseData(true);
      setFlash({
        tone: 'success',
        message: 'Discord server linked to the selected workspace.',
      });
    } catch (connectError) {
      setError(getActionMessage(connectError, 'Failed to connect this server.'));
      throw connectError;
    } finally {
      setActionPending(false);
    }
  }

  async function saveConfig(updates: Partial<GuildConfigRecord>) {
    if (!config) {
      throw new Error('Guild configuration is not available until the server is linked.');
    }

    setActionPending(true);
    setFlash(null);
    setError('');
    try {
      const payload: GuildConfigRecord & { tenantId: string } = {
        tenantId,
        paidLogChannelId: updates.paidLogChannelId ?? config.paidLogChannelId,
        staffRoleIds: updates.staffRoleIds ?? config.staffRoleIds,
        defaultCurrency: updates.defaultCurrency ?? config.defaultCurrency,
        couponsEnabled: updates.couponsEnabled ?? config.couponsEnabled,
        pointsEnabled: updates.pointsEnabled ?? config.pointsEnabled,
        referralsEnabled: updates.referralsEnabled ?? config.referralsEnabled,
        telegramEnabled: updates.telegramEnabled ?? config.telegramEnabled,
        tipEnabled: updates.tipEnabled ?? config.tipEnabled,
        pointsEarnCategoryKeys: updates.pointsEarnCategoryKeys ?? config.pointsEarnCategoryKeys,
        pointsRedeemCategoryKeys: updates.pointsRedeemCategoryKeys ?? config.pointsRedeemCategoryKeys,
        pointValueMinor: updates.pointValueMinor ?? config.pointValueMinor,
        referralRewardMinor: updates.referralRewardMinor ?? config.referralRewardMinor,
        referralRewardCategoryKeys:
          updates.referralRewardCategoryKeys ?? config.referralRewardCategoryKeys,
        referralLogChannelId: updates.referralLogChannelId ?? config.referralLogChannelId,
        referralThankYouTemplate:
          updates.referralThankYouTemplate ?? config.referralThankYouTemplate,
        referralSubmissionTemplate:
          updates.referralSubmissionTemplate ?? config.referralSubmissionTemplate,
        ticketMetadataKey: updates.ticketMetadataKey ?? config.ticketMetadataKey,
        joinGateEnabled: updates.joinGateEnabled ?? config.joinGateEnabled,
        joinGateFallbackChannelId:
          updates.joinGateFallbackChannelId ?? config.joinGateFallbackChannelId,
        joinGateVerifiedRoleId: updates.joinGateVerifiedRoleId ?? config.joinGateVerifiedRoleId,
        joinGateTicketCategoryId:
          updates.joinGateTicketCategoryId ?? config.joinGateTicketCategoryId,
        joinGateCurrentLookupChannelId:
          updates.joinGateCurrentLookupChannelId ?? config.joinGateCurrentLookupChannelId,
        joinGateNewLookupChannelId:
          updates.joinGateNewLookupChannelId ?? config.joinGateNewLookupChannelId,
      };

      const response = await dashboardApi<{ config: GuildConfigRecord }>(
        `/api/guilds/${encodeURIComponent(guildId)}/config`,
        'PATCH',
        payload,
      );

      setConfig(response.config);
      await Promise.all([refreshOverview(), refreshTelegram()]);
      setFlash({
        tone: 'success',
        message: 'Settings saved successfully.',
      });
      return response.config;
    } catch (saveError) {
      const message = getActionMessage(saveError, 'Failed to save server settings.');
      setError(message);
      setFlash({
        tone: 'error',
        message,
      });
      throw saveError;
    } finally {
      setActionPending(false);
    }
  }

  async function saveIntegration(payload: SaveIntegrationInput) {
    setActionPending(true);
    setFlash(null);
    setError('');
    try {
      await dashboardApi(
        `/api/guilds/${encodeURIComponent(guildId)}/integrations/voodoopay`,
        'PUT',
        {
          tenantId,
          merchantWalletAddress: payload.merchantWalletAddress,
          checkoutDomain: payload.checkoutDomain,
          callbackSecret: payload.callbackSecret,
          cryptoGatewayEnabled: payload.cryptoGatewayEnabled,
          cryptoAddFees: payload.cryptoAddFees,
          cryptoWallets: payload.cryptoWallets,
        },
      );
      await Promise.all([refreshIntegration(), refreshOverview()]);
      setFlash({
        tone: 'success',
        message: 'Payment settings saved successfully.',
      });
    } catch (saveError) {
      const message = getActionMessage(saveError, 'Failed to save payment settings.');
      setError(message);
      setFlash({
        tone: 'error',
        message,
      });
      throw saveError;
    } finally {
      setActionPending(false);
    }
  }

  async function generateTelegramLink() {
    setActionPending(true);
    setFlash(null);
    setError('');
    try {
      const response = await dashboardApi<GeneratedTelegramLink>(
        `/api/guilds/${encodeURIComponent(guildId)}/telegram-link-token`,
        'POST',
        { tenantId },
      );
      await refreshTelegram();
      setFlash({
        tone: 'success',
        message: 'Telegram connection details refreshed.',
      });
      return response;
    } catch (telegramError) {
      const message = getActionMessage(telegramError, 'Failed to generate a Telegram link.');
      setError(message);
      setFlash({
        tone: 'error',
        message,
      });
      throw telegramError;
    } finally {
      setActionPending(false);
    }
  }

  const value: DashboardContextValue = {
    tenantId,
    tenantName,
    guildId,
    guildName,
    initialLoading,
    refreshing,
    actionPending,
    error,
    flash,
    clearFlash: () => setFlash(null),
    showFlash: (tone, message) => setFlash({ tone, message }),
    guildLinkTenantId,
    resources,
    config,
    overview,
    integration,
    telegramState,
    products,
    categories,
    isLinkedToCurrentTenant: guildLinkTenantId === tenantId,
    isLinkedToOtherTenant: Boolean(guildLinkTenantId && guildLinkTenantId !== tenantId),
    refreshBase,
    connectGuild,
    saveConfig,
    refreshProducts,
    refreshIntegration,
    saveIntegration,
    refreshOverview,
    refreshTelegram,
    generateTelegramLink,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboardContext(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboardContext must be used inside DashboardProvider.');
  }

  return context;
}

export function createEmptyIntegration(): SaveIntegrationInput {
  return {
    merchantWalletAddress: '',
    checkoutDomain: '',
    callbackSecret: '',
    cryptoGatewayEnabled: false,
    cryptoAddFees: false,
    cryptoWallets: EMPTY_WALLETS,
  };
}

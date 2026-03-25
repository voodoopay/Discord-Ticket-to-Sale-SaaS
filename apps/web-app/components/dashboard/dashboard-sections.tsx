'use client';

import {
  ArrowUpRight,
  Bot,
  Copy,
  CreditCard,
  Gift,
  Link2,
  Loader2,
  Package2,
  Plus,
  RefreshCcw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useDeferredValue, useEffect, useEffectEvent, useRef, useState } from 'react';

import { createEmptyIntegration, useDashboardContext } from '@/components/dashboard/dashboard-provider';
import {
  ConfirmationModal,
  FeatureToggle,
  InfoButton,
  InfoTip,
  Panel,
  SectionMenu,
  SectionShell,
  StatusPill,
} from '@/components/dashboard/dashboard-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { dashboardApi } from '@/lib/dashboard-api';
import { getCouponMenuItems, type CouponPanelId } from '@/lib/dashboard-coupon-menu';
import {
  DEFAULT_CURRENCY,
  DEFAULT_POINT_VALUE_MAJOR,
  DEFAULT_REFERRAL_REWARD_MAJOR,
  DEFAULT_REFERRAL_SUBMISSION_TEMPLATE,
  DEFAULT_REFERRAL_THANK_YOU_TEMPLATE,
  ensureRequiredEmailQuestion,
  formatCurrencyMinor,
  formatMinorToMajor,
  formatPointValueMinorToMajor,
  normalizeCategoryKey,
  normalizeCheckoutDomainInput,
  parsePointValueMajorToMinor,
  parsePriceToMinor,
  parseWholePoints,
  previewReferralRewardPoints,
} from '@/lib/dashboard-format';
import {
  shouldLoadCustomerPoints,
  shouldShowCustomerPointsLoading,
  type PointsPanelId,
} from '@/lib/dashboard-points';
import type {
  CouponRecord,
  PointsCustomerRecord,
  PriceOptionDraft,
  ProductRecord,
  QuestionDraft,
  WorkspaceAccessState,
  WorkspaceMemberRecord,
} from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

const nativeSelectClass =
  'dark:bg-input/30 dark:border-input dark:hover:bg-input/40 flex h-10 w-full rounded-xl border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50';

const cryptoWalletFields: Array<{
  key: keyof ReturnType<typeof createEmptyIntegration>['cryptoWallets'];
  label: string;
}> = [
  { key: 'evm', label: 'ETH / Polygon wallet' },
  { key: 'btc', label: 'BTC wallet' },
  { key: 'bitcoincash', label: 'BCH wallet' },
  { key: 'ltc', label: 'LTC wallet' },
  { key: 'doge', label: 'DOGE wallet' },
  { key: 'trc20', label: 'TRC20 wallet' },
  { key: 'solana', label: 'Solana wallet' },
];

const settingsMenuItems = [
  {
    id: 'default-currency',
    label: 'Default Currency',
    description: 'Choose the money format used across checkout and summary cards.',
    info: 'This becomes the primary dashboard currency display for the selected Discord server.',
  },
  {
    id: 'staff-roles',
    label: 'Staff Roles',
    description: 'Control which Discord roles can manage sales operations.',
    info: 'Only the roles selected here should be able to work paid-order and support flows.',
  },
  {
    id: 'paid-log-channel',
    label: 'Paid Log Channel',
    description: 'Pick where successful payment notifications should land.',
    info: 'Use a private channel that your moderators or staff can monitor without cluttering public chat.',
  },
  {
    id: 'telegram',
    label: 'Telegram Integration',
    description: 'Enable the bridge, generate an invite, and connect a Telegram chat.',
    info: 'When disabled, Telegram connect controls stay hidden and the backend rejects new connection attempts.',
  },
] as const;

const pointsMenuItems = [
  {
    id: 'reward-settings',
    label: 'Reward Settings',
    description: 'Set the value per point and save the main reward configuration.',
    info: 'This controls how much one point is worth when points are redeemed.',
  },
  {
    id: 'earning-categories',
    label: 'Earning Categories',
    description: 'Choose which product categories can earn points.',
    info: 'Only successful sales in these categories will generate customer points.',
  },
  {
    id: 'redemption-categories',
    label: 'Redemption Categories',
    description: 'Choose which categories accept points as discounts.',
    info: 'Use this to protect restricted or low-margin categories from point redemption.',
  },
  {
    id: 'customer-points',
    label: 'Customer Points',
    description: 'View balances and add, edit, remove, or clear customer points.',
    info: 'This is the admin control center for manual balance management.',
  },
] as const;

const productsMenuItems = [
  {
    id: 'categories',
    label: 'Categories & Questions',
    description: 'Create category drafts, manage custom questions, and maintain templates.',
    info: 'Question templates are prepared here first so product creation stays step-by-step and consistent.',
  },
  {
    id: 'products',
    label: 'Products',
    description: 'Create or edit products with category selection, pricing, and rewards.',
    info: 'Products inherit category context and can include multiple price variations plus referral rewards.',
  },
] as const;

function getMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function FlashBanner() {
  const { error, flash, clearFlash } = useDashboardContext();

  if (!error && !flash) {
    return null;
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-[1.2rem] border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {flash ? (
        <div
          className={cn(
            'flex items-start justify-between gap-3 rounded-[1.2rem] border px-4 py-3 text-sm',
            flash.tone === 'success' &&
              'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
            flash.tone === 'error' && 'border-destructive/35 bg-destructive/10 text-destructive',
            flash.tone === 'info' &&
              'border-primary/35 bg-primary/10 text-primary-foreground dark:text-primary',
          )}
        >
          <span>{flash.message}</span>
          <button
            type="button"
            className="text-xs font-semibold uppercase tracking-[0.15em] opacity-80 transition hover:opacity-100"
            onClick={clearFlash}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DashboardSetupState() {
  const {
    actionPending,
    connectGuild,
    guildLinkTenantId,
    guildName,
    initialLoading,
    isLinkedToCurrentTenant,
    resources,
    tenantId,
    tenantName,
  } = useDashboardContext();

  if (initialLoading) {
    return (
      <Panel title="Loading dashboard" description="Pulling server resources and saved panel state.">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Please wait while the panel finishes loading.
        </div>
      </Panel>
    );
  }

  if (isLinkedToCurrentTenant) {
    return null;
  }

  return (
    <Panel
      title="Connect this server first"
      description="This workspace route is ready, but the Discord server still needs to be linked before the feature pages can load their saved settings."
      action={
        <Button type="button" disabled={actionPending} onClick={() => void connectGuild()}>
          {actionPending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          Link Server
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-[1.2rem] border border-border/70 bg-background/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
          <p className="mt-2 font-medium">{tenantName}</p>
          <p className="mt-1 text-sm text-muted-foreground">Workspace ID: {tenantId}</p>
        </div>
        <div className="rounded-[1.2rem] border border-border/70 bg-background/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Discord Server</p>
          <p className="mt-2 font-medium">{guildName}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {guildLinkTenantId
              ? 'This server is currently linked elsewhere and will be reassigned if you continue.'
              : 'No existing workspace link was found for this server.'}
          </p>
        </div>
        <div className="rounded-[1.2rem] border border-border/70 bg-background/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Bot Status</p>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill
              active={Boolean(resources?.botInGuild)}
              activeLabel="Online"
              inactiveLabel="Offline"
            />
          </div>
          {!resources?.botInGuild && resources?.inviteUrl ? (
            <Button asChild variant="outline" size="sm" className="mt-3 min-h-10">
              <a href={resources.inviteUrl} target="_blank" rel="noreferrer">
                Install Bot
                <ArrowUpRight className="size-4" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function OverviewStat({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bot;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[1.45rem] border border-border/70 bg-card/80 p-5 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.45)]">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-[1rem] border border-primary/25 bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <div className="pt-4">{children}</div>
    </div>
  );
}

function WorkspaceOperationsPanel() {
  const {
    guildId,
    guildName,
    isLinkedToCurrentTenant,
    refreshBase,
    refreshTelegram,
    showFlash,
    telegramState,
    tenantId,
  } = useDashboardContext();
  const [workspaceAccess, setWorkspaceAccess] = useState<WorkspaceAccessState | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMemberRecord | null>(null);
  const [disconnectGuildOpen, setDisconnectGuildOpen] = useState(false);
  const [disconnectTelegramOpen, setDisconnectTelegramOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'remove-member' | 'disconnect-guild' | 'disconnect-telegram' | null>(
    null,
  );

  const loadWorkspaceAccess = useEffectEvent(async (showSpinner: boolean) => {
    if (!isLinkedToCurrentTenant) {
      setWorkspaceAccess(null);
      return;
    }

    if (showSpinner) {
      setWorkspaceLoading(true);
    }

    try {
      const response = await dashboardApi<WorkspaceAccessState>(
        `/api/tenants/${encodeURIComponent(tenantId)}/members`,
      );
      setWorkspaceAccess(response);
    } catch (error) {
      showFlash('error', getMessage(error, 'Failed to load workspace access controls.'));
    } finally {
      setWorkspaceLoading(false);
    }
  });

  useEffect(() => {
    void loadWorkspaceAccess(true);
  }, [isLinkedToCurrentTenant, loadWorkspaceAccess, tenantId]);

  async function removeMember() {
    if (!memberToRemove) {
      return;
    }

    setPendingAction('remove-member');
    try {
      await dashboardApi<{ ok: true }>(
        `/api/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(memberToRemove.userId)}`,
        'DELETE',
      );
      setMemberToRemove(null);
      await loadWorkspaceAccess(false);
      showFlash('success', `${memberToRemove.username} was removed from the workspace.`);
    } catch (error) {
      showFlash('error', getMessage(error, 'Failed to remove this workspace member.'));
    } finally {
      setPendingAction(null);
    }
  }

  async function disconnectGuild() {
    setPendingAction('disconnect-guild');
    try {
      await dashboardApi<{ ok: true }>(`/api/guilds/${encodeURIComponent(guildId)}/disconnect`, 'DELETE', {
        tenantId,
      });
      window.location.href = '/dashboard';
    } catch (error) {
      showFlash('error', getMessage(error, 'Failed to disconnect this Discord server.'));
      setPendingAction(null);
    }
  }

  async function disconnectTelegram() {
    setPendingAction('disconnect-telegram');
    try {
      await dashboardApi<{ ok: true }>(
        `/api/guilds/${encodeURIComponent(guildId)}/telegram-link-token`,
        'DELETE',
        {
          tenantId,
        },
      );
      setDisconnectTelegramOpen(false);
      await Promise.all([refreshTelegram(), refreshBase(), loadWorkspaceAccess(false)]);
      showFlash('success', 'Telegram chat disconnected from this server.');
    } catch (error) {
      showFlash('error', getMessage(error, 'Failed to disconnect the Telegram chat.'));
    } finally {
      setPendingAction(null);
    }
  }

  if (!isLinkedToCurrentTenant) {
    return null;
  }

  const currentRoleLabel = workspaceAccess?.currentRole
    ? workspaceAccess.currentRole.charAt(0).toUpperCase() + workspaceAccess.currentRole.slice(1)
    : 'Super Admin';

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Panel
          title="Workspace access"
          description="Review who can operate this merchant workspace and remove non-owner members when access should be revoked."
          action={
            workspaceAccess ? (
              <Badge variant="outline">{currentRoleLabel}</Badge>
            ) : null
          }
        >
          {workspaceLoading && !workspaceAccess ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading workspace members...
            </div>
          ) : workspaceAccess ? (
            <div className="space-y-3">
              {workspaceAccess.members.map((member) => (
                <div
                  key={member.userId}
                  className="flex flex-col gap-3 rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card/80 text-sm font-semibold text-primary">
                        {member.username.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{member.username}</p>
                        <p className="truncate text-sm text-muted-foreground">{member.discordUserId}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{member.role}</Badge>
                    {member.removable ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => setMemberToRemove(member)}>
                        <Trash2 className="size-4" />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}

              {!workspaceAccess.canManageMembers ? (
                <InfoTip>
                  Only the workspace owner or a super admin can remove members. Owners are always protected from removal.
                </InfoTip>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Workspace access controls are unavailable right now.</p>
          )}
        </Panel>

        <Panel
          title="Connection controls"
          description="Disconnect the live Telegram bridge or retire this Discord server from the selected merchant workspace."
        >
          <div className="space-y-4">
            <div className="rounded-[1.15rem] border border-border/70 bg-background/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <p className="font-medium">Telegram connection</p>
                  <div className="flex items-center gap-2">
                    <StatusPill
                      active={Boolean(telegramState?.linkedChat)}
                      activeLabel="Linked"
                      inactiveLabel="Not Linked"
                    />
                    <span className="text-sm text-muted-foreground">
                      {telegramState?.linkedChat?.chatTitle ?? 'No Telegram chat connected'}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Disconnecting Telegram removes the linked chat only. The feature can be enabled again later.
                  </p>
                </div>
                {workspaceAccess?.canDisconnectTelegram && telegramState?.linkedChat ? (
                  <Button type="button" variant="outline" onClick={() => setDisconnectTelegramOpen(true)}>
                    Disconnect Telegram
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="rounded-[1.15rem] border border-destructive/25 bg-destructive/8 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <p className="font-medium">Discord server connection</p>
                  <div className="flex items-center gap-2">
                    <StatusPill active={true} activeLabel="Connected" inactiveLabel="Disconnected" />
                    <span className="text-sm text-muted-foreground">{guildName}</span>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Disconnecting this server removes its workspace-linked products, coupons, integrations, points,
                    referrals, order data, and Telegram bridge for this merchant environment.
                  </p>
                </div>
                {workspaceAccess?.canDisconnectGuild ? (
                  <Button type="button" variant="destructive" onClick={() => setDisconnectGuildOpen(true)}>
                    Disconnect Server
                  </Button>
                ) : null}
              </div>
            </div>

            {!workspaceAccess?.canDisconnectGuild && !workspaceAccess?.canDisconnectTelegram ? (
              <InfoTip>
                Server disconnect requires the workspace owner or a super admin. Telegram disconnect requires admin access or higher.
              </InfoTip>
            ) : null}
          </div>
        </Panel>
      </div>

      <ConfirmationModal
        open={Boolean(memberToRemove)}
        title="Remove workspace member"
        description={
          memberToRemove ? (
            <>
              Remove <strong>{memberToRemove.username}</strong> from this workspace. Their dashboard access will stop
              immediately for this merchant.
            </>
          ) : (
            'Remove this workspace member.'
          )
        }
        confirmLabel={pendingAction === 'remove-member' ? 'Removing...' : 'Remove Member'}
        confirmPhrase={memberToRemove?.username}
        confirmPlaceholder={memberToRemove?.username ?? 'Member username'}
        pending={pendingAction === 'remove-member'}
        onClose={() => setMemberToRemove(null)}
        onConfirm={() => void removeMember()}
      />

      <ConfirmationModal
        open={disconnectTelegramOpen}
        title="Disconnect Telegram chat"
        description="Disconnect the currently linked Telegram chat from this Discord server. You can generate a new connection link again later."
        confirmLabel={pendingAction === 'disconnect-telegram' ? 'Disconnecting...' : 'Disconnect Telegram'}
        confirmPhrase={telegramState?.linkedChat?.chatTitle ?? undefined}
        confirmPlaceholder={telegramState?.linkedChat?.chatTitle ?? 'Telegram chat title'}
        pending={pendingAction === 'disconnect-telegram'}
        onClose={() => setDisconnectTelegramOpen(false)}
        onConfirm={() => void disconnectTelegram()}
      />

      <ConfirmationModal
        open={disconnectGuildOpen}
        title="Disconnect Discord server"
        description={
          <>
            Disconnect <strong>{guildName}</strong> from this workspace and remove all server-scoped merchant data for
            this store.
          </>
        }
        confirmLabel={pendingAction === 'disconnect-guild' ? 'Disconnecting...' : 'Disconnect Server'}
        confirmPhrase={guildName}
        confirmPlaceholder={guildName}
        pending={pendingAction === 'disconnect-guild'}
        onClose={() => setDisconnectGuildOpen(false)}
        onConfirm={() => void disconnectGuild()}
      />
    </>
  );
}

export function OverviewSection() {
  const { overview, resources, refreshing, refreshBase, isLinkedToCurrentTenant } = useDashboardContext();

  return (
    <SectionShell
      eyebrow="Overview"
      title="Main dashboard"
      description="A live snapshot of bot availability, payment readiness, Telegram state, and recent sales activity."
      action={
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void refreshBase()}>
          {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          Refresh
        </Button>
      }
    >
      <FlashBanner />
      <DashboardSetupState />

      {isLinkedToCurrentTenant ? (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <OverviewStat icon={Bot} title="Bot Status">
              <div className="space-y-3">
                <StatusPill
                  active={Boolean(resources?.botInGuild)}
                  activeLabel="Online"
                  inactiveLabel="Offline"
                />
                <p className="text-sm text-muted-foreground">
                  {resources?.botInGuild
                    ? 'Bot access looks healthy for this server.'
                    : 'Install the bot to start ticket sales and dashboard automation.'}
                </p>
              </div>
            </OverviewStat>

            <OverviewStat icon={CreditCard} title="Payments">
              <div className="space-y-3">
                <StatusPill
                  active={Boolean(overview?.paymentsConfigured)}
                  activeLabel="Enabled"
                  inactiveLabel="Disabled"
                />
                <p className="text-sm text-muted-foreground">
                  {overview?.cryptoEnabled
                    ? 'Crypto checkout is active alongside the core wallet setup.'
                    : 'Wallet details can be saved from the Payments page.'}
                </p>
              </div>
            </OverviewStat>

            <OverviewStat icon={Link2} title="Telegram Bot">
              <div className="space-y-3">
                <StatusPill
                  active={Boolean(overview?.telegramEnabled)}
                  activeLabel="Enabled"
                  inactiveLabel="Disabled"
                />
                <p className="text-sm text-muted-foreground">
                  {overview?.telegramLinked
                    ? 'A Telegram group is already linked to this server.'
                    : 'Enable Telegram in Settings to surface add-bot actions.'}
                </p>
              </div>
            </OverviewStat>

            <OverviewStat icon={Sparkles} title="Today’s Sales">
              <div className="space-y-2">
                <p className="font-[family-name:var(--font-display)] text-3xl tracking-tight">
                  {formatCurrencyMinor(overview?.todaySalesMinor ?? 0)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {overview?.todaySalesCount ?? 0} paid sale{overview?.todaySalesCount === 1 ? '' : 's'} today
                </p>
              </div>
            </OverviewStat>
          </div>

          <Panel title="Recent sales" description="Latest successful payments captured for this server.">
            {overview?.recentSales.length ? (
              <div className="space-y-3">
                {overview.recentSales.map((sale) => (
                  <div
                    key={sale.id}
                    className="grid gap-3 rounded-[1.25rem] border border-border/70 bg-background/70 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {sale.customerEmail ?? 'Customer email unavailable'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {sale.productId ?? 'Unknown product'} / {sale.variantId ?? 'Unknown variation'}
                      </p>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(sale.paidAt).toLocaleString()}
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{sale.fulfillmentStatus}</Badge>
                      <span className="font-semibold">{formatCurrencyMinor(sale.priceMinor, sale.currency)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No paid orders have been recorded yet for this server.
              </p>
            )}
          </Panel>

          <WorkspaceOperationsPanel />
        </div>
      ) : null}
    </SectionShell>
  );
}

export function SettingsSection() {
  const {
    actionPending,
    config,
    isLinkedToCurrentTenant,
    resources,
    saveConfig,
    showFlash,
    telegramState,
    generateTelegramLink,
  } = useDashboardContext();
  const [defaultCurrency, setDefaultCurrency] = useState('GBP');
  const [paidLogChannelId, setPaidLogChannelId] = useState('');
  const [staffRoleIds, setStaffRoleIds] = useState<string[]>([]);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [activeSettingsPanel, setActiveSettingsPanel] =
    useState<(typeof settingsMenuItems)[number]['id']>('default-currency');
  const [generatedTelegram, setGeneratedTelegram] = useState<Awaited<
    ReturnType<typeof generateTelegramLink>
  > | null>(null);

  useEffect(() => {
    if (!config) {
      return;
    }

    setDefaultCurrency(config.defaultCurrency || 'GBP');
    setPaidLogChannelId(config.paidLogChannelId ?? '');
    setStaffRoleIds(config.staffRoleIds);
    setTelegramEnabled(config.telegramEnabled);
  }, [config]);

  async function handleSave() {
    try {
      await saveConfig({
        defaultCurrency,
        paidLogChannelId: paidLogChannelId || null,
        staffRoleIds,
        telegramEnabled,
      });
    } catch {}
  }

  async function handleCopy(text: string, successMessage: string) {
    try {
      await copyToClipboard(text);
      showFlash('success', successMessage);
    } catch (copyError) {
      showFlash('error', getMessage(copyError, 'Copy failed.'));
    }
  }

  async function handleGenerateTelegram() {
    try {
      const response = await generateTelegramLink();
      setGeneratedTelegram(response);
    } catch {}
  }

  return (
    <SectionShell
      eyebrow="Settings"
      title="Server settings"
      description="Keep the essentials focused: default currency, staff roles, paid-log destination, and Telegram integration."
      action={
        <Button type="button" className="min-h-11" disabled={actionPending || !isLinkedToCurrentTenant} onClick={() => void handleSave()}>
          {actionPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save Changes
        </Button>
      }
    >
      <FlashBanner />
      <DashboardSetupState />

      {isLinkedToCurrentTenant ? (
        <div className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1fr)]">
          <SectionMenu
            title="Settings Menu"
            items={settingsMenuItems}
            activeId={activeSettingsPanel}
            onChange={setActiveSettingsPanel}
          />

          <div className="min-w-0 space-y-5">
            {activeSettingsPanel === 'default-currency' ? (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    Default currency
                    <InfoButton label="This is the default currency shown across the panel and checkout summaries for this server." />
                  </span>
                }
                description="Choose the primary currency for this Discord server."
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="default-currency">Currency</Label>
                    <select
                      id="default-currency"
                      className={nativeSelectClass}
                      value={defaultCurrency}
                      onChange={(event) => setDefaultCurrency(event.target.value)}
                    >
                      {['GBP', 'USD', 'EUR'].map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </select>
                  </div>
                  <InfoTip>Save after changing the default currency so the dashboard and sales summaries stay in sync.</InfoTip>
                </div>
              </Panel>
            ) : null}

            {activeSettingsPanel === 'staff-roles' ? (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    Staff roles
                    <InfoButton label="These roles should represent the team members allowed to work order, payment, and support tasks inside the server." />
                  </span>
                }
                description="Select the Discord roles that should be treated as sales staff."
              >
                <div className="space-y-3">
                  {resources?.roles.length ? (
                    resources.roles.map((role) => {
                      const checked = staffRoleIds.includes(role.id);
                      return (
                        <label
                          key={role.id}
                          className="flex items-center gap-3 rounded-[1.1rem] border border-border/70 bg-background/70 px-3 py-3 text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              setStaffRoleIds((current) =>
                                value === true
                                  ? [...new Set([...current, role.id])]
                                  : current.filter((item) => item !== role.id),
                              )
                            }
                          />
                          <span className="truncate">{role.name}</span>
                        </label>
                      );
                    })
                  ) : (
                    <p className="text-sm text-muted-foreground">No guild roles were returned by Discord.</p>
                  )}
                </div>
              </Panel>
            ) : null}

            {activeSettingsPanel === 'paid-log-channel' ? (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    Paid log channel
                    <InfoButton label="Successful payment notifications and paid-order events should go here so staff have one clean audit channel." />
                  </span>
                }
                description="Choose the channel that receives the paid-order log feed."
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="paid-log-channel">Paid log channel</Label>
                    <select
                      id="paid-log-channel"
                      className={nativeSelectClass}
                      value={paidLogChannelId}
                      onChange={(event) => setPaidLogChannelId(event.target.value)}
                    >
                      <option value="">Select channel</option>
                      {resources?.channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          #{channel.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </Panel>
            ) : null}

            {activeSettingsPanel === 'telegram' ? (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    Telegram bot integration
                    <InfoButton label="Enable this when you want staff to connect a Telegram group and mirror the operational flow outside Discord." />
                  </span>
                }
                description="Enable the bridge, then invite the Telegram bot and connect the chat."
              >
                <div className="space-y-5">
                  <div className="flex flex-col gap-4 rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">Enable Telegram bot integration</p>
                      <p className="text-sm text-muted-foreground">
                        Disabled servers hide all Telegram controls and reject connection attempts.
                      </p>
                    </div>
                    <FeatureToggle
                      checked={telegramEnabled}
                      label="Enable Telegram integration"
                      onChange={setTelegramEnabled}
                    />
                  </div>

                  {telegramEnabled ? (
                    <div className="space-y-4">
                      <InfoTip>
                        Enable the toggle first, save the page, then use the invite and regenerate actions below
                        to connect the Telegram side cleanly.
                      </InfoTip>

                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="rounded-[1.2rem] border border-border/70 bg-background/70 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Telegram bot invite link</p>
                          <p className="mt-2 break-all text-sm">
                            {telegramState?.inviteUrl ?? generatedTelegram?.inviteUrl ?? 'Save first to generate the live invite link.'}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {(telegramState?.inviteUrl ?? generatedTelegram?.inviteUrl) ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    void handleCopy(
                                      telegramState?.inviteUrl ?? generatedTelegram?.inviteUrl ?? '',
                                      'Telegram invite link copied.',
                                    )
                                  }
                                >
                                  <Copy className="size-4" />
                                  Copy link
                                </Button>
                                <Button asChild size="sm">
                                  <a
                                    href={telegramState?.inviteUrl ?? generatedTelegram?.inviteUrl ?? '#'}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Add Bot To Telegram
                                    <ArrowUpRight className="size-4" />
                                  </a>
                                </Button>
                              </>
                            ) : null}
                            <Button type="button" variant="outline" size="sm" onClick={() => void handleGenerateTelegram()}>
                              <RefreshCcw className="size-4" />
                              Regenerate link
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-[1.2rem] border border-border/70 bg-background/70 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Connection status</p>
                          <div className="mt-2 flex items-center gap-2">
                            <StatusPill
                              active={Boolean(telegramState?.linkedChat)}
                              activeLabel="Connected"
                              inactiveLabel="Pending"
                            />
                          </div>
                          <p className="mt-3 text-sm text-muted-foreground">
                            {telegramState?.linkedChat
                              ? `Linked chat: ${telegramState.linkedChat.chatTitle}`
                              : 'No Telegram chat is linked to this server yet.'}
                          </p>
                          {generatedTelegram ? (
                            <div className="mt-4 space-y-2">
                              <Label htmlFor="telegram-command">Latest connect command</Label>
                              <Textarea
                                id="telegram-command"
                                value={generatedTelegram.command}
                                readOnly
                                className="min-h-24"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  void handleCopy(
                                    generatedTelegram.command,
                                    'Telegram connect command copied.',
                                  )
                                }
                              >
                                <Copy className="size-4" />
                                Copy command
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <InfoTip>Telegram bot is currently disabled for this server.</InfoTip>
                  )}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      ) : null}
    </SectionShell>
  );
}

export function PaymentsSection() {
  const { actionPending, integration, isLinkedToCurrentTenant, overview, saveIntegration } =
    useDashboardContext();
  const [walletAddress, setWalletAddress] = useState('');
  const [checkoutDomain, setCheckoutDomain] = useState('');
  const [callbackSecret, setCallbackSecret] = useState('');
  const [cryptoEnabled, setCryptoEnabled] = useState(false);
  const [cryptoAddFees, setCryptoAddFees] = useState(false);
  const [wallets, setWallets] = useState(createEmptyIntegration().cryptoWallets);

  useEffect(() => {
    const defaults = createEmptyIntegration();
    setWalletAddress(integration?.merchantWalletAddress ?? defaults.merchantWalletAddress);
    setCheckoutDomain(integration?.checkoutDomain ?? defaults.checkoutDomain);
    setCallbackSecret('');
    setCryptoEnabled(integration?.cryptoGatewayEnabled ?? defaults.cryptoGatewayEnabled);
    setCryptoAddFees(integration?.cryptoAddFees ?? defaults.cryptoAddFees);
    setWallets(integration?.cryptoWallets ?? defaults.cryptoWallets);
  }, [integration]);

  async function handleSave() {
    try {
      await saveIntegration({
        merchantWalletAddress: walletAddress.trim(),
        checkoutDomain: normalizeCheckoutDomainInput(checkoutDomain),
        callbackSecret: callbackSecret.trim() || undefined,
        cryptoGatewayEnabled: cryptoEnabled,
        cryptoAddFees,
        cryptoWallets: wallets,
      });
      setCallbackSecret('');
    } catch {}
  }

  return (
    <SectionShell
      eyebrow="Payments"
      title="Payment controls"
      description="Configure the Voodoo Pay wallet, checkout domain, webhook secret rotation, and optional crypto wallet set."
      action={
        <Button type="button" className="min-h-11" disabled={actionPending || !isLinkedToCurrentTenant} onClick={() => void handleSave()}>
          {actionPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save Payments
        </Button>
      }
    >
      <FlashBanner />
      <DashboardSetupState />

      {isLinkedToCurrentTenant ? (
        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-3">
            <OverviewStat icon={CreditCard} title="Payments">
              <StatusPill
                active={Boolean(overview?.paymentsConfigured)}
                activeLabel="Enabled"
                inactiveLabel="Disabled"
              />
            </OverviewStat>
            <OverviewStat icon={Sparkles} title="Crypto">
              <StatusPill
                active={cryptoEnabled}
                activeLabel="Enabled"
                inactiveLabel="Disabled"
              />
            </OverviewStat>
            <OverviewStat icon={Bot} title="Webhook">
              <p className="text-sm text-muted-foreground">
                Save a callback secret whenever you need to rotate provider callback validation.
              </p>
            </OverviewStat>
          </div>

          <Panel title="Wallet and checkout" description="These fields control the core Voodoo Pay destination and branded checkout host.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="merchant-wallet">USDC Polygon wallet address</Label>
                <Input
                  id="merchant-wallet"
                  value={walletAddress}
                  onChange={(event) => setWalletAddress(event.target.value)}
                  placeholder="0x..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="checkout-domain">Checkout domain</Label>
                <Input
                  id="checkout-domain"
                  value={checkoutDomain}
                  onChange={(event) => setCheckoutDomain(event.target.value)}
                  placeholder="checkout.voodoo-pay.uk"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="callback-secret">Optional callback secret rotation</Label>
                <Input
                  id="callback-secret"
                  type="password"
                  value={callbackSecret}
                  onChange={(event) => setCallbackSecret(event.target.value)}
                  placeholder="Leave blank to keep the current secret"
                />
              </div>
            </div>
          </Panel>

          <Panel title="Crypto payments" description="Only show wallet-specific controls when the crypto gateway is enabled.">
            <div className="space-y-5">
              <div className="flex flex-col gap-4 rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Enable crypto payments</p>
                  <p className="text-sm text-muted-foreground">
                    Toggle extra wallet routing for BTC, ETH, LTC, DOGE, and other supported chains.
                  </p>
                </div>
                <FeatureToggle
                  checked={cryptoEnabled}
                  label="Enable crypto payments"
                  onChange={setCryptoEnabled}
                />
              </div>

              {cryptoEnabled ? (
                <>
                  <label className="flex items-center gap-3 rounded-[1.1rem] border border-border/70 bg-background/70 px-4 py-3 text-sm">
                    <Checkbox
                      checked={cryptoAddFees}
                      onCheckedChange={(checked) => setCryptoAddFees(checked === true)}
                    />
                    <span>Add gateway fees to crypto checkout totals</span>
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    {cryptoWalletFields.map(({ key, label }) => (
                      <div key={key} className="space-y-2">
                        <Label htmlFor={`wallet-${key}`}>{label}</Label>
                        <Input
                          id={`wallet-${key}`}
                          value={wallets[key] ?? ''}
                          onChange={(event) =>
                            setWallets((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          placeholder="Optional wallet address"
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <InfoTip>Crypto wallet inputs stay hidden until crypto payments are enabled.</InfoTip>
              )}
            </div>
          </Panel>
        </div>
      ) : null}
    </SectionShell>
  );
}

export function CouponsSection() {
  const { actionPending, categories, config, guildId, isLinkedToCurrentTenant, products, saveConfig, showFlash, tenantId } =
    useDashboardContext();
  const [activeCouponsPanel, setActiveCouponsPanel] = useState<CouponPanelId>('settings');
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [discountMajor, setDiscountMajor] = useState('');
  const [couponActive, setCouponActive] = useState(true);
  const [allowedCategories, setAllowedCategories] = useState<string[]>([]);
  const [allowedProductIds, setAllowedProductIds] = useState<string[]>([]);
  const [allowedVariantIds, setAllowedVariantIds] = useState<string[]>([]);

  const loadCoupons = useEffectEvent(async () => {
    if (!config?.couponsEnabled) {
      setCoupons([]);
      return;
    }

    setLoadingCoupons(true);
    try {
      const response = await dashboardApi<{ coupons: CouponRecord[] }>(
        `/api/guilds/${encodeURIComponent(guildId)}/coupons?tenantId=${encodeURIComponent(tenantId)}`,
      );
      setCoupons(response.coupons);
    } catch (loadError) {
      showFlash('error', getMessage(loadError, 'Failed to load coupons.'));
    } finally {
      setLoadingCoupons(false);
    }
  });

  useEffect(() => {
    if (config?.couponsEnabled) {
      void loadCoupons();
    } else {
      setCoupons([]);
    }
  }, [config?.couponsEnabled, loadCoupons]);

  useEffect(() => {
    if (!config?.couponsEnabled && activeCouponsPanel !== 'settings') {
      setActiveCouponsPanel('settings');
    }
  }, [activeCouponsPanel, config?.couponsEnabled]);

  function resetCouponForm() {
    setEditingCouponId(null);
    setCouponCode('');
    setDiscountMajor('');
    setCouponActive(true);
    setAllowedCategories([]);
    setAllowedProductIds([]);
    setAllowedVariantIds([]);
  }

  async function handleSaveCoupon() {
    try {
      const coupon = {
        code: couponCode.trim(),
        discountMinor: parsePriceToMinor(discountMajor),
        active: couponActive,
        allowedCategories,
        allowedProductIds,
        allowedVariantIds,
      };

      const basePath = `/api/guilds/${encodeURIComponent(guildId)}/coupons`;
      if (editingCouponId) {
        await dashboardApi(`${basePath}/${encodeURIComponent(editingCouponId)}`, 'PATCH', {
          tenantId,
          coupon,
        });
        showFlash('success', 'Coupon updated.');
      } else {
        await dashboardApi(basePath, 'POST', {
          tenantId,
          coupon,
        });
        showFlash('success', 'Coupon created.');
      }

      resetCouponForm();
      setActiveCouponsPanel('saved-coupons');
      await loadCoupons();
    } catch (saveError) {
      showFlash('error', getMessage(saveError, 'Failed to save coupon.'));
    }
  }

  async function deleteCoupon(couponId: string) {
    try {
      await dashboardApi(
        `/api/guilds/${encodeURIComponent(guildId)}/coupons/${encodeURIComponent(couponId)}?tenantId=${encodeURIComponent(tenantId)}`,
        'DELETE',
      );
      showFlash('success', 'Coupon deleted.');
      await loadCoupons();
    } catch (deleteError) {
      showFlash('error', getMessage(deleteError, 'Failed to delete coupon.'));
    }
  }

  function editCoupon(coupon: CouponRecord) {
    setActiveCouponsPanel('create-coupon');
    setEditingCouponId(coupon.id);
    setCouponCode(coupon.code);
    setDiscountMajor(formatMinorToMajor(coupon.discountMinor));
    setCouponActive(coupon.active);
    setAllowedCategories(coupon.allowedCategories);
    setAllowedProductIds(coupon.allowedProductIds);
    setAllowedVariantIds(coupon.allowedVariantIds);
  }

  return (
    <SectionShell
      eyebrow="Coupons"
      title="Coupon controls"
      description="Enable or disable discounts globally, then create obvious scoped coupons for categories or specific products."
      action={
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={!config?.couponsEnabled || loadingCoupons}
          onClick={() => void loadCoupons()}
        >
          {loadingCoupons ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          Refresh
        </Button>
      }
    >
      <FlashBanner />
      <DashboardSetupState />

      {isLinkedToCurrentTenant ? (
        <div className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1fr)]">
          <SectionMenu
            title="Coupons Menu"
            items={getCouponMenuItems(Boolean(config?.couponsEnabled))}
            activeId={activeCouponsPanel}
            onChange={setActiveCouponsPanel}
          />

          <div className="min-w-0 space-y-5">
            {activeCouponsPanel === 'settings' ? (
              <>
                <Panel
                  title={
                    <span className="flex items-center gap-2">
                      Feature toggle
                      <InfoButton label="Turn coupons off to hide the create and management views and block coupon usage in checkout." />
                    </span>
                  }
                  description="Turn the coupon system off to hide coupon actions and block coupon usage."
                >
                  <div className="flex flex-col gap-4 rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">Enable coupons</p>
                      <p className="text-sm text-muted-foreground">
                        Disabled coupons will no longer be accepted in checkout flows.
                      </p>
                    </div>
                    <FeatureToggle
                      checked={Boolean(config?.couponsEnabled)}
                      label="Enable coupons"
                      disabled={actionPending}
                      onChange={(checked) => void saveConfig({ couponsEnabled: checked })}
                    />
                  </div>
                </Panel>

                {!config?.couponsEnabled ? (
                  <InfoTip>Coupons are currently disabled. Turn the feature on to reveal the create and manage steps.</InfoTip>
                ) : null}
              </>
            ) : null}

            {config?.couponsEnabled && activeCouponsPanel === 'create-coupon' ? (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    {editingCouponId ? 'Edit coupon' : 'Create coupon'}
                    <InfoButton label="Coupons can apply server-wide or be narrowed to categories, specific products, and even individual variations." />
                  </span>
                }
                description="Choose a code, discount value, and optional category, product, or variation scope."
              >
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="coupon-code">Coupon code</Label>
                      <Input
                        id="coupon-code"
                        value={couponCode}
                        onChange={(event) => setCouponCode(event.target.value)}
                        placeholder="WELCOME10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="coupon-discount">Discount amount</Label>
                      <Input
                        id="coupon-discount"
                        value={discountMajor}
                        onChange={(event) => setDiscountMajor(event.target.value)}
                        placeholder="5.00"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-3 rounded-[1.1rem] border border-border/70 bg-background/70 px-4 py-3 text-sm">
                    <Checkbox checked={couponActive} onCheckedChange={(checked) => setCouponActive(checked === true)} />
                    <span>Coupon active</span>
                  </label>

                  <div className="grid min-w-0 gap-4 xl:grid-cols-3">
                    <div className="space-y-3">
                      <p className="text-sm font-semibold">Categories</p>
                      {categories.length ? (
                        categories.map((category) => (
                          <label
                            key={category.name}
                            className="flex min-w-0 items-center gap-3 rounded-[1.05rem] border border-border/70 bg-background/70 px-3 py-3 text-sm"
                          >
                            <Checkbox
                              checked={allowedCategories.includes(category.name)}
                              onCheckedChange={(checked) =>
                                setAllowedCategories((current) =>
                                  checked === true
                                    ? [...new Set([...current, category.name])]
                                    : current.filter((entry) => entry !== category.name),
                                )
                              }
                            />
                            <span className="min-w-0 flex-1 truncate">{category.name}</span>
                          </label>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">Create categories before scoping coupons by category.</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold">Specific products</p>
                      {products.length ? (
                        products.map((product) => (
                          <label
                            key={product.id}
                            className="flex min-w-0 items-center gap-3 rounded-[1.05rem] border border-border/70 bg-background/70 px-3 py-3 text-sm"
                          >
                            <Checkbox
                              checked={allowedProductIds.includes(product.id)}
                              onCheckedChange={(checked) =>
                                setAllowedProductIds((current) =>
                                  checked === true
                                    ? [...new Set([...current, product.id])]
                                    : current.filter((entry) => entry !== product.id),
                                )
                              }
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {product.name} <span className="text-muted-foreground">({product.category})</span>
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">Create products before scoping coupons.</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold">Specific variations</p>
                      {products.flatMap((product) => product.variants.map((variant) => ({ product, variant }))).length ? (
                        products.flatMap((product) =>
                          product.variants.map((variant) => (
                            <label
                              key={variant.id}
                              className="flex min-w-0 items-center gap-3 rounded-[1.05rem] border border-border/70 bg-background/70 px-3 py-3 text-sm"
                            >
                              <Checkbox
                                checked={allowedVariantIds.includes(variant.id)}
                                onCheckedChange={(checked) =>
                                  setAllowedVariantIds((current) =>
                                    checked === true
                                      ? [...new Set([...current, variant.id])]
                                      : current.filter((entry) => entry !== variant.id),
                                  )
                                }
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {product.name}: {variant.label}
                              </span>
                            </label>
                          )),
                        )
                      ) : (
                        <p className="text-sm text-muted-foreground">No product variations exist yet.</p>
                      )}
                    </div>
                  </div>

                  <InfoTip>
                    Leave all scope lists empty to apply the coupon to everything. Add categories, products, or
                    variations only when you want to narrow where the coupon works.
                  </InfoTip>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button type="button" className="min-h-11 sm:flex-1" onClick={() => void handleSaveCoupon()}>
                      <Save className="size-4" />
                      {editingCouponId ? 'Update Coupon' : 'Create Coupon'}
                    </Button>
                    {editingCouponId ? (
                      <Button type="button" variant="outline" className="min-h-11 sm:flex-1" onClick={resetCouponForm}>
                        Cancel Edit
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Panel>
            ) : null}

            {config?.couponsEnabled && activeCouponsPanel === 'saved-coupons' ? (
              <Panel title="Saved coupons" description="Existing discount codes for this Discord server.">
                {coupons.length ? (
                  <div className="space-y-3">
                    {coupons.map((coupon) => (
                      (() => {
                        const scopeParts = [
                          coupon.allowedCategories.length
                            ? `${coupon.allowedCategories.length} categor${coupon.allowedCategories.length === 1 ? 'y' : 'ies'}`
                            : null,
                          coupon.allowedProductIds.length
                            ? `${coupon.allowedProductIds.length} product${coupon.allowedProductIds.length === 1 ? '' : 's'}`
                            : null,
                          coupon.allowedVariantIds.length
                            ? `${coupon.allowedVariantIds.length} variation${coupon.allowedVariantIds.length === 1 ? '' : 's'}`
                            : null,
                        ].filter((value): value is string => Boolean(value));

                        return (
                          <div
                            key={coupon.id}
                            className="flex flex-col gap-3 rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-4 xl:flex-row xl:items-center xl:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold">{coupon.code}</p>
                                <Badge variant="outline">{formatCurrencyMinor(coupon.discountMinor)}</Badge>
                                <Badge variant="outline">{coupon.active ? 'Active' : 'Inactive'}</Badge>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {scopeParts.length
                                  ? `Scoped to ${scopeParts.join(', ')}.`
                                  : 'Applies to all categories and products.'}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" variant="outline" onClick={() => editCoupon(coupon)}>
                                Edit
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => void deleteCoupon(coupon.id)}>
                                <Trash2 className="size-4" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        );
                      })()
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No coupons have been created yet.</p>
                )}
              </Panel>
            ) : null}
          </div>
        </div>
      ) : null}
    </SectionShell>
  );
}

export function PointsSection() {
  const { actionPending, categories, config, guildId, isLinkedToCurrentTenant, refreshOverview, saveConfig, showFlash, tenantId } =
    useDashboardContext();
  const [pointValueMajor, setPointValueMajor] = useState(DEFAULT_POINT_VALUE_MAJOR);
  const [earnCategories, setEarnCategories] = useState<string[]>([]);
  const [redeemCategories, setRedeemCategories] = useState<string[]>([]);
  const [activePointsPanel, setActivePointsPanel] = useState<PointsPanelId>('reward-settings');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [customers, setCustomers] = useState<PointsCustomerRecord[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [adjustEmail, setAdjustEmail] = useState('');
  const [adjustAction, setAdjustAction] = useState<'add' | 'set' | 'clear'>('add');
  const [adjustPoints, setAdjustPoints] = useState('');
  const latestCustomerRequestId = useRef(0);

  useEffect(() => {
    if (!config) {
      return;
    }

    setPointValueMajor(formatPointValueMinorToMajor(config.pointValueMinor));
    setEarnCategories(config.pointsEarnCategoryKeys);
    setRedeemCategories(config.pointsRedeemCategoryKeys);
  }, [config]);

  const loadCustomers = useEffectEvent(async (searchTerm: string) => {
    if (!config?.pointsEnabled) {
      setCustomers([]);
      return;
    }

    const requestId = latestCustomerRequestId.current + 1;
    latestCustomerRequestId.current = requestId;

    setLoadingCustomers(true);
    try {
      const response = await dashboardApi<{ customers: PointsCustomerRecord[] }>(
        `/api/guilds/${encodeURIComponent(guildId)}/points/customers?tenantId=${encodeURIComponent(tenantId)}&search=${encodeURIComponent(searchTerm)}`,
      );
      if (requestId === latestCustomerRequestId.current) {
        setCustomers(response.customers);
      }
    } catch (loadError) {
      if (requestId === latestCustomerRequestId.current) {
        showFlash('error', getMessage(loadError, 'Failed to load customer points.'));
      }
    } finally {
      if (requestId === latestCustomerRequestId.current) {
        setLoadingCustomers(false);
      }
    }
  });

  useEffect(() => {
    if (!config?.pointsEnabled) {
      setCustomers([]);
      setLoadingCustomers(false);
      latestCustomerRequestId.current += 1;
    }
  }, [config?.pointsEnabled]);

  useEffect(() => {
    if (shouldLoadCustomerPoints({ pointsEnabled: Boolean(config?.pointsEnabled), activePanel: activePointsPanel })) {
      void loadCustomers(deferredSearch.trim());
    }
  }, [activePointsPanel, config?.pointsEnabled, deferredSearch, loadCustomers]);

  async function handleSaveRules() {
    try {
      await saveConfig({
        pointValueMinor: parsePointValueMajorToMinor(pointValueMajor),
        pointsEarnCategoryKeys: earnCategories,
        pointsRedeemCategoryKeys: redeemCategories,
      });
      await refreshOverview();
    } catch {}
  }

  async function adjustCustomerPoints(email: string, action: 'add' | 'set' | 'clear', points: number) {
    try {
      await dashboardApi(`/api/guilds/${encodeURIComponent(guildId)}/points/adjust`, 'POST', {
        tenantId,
        email,
        action,
        points,
      });
      showFlash('success', 'Customer points updated.');
      setAdjustPoints('');
      await loadCustomers(deferredSearch.trim());
    } catch (adjustError) {
      showFlash('error', getMessage(adjustError, 'Failed to adjust customer points.'));
    }
  }

  function prepareCustomerAction(customer: PointsCustomerRecord, action: 'add' | 'set' | 'clear') {
    setActivePointsPanel('customer-points');
    setAdjustEmail(customer.emailDisplay);
    setAdjustAction(action);
    setAdjustPoints(action === 'set' ? String(customer.balancePoints) : '');
  }

  function parseCustomerActionPoints(): number {
    if (adjustAction === 'clear') {
      return 0;
    }

    if (adjustAction === 'set') {
      const trimmed = adjustPoints.trim();
      if (!/^\d+$/.test(trimmed)) {
        throw new Error('Balance must be zero or a positive whole number.');
      }

      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('Balance must be zero or a positive whole number.');
      }

      return parsed;
    }

    return parseWholePoints(adjustPoints);
  }

  return (
    <SectionShell
      eyebrow="Points"
      title="Points system"
      description="Use a clean feature gate, focused sidebar steps, and a guided customer balance manager."
    >
      <FlashBanner />
      <DashboardSetupState />

      {isLinkedToCurrentTenant ? (
        <div className="min-w-0 space-y-5">
          <Panel
            title={
              <span className="flex items-center gap-2">
                Feature toggle
                <InfoButton label="Turning points off hides the controls in the panel and blocks point usage in checkout and admin flows." />
              </span>
            }
            description="Disable points to hide balances and stop points usage in sales flows."
          >
            <div className="flex flex-col gap-4 rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Enable points</p>
                <p className="text-sm text-muted-foreground">
                  When disabled, the API blocks customer balance reads and manual adjustments.
                </p>
              </div>
              <FeatureToggle
                checked={Boolean(config?.pointsEnabled)}
                label="Enable points"
                disabled={actionPending}
                onChange={(checked) => void saveConfig({ pointsEnabled: checked })}
              />
            </div>
          </Panel>

          {config?.pointsEnabled ? (
            <div className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1fr)]">
              <SectionMenu
                title="Points Menu"
                items={pointsMenuItems}
                activeId={activePointsPanel}
                onChange={setActivePointsPanel}
              />

              <div className="min-w-0 space-y-5">
                {activePointsPanel === 'reward-settings' ? (
                  <Panel
                    title={
                      <span className="flex items-center gap-2">
                        Reward settings
                        <InfoButton label="Set how much each point is worth when customers redeem them in checkout." />
                      </span>
                    }
                    description="Define the value per point for this server."
                    action={
                      <Button type="button" className="min-h-10" disabled={actionPending} onClick={() => void handleSaveRules()}>
                        <Save className="size-4" />
                        Save Rules
                      </Button>
                    }
                  >
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="point-value">Value per point</Label>
                        <Input
                          id="point-value"
                          value={pointValueMajor}
                          onChange={(event) => setPointValueMajor(event.target.value)}
                          placeholder={DEFAULT_POINT_VALUE_MAJOR}
                        />
                      </div>
                      <InfoTip>
                        Reward value is saved separately from category eligibility so you can tune the value without
                        changing where points are earned or redeemed.
                      </InfoTip>
                    </div>
                  </Panel>
                ) : null}

                {activePointsPanel === 'earning-categories' ? (
                  <Panel
                    title={
                      <span className="flex items-center gap-2">
                        Earning categories
                        <InfoButton label="Customers only earn points from paid sales in the categories you check here." />
                      </span>
                    }
                    description="Choose which product categories should generate points."
                    action={
                      <Button type="button" className="min-h-10" disabled={actionPending} onClick={() => void handleSaveRules()}>
                        <Save className="size-4" />
                        Save Rules
                      </Button>
                    }
                  >
                    <div className="space-y-3">
                      {categories.length ? (
                        categories.map((category) => (
                          <label
                            key={`earn-${category.name}`}
                            className="flex items-center gap-3 rounded-[1.05rem] border border-border/70 bg-background/70 px-3 py-3 text-sm"
                          >
                            <Checkbox
                              checked={earnCategories.includes(category.name)}
                              onCheckedChange={(checked) =>
                                setEarnCategories((current) =>
                                  checked === true
                                    ? [...new Set([...current, category.name])]
                                    : current.filter((entry) => entry !== category.name),
                                )
                              }
                            />
                            <span>{category.name}</span>
                          </label>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">Create product categories first.</p>
                      )}
                    </div>
                  </Panel>
                ) : null}

                {activePointsPanel === 'redemption-categories' ? (
                  <Panel
                    title={
                      <span className="flex items-center gap-2">
                        Redemption categories
                        <InfoButton label="Only the categories selected here will allow points to be spent during checkout." />
                      </span>
                    }
                    description="Choose which categories can accept points as a discount."
                    action={
                      <Button type="button" className="min-h-10" disabled={actionPending} onClick={() => void handleSaveRules()}>
                        <Save className="size-4" />
                        Save Rules
                      </Button>
                    }
                  >
                    <div className="space-y-3">
                      {categories.length ? (
                        categories.map((category) => (
                          <label
                            key={`redeem-${category.name}`}
                            className="flex items-center gap-3 rounded-[1.05rem] border border-border/70 bg-background/70 px-3 py-3 text-sm"
                          >
                            <Checkbox
                              checked={redeemCategories.includes(category.name)}
                              onCheckedChange={(checked) =>
                                setRedeemCategories((current) =>
                                  checked === true
                                    ? [...new Set([...current, category.name])]
                                    : current.filter((entry) => entry !== category.name),
                                )
                              }
                            />
                            <span>{category.name}</span>
                          </label>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">Create product categories first.</p>
                      )}
                    </div>
                  </Panel>
                ) : null}

                {activePointsPanel === 'customer-points' ? (
                  <Panel
                    title={
                      <span className="flex items-center gap-2">
                        Customer points
                        <InfoButton label="Search a customer, inspect their balance, then add points, edit their balance, or clear it back to zero." />
                      </span>
                    }
                    description="View, add, edit, and delete customer point balances."
                  >
                    <div className="space-y-5">
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
                        <div className="space-y-3">
                          <Label htmlFor="customer-search">Search customers</Label>
                          <Input
                            id="customer-search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="customer@example.com"
                          />
                          {shouldShowCustomerPointsLoading({
                            loadingCustomers,
                            customerCount: customers.length,
                          }) ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="size-4 animate-spin" />
                              Loading balances...
                            </div>
                          ) : null}
                          <div className="space-y-3">
                            {customers.length ? (
                              customers.map((customer) => (
                                <div
                                  key={customer.emailNormalized}
                                  className="rounded-[1.15rem] border border-border/70 bg-background/70 px-4 py-4"
                                >
                                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                    <div className="min-w-0">
                                      <p className="truncate font-medium">{customer.emailDisplay}</p>
                                      <p className="mt-1 text-sm text-muted-foreground">
                                        Balance {customer.balancePoints} / Reserved {customer.reservedPoints} / Available {customer.availablePoints}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => prepareCustomerAction(customer, 'add')}
                                      >
                                        Add
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => prepareCustomerAction(customer, 'set')}
                                      >
                                        Edit
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => prepareCustomerAction(customer, 'clear')}
                                      >
                                        Delete
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-muted-foreground">No customer balances found for this query.</p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-3 rounded-[1.2rem] border border-border/70 bg-background/70 p-4">
                          <p className="font-semibold">Manage customer points</p>
                          <div className="space-y-2">
                            <Label htmlFor="adjust-email">Customer email</Label>
                            <Input
                              id="adjust-email"
                              value={adjustEmail}
                              onChange={(event) => setAdjustEmail(event.target.value)}
                              placeholder="customer@example.com"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="adjust-action">Action</Label>
                            <select
                              id="adjust-action"
                              className={nativeSelectClass}
                              value={adjustAction}
                              onChange={(event) => setAdjustAction(event.target.value as 'add' | 'set' | 'clear')}
                            >
                              <option value="add">Add points</option>
                              <option value="set">Edit balance</option>
                              <option value="clear">Delete balance</option>
                            </select>
                          </div>
                          {adjustAction !== 'clear' ? (
                            <div className="space-y-2">
                              <Label htmlFor="adjust-points">{adjustAction === 'set' ? 'New balance' : 'Points'}</Label>
                              <Input
                                id="adjust-points"
                                value={adjustPoints}
                                onChange={(event) => setAdjustPoints(event.target.value)}
                                placeholder={adjustAction === 'set' ? '0' : '100'}
                              />
                            </div>
                          ) : (
                            <InfoTip>Delete balance will clear the customer balance back to zero.</InfoTip>
                          )}
                          <Button
                            type="button"
                            className="min-h-11 w-full"
                            onClick={() => {
                              try {
                                const points = parseCustomerActionPoints();
                                void adjustCustomerPoints(adjustEmail.trim(), adjustAction, points);
                              } catch (parseError) {
                                showFlash(
                                  'error',
                                  getMessage(parseError, 'Points must be entered as a whole number.'),
                                );
                              }
                            }}
                          >
                            <Gift className="size-4" />
                            {adjustAction === 'add'
                              ? 'Add Points'
                              : adjustAction === 'set'
                                ? 'Save Balance'
                                : 'Delete Balance'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Panel>
                ) : null}
              </div>
            </div>
          ) : (
            <InfoTip>Points are currently disabled. Enable the feature to manage earning, redemption, and customer balances.</InfoTip>
          )}
        </div>
      ) : null}
    </SectionShell>
  );
}

export function ReferralsSection() {
  const { actionPending, categories, config, isLinkedToCurrentTenant, resources, saveConfig } =
    useDashboardContext();
  const [referralsEnabled, setReferralsEnabled] = useState(false);
  const [referralLogChannelId, setReferralLogChannelId] = useState('');
  const [submissionTemplate, setSubmissionTemplate] = useState(DEFAULT_REFERRAL_SUBMISSION_TEMPLATE);
  const [thankYouTemplate, setThankYouTemplate] = useState(DEFAULT_REFERRAL_THANK_YOU_TEMPLATE);
  const [referralRewardMajor, setReferralRewardMajor] = useState(DEFAULT_REFERRAL_REWARD_MAJOR);
  const [rewardCategories, setRewardCategories] = useState<string[]>([]);

  useEffect(() => {
    if (!config) {
      return;
    }

    setReferralsEnabled(config.referralsEnabled);
    setReferralLogChannelId(config.referralLogChannelId ?? '');
    setSubmissionTemplate(config.referralSubmissionTemplate || DEFAULT_REFERRAL_SUBMISSION_TEMPLATE);
    setThankYouTemplate(config.referralThankYouTemplate || DEFAULT_REFERRAL_THANK_YOU_TEMPLATE);
    setReferralRewardMajor(formatMinorToMajor(config.referralRewardMinor));
    setRewardCategories(config.referralRewardCategoryKeys);
  }, [config]);

  async function handleSave() {
    try {
      await saveConfig({
        referralsEnabled,
        referralLogChannelId: referralLogChannelId || null,
        referralSubmissionTemplate: submissionTemplate,
        referralThankYouTemplate: thankYouTemplate,
        referralRewardMinor: parsePriceToMinor(referralRewardMajor),
        referralRewardCategoryKeys: rewardCategories,
      });
    } catch {}
  }

  return (
    <SectionShell
      eyebrow="Referrals"
      title="Referral system"
      description="Control the referral toggle, log destination, auto-reply copy, and which product categories can issue referral rewards."
      action={
        <Button type="button" className="min-h-11" disabled={actionPending || !isLinkedToCurrentTenant} onClick={() => void handleSave()}>
          {actionPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save Referrals
        </Button>
      }
    >
      <FlashBanner />
      <DashboardSetupState />

      {isLinkedToCurrentTenant ? (
        <div className="space-y-5">
          <Panel title="Feature toggle" description="Disable referrals to hide the settings and block new referral submissions.">
            <div className="flex flex-col gap-4 rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Enable referrals</p>
                <p className="text-sm text-muted-foreground">
                  Referrals depend on the points system because rewards are paid out in points.
                </p>
              </div>
              <FeatureToggle checked={referralsEnabled} label="Enable referrals" onChange={setReferralsEnabled} />
            </div>
          </Panel>

          {referralsEnabled ? (
            <>
              <Panel title="Reward settings" description="Choose the reward amount and where referral logs should be posted.">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="referral-reward">Referral reward</Label>
                    <Input
                      id="referral-reward"
                      value={referralRewardMajor}
                      onChange={(event) => setReferralRewardMajor(event.target.value)}
                      placeholder={DEFAULT_REFERRAL_REWARD_MAJOR}
                    />
                    <p className="text-xs text-muted-foreground">
                      Rough points preview: {previewReferralRewardPoints(referralRewardMajor, formatPointValueMinorToMajor(config?.pointValueMinor ?? 1))}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="referral-log-channel">Referral log channel</Label>
                    <select
                      id="referral-log-channel"
                      className={nativeSelectClass}
                      value={referralLogChannelId}
                      onChange={(event) => setReferralLogChannelId(event.target.value)}
                    >
                      <option value="">Select channel</option>
                      {resources?.channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          #{channel.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <p className="text-sm font-semibold">Reward categories</p>
                  {categories.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {categories.map((category) => (
                        <label
                          key={category.name}
                          className="flex items-center gap-3 rounded-[1.05rem] border border-border/70 bg-background/70 px-3 py-3 text-sm"
                        >
                          <Checkbox
                            checked={rewardCategories.includes(category.name)}
                            onCheckedChange={(checked) =>
                              setRewardCategories((current) =>
                                checked === true
                                  ? [...new Set([...current, category.name])]
                                  : current.filter((entry) => entry !== category.name),
                              )
                            }
                          />
                          <span>{category.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Create product categories before scoping referral rewards.</p>
                  )}
                </div>
              </Panel>

              <Panel title="Referral messages" description="Adjust the copy users see after they submit a referral and after a reward is paid.">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="submission-template">Submission message</Label>
                    <Textarea
                      id="submission-template"
                      value={submissionTemplate}
                      onChange={(event) => setSubmissionTemplate(event.target.value)}
                      className="min-h-28"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="thank-you-template">Thank you message</Label>
                    <Textarea
                      id="thank-you-template"
                      value={thankYouTemplate}
                      onChange={(event) => setThankYouTemplate(event.target.value)}
                      className="min-h-28"
                    />
                  </div>
                </div>
              </Panel>
            </>
          ) : (
            <InfoTip>Referrals are currently disabled for this server.</InfoTip>
          )}
        </div>
      ) : null}
    </SectionShell>
  );
}

function blankQuestion(sortOrder: number): QuestionDraft {
  return {
    key: `question_${sortOrder + 1}`,
    label: '',
    fieldType: 'short_text',
    required: false,
    sensitive: false,
    sortOrder,
  };
}

function questionDraftsFromProduct(product: ProductRecord | null): QuestionDraft[] {
  if (!product) {
    return ensureRequiredEmailQuestion([]);
  }

  return ensureRequiredEmailQuestion(
    product.formFields.map((field, index) => ({
      key: field.fieldKey,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      sensitive: field.sensitive,
      sortOrder: field.sortOrder ?? index,
    })),
  );
}

function blankVariant(): PriceOptionDraft {
  return {
    label: '',
    priceMajor: '',
    referralRewardMajor: DEFAULT_REFERRAL_REWARD_MAJOR,
    currency: DEFAULT_CURRENCY,
  };
}

export function ProductsSection() {
  const { categories, config, guildId, isLinkedToCurrentTenant, products, refreshProducts, showFlash, tenantId } =
    useDashboardContext();
  const [activeProductsPanel, setActiveProductsPanel] =
    useState<(typeof productsMenuItems)[number]['id']>('categories');
  const [categoryName, setCategoryName] = useState('');
  const [categoryRenameTo, setCategoryRenameTo] = useState('');
  const [categoryProductId, setCategoryProductId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionDraft[]>(ensureRequiredEmailQuestion([]));

  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productCategory, setProductCategory] = useState('');
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [productActive, setProductActive] = useState(true);
  const [variants, setVariants] = useState<PriceOptionDraft[]>([]);
  const [variantDraft, setVariantDraft] = useState(blankVariant());
  const [editingVariantIndex, setEditingVariantIndex] = useState<number | null>(null);
  const draftCategoryOption = categoryName.trim();
  const productCategoryOptions = [
    ...categories.map((category) => category.name),
    ...(
      draftCategoryOption &&
      !categories.some((category) => normalizeCategoryKey(category.name) === normalizeCategoryKey(draftCategoryOption))
        ? [draftCategoryOption]
        : []
    ),
  ];

  function resetCategoryEditor() {
    setCategoryName('');
    setCategoryRenameTo('');
    setCategoryProductId(null);
    setQuestions(ensureRequiredEmailQuestion([]));
  }

  function resetProductEditor(nextCategory = '') {
    setEditingProductId(null);
    setProductCategory(nextCategory);
    setProductName('');
    setProductDescription('');
    setProductActive(true);
    setVariants([]);
    setVariantDraft(blankVariant());
    setEditingVariantIndex(null);
  }

  function editCategory(categoryNameValue: string) {
    const category = categories.find(
      (entry) => normalizeCategoryKey(entry.name) === normalizeCategoryKey(categoryNameValue),
    );
    const product = products.find((entry) => entry.id === category?.productId) ?? null;
    setActiveProductsPanel('categories');
    setCategoryName(category?.name ?? categoryNameValue);
    setCategoryRenameTo(category?.name ?? categoryNameValue);
    setCategoryProductId(category?.productId ?? null);
    setQuestions(questionDraftsFromProduct(product));
  }

  function editProduct(product: ProductRecord) {
    setActiveProductsPanel('products');
    setEditingProductId(product.id);
    setProductCategory(product.category);
    setProductName(product.name);
    setProductDescription(product.description);
    setProductActive(product.active);
    setVariants(
      product.variants.map((variant) => ({
        label: variant.label,
        priceMajor: formatMinorToMajor(variant.priceMinor),
        referralRewardMajor: formatMinorToMajor(variant.referralRewardMinor),
        currency: variant.currency,
      })),
    );
    setVariantDraft(blankVariant());
    setEditingVariantIndex(null);
  }

  function saveVariantDraft() {
    const preparedVariant = {
      label: variantDraft.label.trim(),
      priceMajor: variantDraft.priceMajor.trim(),
      referralRewardMajor: variantDraft.referralRewardMajor.trim() || DEFAULT_REFERRAL_REWARD_MAJOR,
      currency: DEFAULT_CURRENCY,
    };

    if (!preparedVariant.label || !preparedVariant.priceMajor) {
      showFlash('error', 'Each price option needs a label and a price.');
      return;
    }

    setVariants((current) => {
      if (editingVariantIndex === null) {
        return [...current, preparedVariant];
      }

      return current.map((variant, index) => (index === editingVariantIndex ? preparedVariant : variant));
    });

    setVariantDraft(blankVariant());
    setEditingVariantIndex(null);
  }

  async function saveCategoryQuestions() {
    const preparedQuestions = ensureRequiredEmailQuestion(
      questions.map((question, index) => ({
        key: question.key.trim(),
        label: question.label.trim() || question.key.trim(),
        fieldType: question.fieldType,
        required: question.required,
        sensitive: question.sensitive,
        sortOrder: index,
      })),
    );

    try {
      if (categoryProductId) {
        await dashboardApi(
          `/api/guilds/${encodeURIComponent(guildId)}/forms/${encodeURIComponent(categoryProductId)}`,
          'PUT',
          {
            tenantId,
            formFields: preparedQuestions,
          },
        );
        await refreshProducts();
        showFlash('success', 'Category questions updated.');
        return;
      }

      showFlash(
        'info',
        'Category draft created. Move to Products and select this category to publish the first product with these questions.',
      );
      setProductCategory(categoryName.trim());
      setActiveProductsPanel('products');
    } catch (saveError) {
      showFlash('error', getMessage(saveError, 'Failed to save category questions.'));
    }
  }

  async function renameCategory() {
    if (!categoryName.trim() || !categoryRenameTo.trim()) {
      showFlash('error', 'Choose a category first, then enter the new name.');
      return;
    }

    try {
      await dashboardApi(`/api/guilds/${encodeURIComponent(guildId)}/categories`, 'PATCH', {
        tenantId,
        category: categoryName.trim(),
        newCategory: categoryRenameTo.trim(),
      });
      await refreshProducts();
      showFlash('success', 'Category renamed.');
      resetCategoryEditor();
    } catch (renameError) {
      showFlash('error', getMessage(renameError, 'Failed to rename category.'));
    }
  }

  async function deleteCategory(categoryNameValue: string) {
    try {
      await dashboardApi(`/api/guilds/${encodeURIComponent(guildId)}/categories`, 'DELETE', {
        tenantId,
        category: categoryNameValue,
      });
      await refreshProducts();
      showFlash('success', 'Category deleted.');
      resetCategoryEditor();
      if (normalizeCategoryKey(productCategory) === normalizeCategoryKey(categoryNameValue)) {
        resetProductEditor('');
      }
    } catch (deleteError) {
      showFlash('error', getMessage(deleteError, 'Failed to delete category.'));
    }
  }

  async function saveProduct() {
    const normalizedCategory = productCategory.trim();
    const existingCategory = categories.find(
      (category) => normalizeCategoryKey(category.name) === normalizeCategoryKey(normalizedCategory),
    );

    if (!normalizedCategory || !productName.trim() || variants.length === 0) {
      showFlash('error', 'A product needs a category, name, and at least one price option.');
      return;
    }

    const preparedVariants = variants.map((variant) => ({
      label: variant.label.trim(),
      priceMinor: parsePriceToMinor(variant.priceMajor),
      referralRewardMinor: config?.referralsEnabled ? parsePriceToMinor(variant.referralRewardMajor) : 0,
      currency: DEFAULT_CURRENCY,
    }));

    const payload = {
      category: normalizedCategory,
      name: productName.trim(),
      description: productDescription.trim(),
      active: productActive,
      variants: preparedVariants,
    };

    try {
      if (editingProductId) {
        await dashboardApi(
          `/api/guilds/${encodeURIComponent(guildId)}/products/${encodeURIComponent(editingProductId)}`,
          'PATCH',
          {
            tenantId,
            product: payload,
          },
        );
        showFlash('success', 'Product updated.');
      } else {
        const preparedQuestions =
          existingCategory || normalizeCategoryKey(categoryName) !== normalizeCategoryKey(normalizedCategory)
            ? []
            : ensureRequiredEmailQuestion(questions);

        if (!existingCategory && preparedQuestions.length === 0) {
          showFlash(
            'error',
            'Prepare the category questions first so the first product can publish that category template.',
          );
          return;
        }

        await dashboardApi(`/api/guilds/${encodeURIComponent(guildId)}/products`, 'POST', {
          tenantId,
          product: payload,
          formFields: preparedQuestions,
        });
        showFlash('success', 'Product created.');
      }

      await refreshProducts();
      resetProductEditor(existingCategory?.name ?? normalizedCategory);
    } catch (saveError) {
      showFlash('error', getMessage(saveError, 'Failed to save product.'));
    }
  }

  async function deleteProduct(productId: string) {
    try {
      await dashboardApi(
        `/api/guilds/${encodeURIComponent(guildId)}/products/${encodeURIComponent(productId)}?tenantId=${encodeURIComponent(tenantId)}`,
        'DELETE',
      );
      await refreshProducts();
      showFlash('success', 'Product deleted.');
      if (editingProductId === productId) {
        resetProductEditor('');
      }
    } catch (deleteError) {
      showFlash('error', getMessage(deleteError, 'Failed to delete product.'));
    }
  }

  return (
    <SectionShell
      eyebrow="Products"
      title="Product catalog"
      description="Build categories with custom questions, then create products with clear price options and optional referral rewards."
    >
      <FlashBanner />
      <DashboardSetupState />

      {isLinkedToCurrentTenant ? (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1fr)]">
            <SectionMenu
              title="Products Menu"
              items={productsMenuItems}
              activeId={activeProductsPanel}
              onChange={setActiveProductsPanel}
            />

            <div className="space-y-5">
            {activeProductsPanel === 'categories' ? (
            <Panel
              title={
                <span className="flex items-center gap-2">
                  Categories & questions
                  <InfoButton label="Create the category structure and custom question set here first, then move to Products to build the actual sellable item." />
                </span>
              }
              description="Edit an existing category template, or prepare a new category draft before creating its first product."
            >
              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Saved categories</p>
                    <Badge variant="outline">{categories.length}</Badge>
                  </div>
                  {categories.length ? (
                    categories.map((category) => (
                      <div
                        key={category.name}
                        className="flex flex-col gap-3 rounded-[1.1rem] border border-border/70 bg-background/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{category.name}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {category.productCount} product{category.productCount === 1 ? '' : 's'} / {category.questionCount} question{category.questionCount === 1 ? '' : 's'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => editCategory(category.name)}>
                            Edit
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => void deleteCategory(category.name)}>
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No categories exist yet. Start with a draft below.</p>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="category-name">Category name</Label>
                    <Input
                      id="category-name"
                      value={categoryName}
                      onChange={(event) => setCategoryName(event.target.value)}
                      placeholder="Boosting"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category-rename">Rename category</Label>
                    <Input
                      id="category-rename"
                      value={categoryRenameTo}
                      onChange={(event) => setCategoryRenameTo(event.target.value)}
                      placeholder="New category name"
                    />
                  </div>
                </div>

                <InfoTip>
                  The first email field is always enforced automatically so paid-order and referral flows
                  stay compatible with the backend rules.
                </InfoTip>

                <div className="space-y-3">
                  {questions.map((question, index) => {
                    const lockedEmail = index === 0 && normalizeCategoryKey(question.key) === 'email';
                    return (
                      <div key={`${question.key}-${index}`} className="rounded-[1.15rem] border border-border/70 bg-background/70 p-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={`question-key-${index}`}>Field key</Label>
                            <Input
                              id={`question-key-${index}`}
                              value={question.key}
                              disabled={lockedEmail}
                              onChange={(event) =>
                                setQuestions((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, key: event.target.value } : entry,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`question-label-${index}`}>Label</Label>
                            <Input
                              id={`question-label-${index}`}
                              value={question.label}
                              disabled={lockedEmail}
                              onChange={(event) =>
                                setQuestions((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, label: event.target.value } : entry,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`question-type-${index}`}>Field type</Label>
                            <select
                              id={`question-type-${index}`}
                              className={nativeSelectClass}
                              value={question.fieldType}
                              disabled={lockedEmail}
                              onChange={(event) =>
                                setQuestions((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, fieldType: event.target.value as QuestionDraft['fieldType'] }
                                      : entry,
                                  ),
                                )
                              }
                            >
                              <option value="short_text">Short text</option>
                              <option value="long_text">Long text</option>
                              <option value="email">Email</option>
                              <option value="number">Number</option>
                            </select>
                          </div>
                          <div className="flex flex-wrap gap-4 pt-7">
                            <label className="flex items-center gap-3 text-sm">
                              <Checkbox
                                checked={question.required}
                                disabled={lockedEmail}
                                onCheckedChange={(checked) =>
                                  setQuestions((current) =>
                                    current.map((entry, entryIndex) =>
                                      entryIndex === index ? { ...entry, required: checked === true } : entry,
                                    ),
                                  )
                                }
                              />
                              Required
                            </label>
                            <label className="flex items-center gap-3 text-sm">
                              <Checkbox
                                checked={question.sensitive}
                                disabled={lockedEmail}
                                onCheckedChange={(checked) =>
                                  setQuestions((current) =>
                                    current.map((entry, entryIndex) =>
                                      entryIndex === index ? { ...entry, sensitive: checked === true } : entry,
                                    ),
                                  )
                                }
                              />
                              Sensitive
                            </label>
                            {!lockedEmail ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setQuestions((current) =>
                                    ensureRequiredEmailQuestion(current.filter((_, entryIndex) => entryIndex !== index)),
                                  )
                                }
                              >
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 sm:flex-1"
                    onClick={() =>
                      setQuestions((current) =>
                        ensureRequiredEmailQuestion([...current, blankQuestion(current.length)]),
                      )
                    }
                  >
                    <Plus className="size-4" />
                    Add Question
                  </Button>
                      <Button type="button" className="min-h-11 sm:flex-1" onClick={() => void saveCategoryQuestions()}>
                        <Save className="size-4" />
                        {categoryProductId ? 'Save Questions' : 'Create Category Draft'}
                      </Button>
                      {categoryProductId ? (
                        <Button type="button" variant="outline" className="min-h-11 sm:flex-1" onClick={() => void renameCategory()}>
                          Rename Category
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Panel>
            ) : null}

            {activeProductsPanel === 'products' ? (
            <>
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    {editingProductId ? 'Edit product' : 'Add product'}
                    <InfoButton label="Select an existing category or a prepared draft category, then build the product with description, pricing, and optional referral reward." />
                  </span>
                }
                description="Create a clean step-by-step product entry with category, description, pricing, and referral reward support."
              >
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="product-category">Select category</Label>
                      <select
                        id="product-category"
                        className={nativeSelectClass}
                        value={productCategory}
                        onChange={(event) => setProductCategory(event.target.value)}
                        disabled={productCategoryOptions.length === 0}
                      >
                        <option value="">
                          {productCategoryOptions.length ? 'Select category' : 'Create or draft a category first'}
                        </option>
                        {productCategoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {category === draftCategoryOption &&
                            !categories.some(
                              (entry) => normalizeCategoryKey(entry.name) === normalizeCategoryKey(category),
                            )
                              ? `${category} (Draft questions ready)`
                              : category}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="product-name">Product name</Label>
                      <Input
                        id="product-name"
                        value={productName}
                        onChange={(event) => setProductName(event.target.value)}
                        placeholder="Starter boost package"
                      />
                    </div>
                  </div>

                  {productCategoryOptions.length === 0 ? (
                    <InfoTip>Build a category first in Categories & Questions, then come back here to select it.</InfoTip>
                  ) : null}

                  <div className="space-y-2">
                    <Label htmlFor="product-description">Description</Label>
                    <Textarea
                      id="product-description"
                      value={productDescription}
                      onChange={(event) => setProductDescription(event.target.value)}
                      className="min-h-24"
                      placeholder="What the customer is buying and how it is fulfilled."
                    />
                  </div>

                  <label className="flex items-center gap-3 rounded-[1.05rem] border border-border/70 bg-background/70 px-4 py-3 text-sm">
                    <Checkbox
                      checked={productActive}
                      onCheckedChange={(checked) => setProductActive(checked === true)}
                    />
                    <span>Product active</span>
                  </label>

                  <div className="rounded-[1.15rem] border border-border/70 bg-background/70 p-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="variant-label">Variation label</Label>
                        <Input
                          id="variant-label"
                          value={variantDraft.label}
                          onChange={(event) =>
                            setVariantDraft((current) => ({ ...current, label: event.target.value }))
                          }
                          placeholder="Gold plan"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="variant-price">Price</Label>
                        <Input
                          id="variant-price"
                          value={variantDraft.priceMajor}
                          onChange={(event) =>
                            setVariantDraft((current) => ({ ...current, priceMajor: event.target.value }))
                          }
                          placeholder="9.99"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="variant-referral">Referral reward</Label>
                        <Input
                          id="variant-referral"
                          value={variantDraft.referralRewardMajor}
                          onChange={(event) =>
                            setVariantDraft((current) => ({
                              ...current,
                              referralRewardMajor: event.target.value,
                            }))
                          }
                          disabled={!config?.referralsEnabled}
                          placeholder={DEFAULT_REFERRAL_REWARD_MAJOR}
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <Button type="button" variant="outline" className="min-h-11 sm:flex-1" onClick={saveVariantDraft}>
                        <Plus className="size-4" />
                        {editingVariantIndex === null ? 'Add Price Option' : 'Save Price Option'}
                      </Button>
                      {editingVariantIndex !== null ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11 sm:flex-1"
                          onClick={() => {
                            setEditingVariantIndex(null);
                            setVariantDraft(blankVariant());
                          }}
                        >
                          Cancel Variant Edit
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {variants.length ? (
                      variants.map((variant, index) => (
                        <div
                          key={`${variant.label}-${index}`}
                          className="flex flex-col gap-3 rounded-[1.1rem] border border-border/70 bg-background/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="font-medium">{variant.label}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {variant.priceMajor} {DEFAULT_CURRENCY}
                              {config?.referralsEnabled
                                ? ` / Referral reward ${variant.referralRewardMajor} ${DEFAULT_CURRENCY}`
                                : ''}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingVariantIndex(index);
                                setVariantDraft(variant);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setVariants((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No price options yet.</p>
                    )}
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button type="button" className="min-h-11 sm:flex-1" onClick={() => void saveProduct()}>
                      <Package2 className="size-4" />
                      {editingProductId ? 'Update Product' : 'Create Product'}
                    </Button>
                    {editingProductId ? (
                      <Button type="button" variant="outline" className="min-h-11 sm:flex-1" onClick={() => resetProductEditor(productCategory)}>
                        Cancel Edit
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Panel>

              <Panel title="Saved products" description="Existing products for the current Discord server.">
                {products.length ? (
                  <div className="space-y-3">
                    {products.map((product) => (
                      <div
                        key={product.id}
                        className="flex flex-col gap-3 rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-4 xl:flex-row xl:items-center xl:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-medium">{product.name}</p>
                            <Badge variant="outline">{product.category}</Badge>
                            <Badge variant="outline">{product.active ? 'Active' : 'Inactive'}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {product.variants.length} variation{product.variants.length === 1 ? '' : 's'} / {product.formFields.length} question{product.formFields.length === 1 ? '' : 's'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => editProduct(product)}>
                            Edit
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => void deleteProduct(product.id)}>
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No products have been created yet.</p>
                )}
              </Panel>
            </>
            ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </SectionShell>
  );
}

'use client';

import { ArrowRight, CheckCircle2, Loader2, Server, Sparkles, Store } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ConfirmationModal } from '@/components/dashboard/dashboard-primitives';
import { Button } from '@/components/ui/button';
import { dashboardApi } from '@/lib/dashboard-api';
import type { DashboardSessionData } from '@/lib/dashboard-session';
import { cn } from '@/lib/utils';

type DashboardLaunchpadProps = {
  data: DashboardSessionData;
};

function buildInitialTenantId(data: DashboardSessionData): string {
  if (data.tenants.length === 0) {
    return '';
  }

  const firstWithGuilds = data.tenants.find((tenant) => (data.tenantGuildsByTenantId[tenant.id] ?? []).length > 0);
  return firstWithGuilds?.id ?? data.tenants[0]?.id ?? '';
}

export function DashboardLaunchpad({ data }: DashboardLaunchpadProps) {
  const router = useRouter();
  const [tenants, setTenants] = useState(data.tenants);
  const [tenantGuildsByTenantId, setTenantGuildsByTenantId] = useState(data.tenantGuildsByTenantId);
  const [selectedTenantId, setSelectedTenantId] = useState(() => buildInitialTenantId(data));
  const [selectedGuildId, setSelectedGuildId] = useState(data.discordGuilds[0]?.id ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingTenantId, setDeletingTenantId] = useState<string | null>(null);

  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;
  const selectedGuild = data.discordGuilds.find((guild) => guild.id === selectedGuildId) ?? null;
  const linkedGuilds = tenantGuildsByTenantId[selectedTenantId] ?? [];
  const linkedGuildIds = new Set(linkedGuilds.map((guild) => guild.guildId));
  const selectedGuildIsLinked = selectedGuildId ? linkedGuildIds.has(selectedGuildId) : false;
  const deletingTenant = tenants.find((tenant) => tenant.id === deletingTenantId) ?? null;

  useEffect(() => {
    if (selectedTenantId && tenants.some((tenant) => tenant.id === selectedTenantId)) {
      return;
    }

    const nextTenantId = buildInitialTenantId({
      ...data,
      tenants,
      tenantGuildsByTenantId,
    });
    if (nextTenantId) {
      setSelectedTenantId(nextTenantId);
      return;
    }

    setSelectedTenantId('');
  }, [data, selectedTenantId, tenantGuildsByTenantId, tenants]);

  useEffect(() => {
    if (!selectedGuildId && data.discordGuilds[0]?.id) {
      setSelectedGuildId(data.discordGuilds[0].id);
    }
  }, [data.discordGuilds, selectedGuildId]);

  async function continueToDashboard() {
    if (!selectedTenant || !selectedGuild) {
      setError('Choose a workspace and Discord server first.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      if (!selectedGuildIsLinked) {
        await dashboardApi<{ ok: true }>(
          `/api/guilds/${encodeURIComponent(selectedGuild.id)}/connect`,
          'POST',
          {
            tenantId: selectedTenant.id,
            guildName: selectedGuild.name,
          },
        );
      }

      router.push(
        `/dashboard/${encodeURIComponent(selectedTenant.id)}/${encodeURIComponent(selectedGuild.id)}`,
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to open the dashboard.');
      setSubmitting(false);
    }
  }

  async function deleteWorkspace() {
    if (!deletingTenant) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await dashboardApi<{ ok: true }>(`/api/tenants/${encodeURIComponent(deletingTenant.id)}`, 'DELETE');

      const nextTenants = tenants.filter((tenant) => tenant.id !== deletingTenant.id);
      setTenants(nextTenants);
      setTenantGuildsByTenantId((current) => {
        const next = { ...current };
        delete next[deletingTenant.id];
        return next;
      });
      setDeletingTenantId(null);

      if (selectedTenantId === deletingTenant.id) {
        const replacement =
          nextTenants.find((tenant) => (tenantGuildsByTenantId[tenant.id] ?? []).length > 0)?.id ??
          nextTenants[0]?.id ??
          '';
        setSelectedTenantId(replacement);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete workspace.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_22rem]">
        <div className="space-y-5">
        <div className="rounded-[1.9rem] border border-border/70 bg-card/85 p-6 shadow-[0_28px_80px_-36px_rgba(0,0,0,0.6)] backdrop-blur sm:p-7">
          <div className="flex items-start gap-4">
            <span className="inline-flex size-12 items-center justify-center rounded-[1.25rem] border border-primary/30 bg-primary/12 text-primary">
              <Sparkles className="size-5" />
            </span>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Entry Flow
              </p>
              <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-tight sm:text-4xl">
                Choose a workspace, then open the server panel.
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                The panel keeps the next steps clean: connect the bot, review status, then manage settings,
                payments, coupons, points, referrals, and products from the sidebar.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-[1.75rem] border border-border/70 bg-card/80 p-5 shadow-[0_20px_50px_-28px_rgba(0,0,0,0.5)] backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-10 items-center justify-center rounded-full border border-border/70 bg-background/80 text-sm font-semibold text-primary">
                01
              </span>
              <div>
                <h2 className="font-semibold">Pick a workspace</h2>
                <p className="text-sm text-muted-foreground">This decides where the server config is stored.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {tenants.length === 0 ? (
                <p className="rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                  No workspaces are available on this account yet.
                </p>
              ) : (
                tenants.map((tenant) => {
                  const active = tenant.id === selectedTenantId;
                  const linkedCount = tenantGuildsByTenantId[tenant.id]?.length ?? 0;

                  return (
                    <button
                      key={tenant.id}
                      type="button"
                      onClick={() => setSelectedTenantId(tenant.id)}
                      className={cn(
                        'w-full rounded-[1.35rem] border px-4 py-4 text-left transition',
                        active
                          ? 'border-primary/45 bg-primary/10 shadow-[0_16px_40px_-28px_rgba(56,189,248,0.8)]'
                          : 'border-border/70 bg-background/70 hover:border-primary/25 hover:bg-background/85',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Store className="size-4 text-primary" />
                            <p className="truncate font-medium">{tenant.name}</p>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {linkedCount} linked server{linkedCount === 1 ? '' : 's'}
                          </p>
                        </div>
                        {active ? (
                          <span className="inline-flex rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                            Selected
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-border/70 bg-card/80 p-5 shadow-[0_20px_50px_-28px_rgba(0,0,0,0.5)] backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-10 items-center justify-center rounded-full border border-border/70 bg-background/80 text-sm font-semibold text-primary">
                02
              </span>
              <div>
                <h2 className="font-semibold">Choose a Discord server</h2>
                <p className="text-sm text-muted-foreground">Only servers you can manage appear here.</p>
              </div>
            </div>

            <div className="mt-4 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
              {data.discordGuilds.length === 0 ? (
                <p className="rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                  {data.discordGuildsError || 'No Discord servers were returned for this login.'}
                </p>
              ) : (
                data.discordGuilds.map((guild) => {
                  const active = guild.id === selectedGuildId;
                  const linked = linkedGuildIds.has(guild.id);

                  return (
                    <button
                      key={guild.id}
                      type="button"
                      onClick={() => setSelectedGuildId(guild.id)}
                      className={cn(
                        'w-full rounded-[1.35rem] border px-4 py-4 text-left transition',
                        active
                          ? 'border-primary/45 bg-primary/10 shadow-[0_16px_40px_-28px_rgba(56,189,248,0.8)]'
                          : 'border-border/70 bg-background/70 hover:border-primary/25 hover:bg-background/85',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Server className="size-4 text-primary" />
                            <p className="truncate font-medium">{guild.name}</p>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {linked ? 'Already linked to this workspace' : 'Will be linked when you open it'}
                          </p>
                        </div>
                        {linked ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-200">
                            <CheckCircle2 className="size-3.5" />
                            Linked
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

        <aside className="space-y-4 rounded-[1.9rem] border border-border/70 bg-card/85 p-5 shadow-[0_28px_80px_-36px_rgba(0,0,0,0.6)] backdrop-blur">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Ready To Open
          </p>
          <h2 className="font-[family-name:var(--font-display)] text-2xl">Panel summary</h2>
        </div>

        <div className="rounded-[1.35rem] border border-border/70 bg-background/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
          <p className="mt-2 font-medium">{selectedTenant?.name ?? 'Select a workspace'}</p>
        </div>

        <div className="rounded-[1.35rem] border border-border/70 bg-background/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Server</p>
          <p className="mt-2 font-medium">{selectedGuild?.name ?? 'Select a Discord server'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedGuild
              ? selectedGuildIsLinked
                ? 'Existing workspace connection found.'
                : 'The dashboard will connect this server on entry.'
              : 'Nothing selected yet.'}
          </p>
        </div>

        <div className="rounded-[1.35rem] border border-border/70 bg-secondary/35 p-4 text-sm text-muted-foreground">
          Settings, payments, coupons, points, referrals, and products will open inside a shared
          sidebar layout with dark and light mode support.
        </div>

        {data.me.isSuperAdmin && selectedTenant ? (
          <div
            data-tutorial="workspace-delete"
            className="rounded-[1.35rem] border border-destructive/30 bg-destructive/8 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-destructive/90">Super Admin</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Remove the selected merchant workspace and all linked store data when the environment should be retired.
            </p>
            <Button
              type="button"
              variant="destructive"
              className="mt-4 min-h-11 w-full"
              disabled={submitting}
              onClick={() => setDeletingTenantId(selectedTenant.id)}
            >
              Delete Workspace
            </Button>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[1.25rem] border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <Button
          type="button"
          size="lg"
          className="min-h-12 w-full"
          disabled={!selectedTenant || !selectedGuild || submitting}
          onClick={continueToDashboard}
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          {selectedGuildIsLinked ? 'Open Dashboard' : 'Link Server And Open'}
        </Button>
        </aside>
      </section>

      <ConfirmationModal
        open={Boolean(deletingTenant)}
        title="Delete workspace"
        description={
          deletingTenant ? (
            <>
              This will permanently remove <strong>{deletingTenant.name}</strong>, its linked servers, products,
              coupons, integrations, Telegram links, paid-order data, and customer points.
            </>
          ) : (
            'This action permanently removes the selected workspace.'
          )
        }
        confirmLabel={submitting ? 'Deleting...' : 'Delete Workspace'}
        confirmPhrase={deletingTenant?.name}
        confirmPlaceholder={deletingTenant?.name ?? 'Workspace name'}
        pending={submitting}
        onClose={() => setDeletingTenantId(null)}
        onConfirm={() => void deleteWorkspace()}
      />
    </>
  );
}

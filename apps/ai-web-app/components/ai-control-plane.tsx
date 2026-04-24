'use client';

import {
  BadgeCheck,
  Bot,
  BrainCircuit,
  CircleAlert,
  Cpu,
  Globe,
  LoaderCircle,
  LockKeyhole,
  MessagesSquare,
  Plus,
  RefreshCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Waypoints,
} from 'lucide-react';
import { useEffect, useEffectEvent, useState, useTransition, type FormEvent, type ReactNode } from 'react';

import { AI_APP_BRAND } from '@/lib/ai-design-tokens';
import type { AiDashboardGuild } from '@/lib/ai-session';
import { buildDashboardGuildUrl } from '@/lib/dashboard-url';

type TonePreset = 'professional' | 'standard' | 'witty' | 'cheeky';
type RoleMode = 'allowlist' | 'blocklist';
type ReplyMode = 'inline' | 'thread';
type ReplyFrequency = 'low' | 'mid' | 'max';

type SnapshotPayload = {
  guild: AiDashboardGuild;
  activation: {
    activated: boolean;
    authorizedUserCount: number;
  };
  settings: {
    guildId: string;
    enabled: boolean;
    tonePreset: TonePreset;
    toneInstructions: string;
    roleMode: RoleMode;
    defaultReplyMode: ReplyMode;
    replyFrequency: ReplyFrequency;
    unansweredLoggingEnabled: boolean;
    unansweredLogChannelId: string | null;
    replyChannels: Array<{
      channelId: string;
      replyMode: ReplyMode;
    }>;
    replyChannelCategories: Array<{
      categoryId: string;
      replyMode: ReplyMode;
    }>;
    roleIds: string[];
    createdAt: string | null;
    updatedAt: string | null;
  };
  diagnostics: {
    totals: {
      sourceCount: number;
      readySourceCount: number;
      failedSourceCount: number;
      syncingSourceCount: number;
      pendingSourceCount: number;
      documentCount: number;
      customQaCount: number;
    };
    lastSyncedAt: string | null;
    sources: Array<{
      sourceId: string;
      url: string;
      status: 'pending' | 'syncing' | 'ready' | 'failed';
      pageTitle: string | null;
      httpStatus: number | null;
      lastSyncedAt: string | null;
      lastSyncStartedAt: string | null;
      lastSyncError: string | null;
      documentCount: number;
      updatedAt: string;
    }>;
  };
  websiteSources: Array<{
    sourceId: string;
    url: string;
    status: 'pending' | 'syncing' | 'ready' | 'failed';
    lastSyncedAt: string | null;
    lastSyncStartedAt: string | null;
    lastSyncError: string | null;
    httpStatus: number | null;
    contentHash: string | null;
    pageTitle: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  discordChannelSources: Array<{
    sourceId: string;
    channelId: string;
    status: 'pending' | 'syncing' | 'ready' | 'failed';
    lastSyncedAt: string | null;
    lastSyncStartedAt: string | null;
    lastSyncError: string | null;
    lastMessageId: string | null;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  discordChannelCategorySources: Array<{
    sourceId: string;
    categoryId: string;
    createdAt: string;
    updatedAt: string;
  }>;
  customQas: Array<{
    customQaId: string;
    question: string;
    answer: string;
    updatedAt: string;
  }>;
};

type ResourcesPayload = {
  botInGuild: boolean;
  inviteUrl: string;
  guild: AiDashboardGuild;
  channels: Array<{ id: string; name: string; type: number; parentId: string | null }>;
  categoryChannels: Array<{ id: string; name: string; type: number }>;
  roles: Array<{ id: string; name: string; color: number; position: number }>;
};

type SettingsFormState = SnapshotPayload['settings'];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Not yet';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function buildTonePreview(formState: SettingsFormState | null): string {
  if (!formState) {
    return 'Preview unavailable until a guild is selected.';
  }

  const baseByTone: Record<TonePreset, string> = {
    professional: 'Here is the grounded answer based on the approved material.',
    standard: 'Here is what I found in the approved knowledge sources.',
    witty: 'Here is the grounded answer, minus the fluff and with a little edge.',
    cheeky: 'Here is the answer from the approved source list, no guesswork, no drama.',
  };

  const instructions = formState.toneInstructions.trim();
  return instructions
    ? `${baseByTone[formState.tonePreset]} Extra guidance: ${instructions}`
    : baseByTone[formState.tonePreset];
}

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed with status ${response.status}.`;
}

function GuildAvatar({ guild }: { guild: AiDashboardGuild }) {
  if (guild.iconUrl) {
    return <img src={guild.iconUrl} alt="" className="size-11 rounded-md object-cover" />;
  }

  return (
    <span className="inline-flex size-11 items-center justify-center rounded-md bg-primary/[0.1] font-semibold text-primary">
      {guild.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  detail,
}: {
  icon: typeof ShieldCheck;
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <p className="text-[0.66rem] font-semibold uppercase text-muted-foreground">
          {eyebrow}
        </p>
        <div className="space-y-2">
          <h3 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h3>
          <p className="max-w-2xl text-xs leading-6 text-muted-foreground sm:text-sm">
            {detail}
          </p>
        </div>
      </div>

      <span className="inline-flex size-11 items-center justify-center rounded-md bg-primary/[0.08] text-primary">
        <Icon className="size-5" />
      </span>
    </div>
  );
}

function StatusPill({
  status,
  children,
}: {
  status: 'neutral' | 'good' | 'warn' | 'bad';
  children: ReactNode;
}) {
  const toneClass =
    status === 'good'
      ? 'bg-primary text-primary-foreground'
      : status === 'warn'
        ? 'bg-secondary text-secondary-foreground'
        : status === 'bad'
          ? 'bg-muted text-destructive'
          : 'bg-card text-primary';

  return (
    <span className={cx('rounded-md px-3 py-1.5 text-[0.66rem] font-semibold uppercase', toneClass)}>
      {children}
    </span>
  );
}

export function AiControlPlane({
  guilds,
  initialGuildId,
}: {
  guilds: AiDashboardGuild[];
  initialGuildId: string | null;
}) {
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(
    initialGuildId && guilds.some((guild) => guild.id === initialGuildId)
      ? initialGuildId
      : guilds[0]?.id ?? null,
  );
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null);
  const [resources, setResources] = useState<ResourcesPayload | null>(null);
  const [formState, setFormState] = useState<SettingsFormState | null>(null);
  const [qaDrafts, setQaDrafts] = useState<Record<string, { question: string; answer: string }>>({});
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [newQaQuestion, setNewQaQuestion] = useState('');
  const [newQaAnswer, setNewQaAnswer] = useState('');
  const [selectedReplyCategoryId, setSelectedReplyCategoryId] = useState<string | null>(null);
  const [selectedKnowledgeCategoryId, setSelectedKnowledgeCategoryId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, startMutation] = useTransition();

  const loadGuildPanel = useEffectEvent(async (guildId: string) => {
    setIsLoading(true);
    setLoadError('');

    try {
      const [snapshotResponse, resourcesResponse] = await Promise.all([
        fetch(`/api/guilds/${guildId}/snapshot`, { cache: 'no-store' }),
        fetch(`/api/discord/guilds/${guildId}/resources`, { cache: 'no-store' }),
      ]);

      if (!snapshotResponse.ok) {
        throw new Error(await readApiError(snapshotResponse));
      }
      if (!resourcesResponse.ok) {
        throw new Error(await readApiError(resourcesResponse));
      }

      const nextSnapshot = (await snapshotResponse.json()) as SnapshotPayload;
      const nextResources = (await resourcesResponse.json()) as ResourcesPayload;

      setSnapshot(nextSnapshot);
      setResources(nextResources);
      setFormState(nextSnapshot.settings);
      setQaDrafts(
        Object.fromEntries(
          nextSnapshot.customQas.map((customQa) => [
            customQa.customQaId,
            { question: customQa.question, answer: customQa.answer },
          ]),
        ),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Panel data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    if (!selectedGuildId) {
      return;
    }

    const nextUrl = buildDashboardGuildUrl(window.location.href, selectedGuildId);
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }

    void loadGuildPanel(selectedGuildId);
  }, [selectedGuildId]);

  const preview = buildTonePreview(formState);

  function updateReplyChannel(channelId: string, checked: boolean) {
    if (!formState) {
      return;
    }

    const existing = formState.replyChannels.find((channel) => channel.channelId === channelId);
    setFormState({
      ...formState,
      replyChannels: checked
        ? existing
          ? formState.replyChannels
          : [
              ...formState.replyChannels,
              { channelId, replyMode: formState.defaultReplyMode },
            ]
        : formState.replyChannels.filter((channel) => channel.channelId !== channelId),
    });
  }

  function updateReplyChannelMode(channelId: string, replyMode: ReplyMode) {
    if (!formState) {
      return;
    }

    setFormState({
      ...formState,
      replyChannels: formState.replyChannels.map((channel) =>
        channel.channelId === channelId ? { ...channel, replyMode } : channel,
      ),
    });
  }

  function toggleRole(roleId: string) {
    if (!formState) {
      return;
    }

    const hasRole = formState.roleIds.includes(roleId);
    setFormState({
      ...formState,
      roleIds: hasRole
        ? formState.roleIds.filter((currentRoleId) => currentRoleId !== roleId)
        : [...formState.roleIds, roleId],
    });
  }

  function runMutation(action: () => Promise<void>) {
    startMutation(() => {
      void action();
    });
  }

  function saveSettings() {
    if (!selectedGuildId || !formState) {
      return;
    }

    runMutation(async () => {
      setStatusMessage(null);

      const response = await fetch(`/api/guilds/${selectedGuildId}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formState),
      });

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      const payload = (await response.json()) as { settings: SettingsFormState };
      setFormState(payload.settings);
      setStatusMessage({ kind: 'success', text: 'Reply behavior and tone settings saved.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function addWebsiteSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGuildId || !websiteUrl.trim()) {
      return;
    }

    runMutation(async () => {
      setStatusMessage(null);

      const response = await fetch(`/api/guilds/${selectedGuildId}/website-sources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: websiteUrl }),
      });

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setWebsiteUrl('');
      setStatusMessage({ kind: 'success', text: 'Website source saved and synced.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function syncWebsiteSource(sourceId: string) {
    if (!selectedGuildId) {
      return;
    }

    runMutation(async () => {
      const response = await fetch(
        `/api/guilds/${selectedGuildId}/website-sources/${sourceId}/sync`,
        { method: 'POST' },
      );

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setStatusMessage({ kind: 'success', text: 'Website source synced.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function deleteWebsiteSource(sourceId: string) {
    if (!selectedGuildId) {
      return;
    }

    runMutation(async () => {
      const response = await fetch(`/api/guilds/${selectedGuildId}/website-sources/${sourceId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setStatusMessage({ kind: 'success', text: 'Website source removed.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function addDiscordChannelSource(channelId: string) {
    if (!selectedGuildId) {
      return;
    }

    runMutation(async () => {
      setStatusMessage(null);

      const response = await fetch(`/api/guilds/${selectedGuildId}/discord-channel-sources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelId }),
      });

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setStatusMessage({ kind: 'success', text: 'Discord channel backfilled for knowledge.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function syncDiscordChannelSource(sourceId: string) {
    if (!selectedGuildId) {
      return;
    }

    runMutation(async () => {
      const response = await fetch(
        `/api/guilds/${selectedGuildId}/discord-channel-sources/${sourceId}/sync`,
        { method: 'POST' },
      );

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setStatusMessage({ kind: 'success', text: 'Discord channel knowledge refreshed.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function deleteDiscordChannelSource(sourceId: string) {
    if (!selectedGuildId) {
      return;
    }

    runMutation(async () => {
      const response = await fetch(
        `/api/guilds/${selectedGuildId}/discord-channel-sources/${sourceId}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setStatusMessage({ kind: 'success', text: 'Discord channel knowledge removed.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function addDiscordChannelCategorySource(categoryId: string) {
    if (!selectedGuildId || categoryId === 'uncategorized') {
      return;
    }

    runMutation(async () => {
      setStatusMessage(null);

      const response = await fetch(`/api/guilds/${selectedGuildId}/discord-channel-category-sources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ categoryId }),
      });

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setStatusMessage({
        kind: 'success',
        text: 'Knowledge category saved. Current and future channels in it will refresh automatically.',
      });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function deleteDiscordChannelCategorySource(categoryId: string) {
    if (!selectedGuildId || categoryId === 'uncategorized') {
      return;
    }

    runMutation(async () => {
      const response = await fetch(
        `/api/guilds/${selectedGuildId}/discord-channel-category-sources/${categoryId}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setStatusMessage({ kind: 'success', text: 'Knowledge category removed.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function createCustomQa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGuildId || !newQaQuestion.trim() || !newQaAnswer.trim()) {
      return;
    }

    runMutation(async () => {
      const response = await fetch(`/api/guilds/${selectedGuildId}/custom-qas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: newQaQuestion,
          answer: newQaAnswer,
        }),
      });

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setNewQaQuestion('');
      setNewQaAnswer('');
      setStatusMessage({ kind: 'success', text: 'Custom Q&A saved.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function saveCustomQa(customQaId: string) {
    if (!selectedGuildId) {
      return;
    }

    const draft = qaDrafts[customQaId];
    if (!draft) {
      return;
    }

    runMutation(async () => {
      const response = await fetch(`/api/guilds/${selectedGuildId}/custom-qas/${customQaId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(draft),
      });

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setStatusMessage({ kind: 'success', text: 'Custom Q&A updated.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  function removeCustomQa(customQaId: string) {
    if (!selectedGuildId) {
      return;
    }

    runMutation(async () => {
      const response = await fetch(`/api/guilds/${selectedGuildId}/custom-qas/${customQaId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        setStatusMessage({ kind: 'error', text: await readApiError(response) });
        return;
      }

      setStatusMessage({ kind: 'success', text: 'Custom Q&A removed.' });
      await loadGuildPanel(selectedGuildId);
    });
  }

  if (guilds.length === 0) {
    return (
      <section className="ai-panel rounded-md px-5 py-6 text-sm leading-7 text-muted-foreground">
        This account is authenticated, but it does not currently own or administer any Discord servers
        that the panel can manage.
      </section>
    );
  }

  const currentGuild =
    guilds.find((guild) => guild.id === selectedGuildId) ??
    (snapshot ? snapshot.guild : guilds[0]);
  const channelsByCategory = new Map<string, ResourcesPayload['channels']>();
  for (const channel of resources?.channels ?? []) {
    const categoryId = channel.parentId ?? 'uncategorized';
    channelsByCategory.set(categoryId, [...(channelsByCategory.get(categoryId) ?? []), channel]);
  }
  const channelCategoryOptions = [
    ...(resources?.categoryChannels ?? [])
      .filter((category) => (channelsByCategory.get(category.id)?.length ?? 0) > 0)
      .map((category) => ({
        id: category.id,
        label: category.name,
        count: channelsByCategory.get(category.id)?.length ?? 0,
      })),
    ...((channelsByCategory.get('uncategorized')?.length ?? 0) > 0
      ? [
          {
            id: 'uncategorized',
            label: 'Uncategorized',
            count: channelsByCategory.get('uncategorized')?.length ?? 0,
          },
        ]
      : []),
  ];
  const effectiveReplyCategoryId = selectedReplyCategoryId && channelCategoryOptions.some(
    (category) => category.id === selectedReplyCategoryId,
  )
    ? selectedReplyCategoryId
    : channelCategoryOptions[0]?.id ?? 'uncategorized';
  const visibleReplyChannels = channelsByCategory.get(effectiveReplyCategoryId) ?? [];
  const visibleReplyChannelIds = new Set(visibleReplyChannels.map((channel) => channel.id));
  const activeReplyCategoryRule = formState?.replyChannelCategories.find(
    (category) => category.categoryId === effectiveReplyCategoryId,
  );
  const activeVisibleReplyChannelCount =
    formState?.replyChannels.filter((channel) => visibleReplyChannelIds.has(channel.channelId)).length ?? 0;
  const activeReplyCategoryCount = formState?.replyChannelCategories.length ?? 0;
  const effectiveKnowledgeCategoryId = selectedKnowledgeCategoryId && channelCategoryOptions.some(
    (category) => category.id === selectedKnowledgeCategoryId,
  )
    ? selectedKnowledgeCategoryId
    : channelCategoryOptions[0]?.id ?? 'uncategorized';
  const visibleKnowledgeChannels = channelsByCategory.get(effectiveKnowledgeCategoryId) ?? [];
  const activeKnowledgeCategorySource = snapshot?.discordChannelCategorySources.find(
    (source) => source.categoryId === effectiveKnowledgeCategoryId,
  );

  function selectVisibleReplyChannels() {
    if (!formState || visibleReplyChannels.length === 0) {
      return;
    }

    const selectedIds = new Set(formState.replyChannels.map((channel) => channel.channelId));
    const additions = visibleReplyChannels
      .filter((channel) => !selectedIds.has(channel.id))
      .map((channel) => ({ channelId: channel.id, replyMode: formState.defaultReplyMode }));
    if (additions.length === 0) {
      return;
    }

    setFormState({
      ...formState,
      replyChannels: [...formState.replyChannels, ...additions],
    });
  }

  function clearVisibleReplyChannels() {
    if (!formState) {
      return;
    }

    setFormState({
      ...formState,
      replyChannels: formState.replyChannels.filter((channel) => !visibleReplyChannelIds.has(channel.channelId)),
      replyChannelCategories: formState.replyChannelCategories.filter(
        (category) => category.categoryId !== effectiveReplyCategoryId,
      ),
    });
  }

  function autoSelectVisibleReplyCategory() {
    if (!formState || effectiveReplyCategoryId === 'uncategorized') {
      return;
    }

    const existing = formState.replyChannelCategories.find(
      (category) => category.categoryId === effectiveReplyCategoryId,
    );
    if (existing) {
      return;
    }

    setFormState({
      ...formState,
      replyChannelCategories: [
        ...formState.replyChannelCategories,
        { categoryId: effectiveReplyCategoryId, replyMode: formState.defaultReplyMode },
      ],
    });
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="ai-panel rounded-md px-4 py-5 sm:px-5">
        <div className="space-y-4">
          <div>
            <p className="text-[0.66rem] font-semibold uppercase text-muted-foreground">
              Guild focus
            </p>
            <h3 className="mt-2 text-xl font-bold tracking-tight text-foreground">
              Live workspace
            </h3>
          </div>

          <div className="space-y-2">
            {guilds.map((guild) => (
              <button
                key={guild.id}
                type="button"
                onClick={() => {
                  setSelectedGuildId(guild.id);
                  setStatusMessage(null);
                }}
                className={cx(
                  'flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-primary',
                  guild.id === currentGuild?.id
                    ? 'bg-primary text-primary-foreground shadow-[0_18px_40px_rgb(0_0_0_/_0.18)]'
                    : 'bg-card text-foreground hover:bg-primary/[0.08]',
                )}
              >
                <GuildAvatar guild={guild} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{guild.name}</p>
                  <p
                    className={cx(
                      'mt-1 text-[0.66rem] uppercase',
                      guild.id === currentGuild?.id
                        ? 'text-primary-foreground/75'
                        : 'text-muted-foreground',
                    )}
                  >
                    {guild.owner ? 'Owner' : 'Administrator'}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="ai-soft-surface rounded-md px-4 py-4 text-xs leading-6 text-muted-foreground">
            {AI_APP_BRAND.name} only exposes servers that this Discord account can actually manage.
          </div>
        </div>
      </aside>

      <div className="grid gap-4">
        {statusMessage ? (
          <section
            className={cx(
              'rounded-md px-4 py-3 text-sm',
              statusMessage.kind === 'success'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-destructive',
            )}
          >
            {statusMessage.text}
          </section>
        ) : null}

        {loadError ? (
          <section className="rounded-md bg-muted px-4 py-3 text-sm text-destructive">
            {loadError}
          </section>
        ) : null}

        <section id="overview" className="ai-panel rounded-md px-5 py-5 sm:px-6 sm:py-6">
          <SectionHeading
            icon={Cpu}
            eyebrow="Overview"
            title={currentGuild ? `${currentGuild.name} control plane` : 'Control plane'}
            detail="Activation state, bot presence, and grounding health stay above the fold so operators can see whether the AI bot is actually ready before touching settings."
          />

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: 'Activation',
                value: snapshot?.activation.activated ? 'Live' : 'Locked',
                accent: snapshot?.activation.activated ? 'good' : 'warn',
              },
              {
                label: 'Bot connection',
                value: resources?.botInGuild ? 'In guild' : 'Invite needed',
                accent: resources?.botInGuild ? 'good' : 'warn',
              },
              {
                label: 'Knowledge assets',
                value: String(snapshot?.diagnostics.totals.sourceCount ?? 0),
                accent: 'neutral',
              },
              {
                label: 'Custom Q&A',
                value: String(snapshot?.diagnostics.totals.customQaCount ?? 0),
                accent: 'neutral',
              },
            ].map((metric) => (
              <article key={metric.label} className="ai-soft-surface rounded-md px-4 py-4">
                <p className="text-[0.66rem] uppercase text-muted-foreground">
                  {metric.label}
                </p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xl font-bold tracking-tight text-foreground">
                    {metric.value}
                  </p>
                  <StatusPill status={metric.accent as 'neutral' | 'good' | 'warn' | 'bad'}>
                    {metric.label === 'Activation' || metric.label === 'Bot connection'
                      ? metric.value
                      : 'Tracked'}
                  </StatusPill>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="rounded-md border border-border/80 bg-card px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={snapshot?.activation.activated ? 'good' : 'warn'}>
                  {snapshot?.activation.activated ? 'Activation granted' : 'Activation pending'}
                </StatusPill>
                <StatusPill status={resources?.botInGuild ? 'good' : 'warn'}>
                  {resources?.botInGuild ? 'Bot connected' : 'Bot missing'}
                </StatusPill>
                <StatusPill
                  status={
                    (snapshot?.diagnostics.totals.failedSourceCount ?? 0) > 0
                      ? 'bad'
                      : (snapshot?.diagnostics.totals.pendingSourceCount ?? 0) > 0
                        ? 'warn'
                        : 'good'
                  }
                >
                  {snapshot?.diagnostics.totals.failedSourceCount
                    ? 'Sync attention needed'
                    : 'Sync health stable'}
                </StatusPill>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <article className="rounded-md bg-muted px-3 py-3">
                  <p className="text-[0.66rem] uppercase text-muted-foreground">
                    Last sync
                  </p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {formatDateTime(snapshot?.diagnostics.lastSyncedAt ?? null)}
                  </p>
                </article>
                <article className="rounded-md bg-muted px-3 py-3">
                  <p className="text-[0.66rem] uppercase text-muted-foreground">
                    Reply lanes
                  </p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {snapshot?.settings.replyChannels.length ?? 0} configured
                  </p>
                </article>
                <article className="rounded-md bg-muted px-3 py-3">
                  <p className="text-[0.66rem] uppercase text-muted-foreground">
                    Role guardrail
                  </p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {snapshot?.settings.roleMode === 'blocklist' ? 'Blocklisted roles' : 'Allowlisted roles'}
                  </p>
                </article>
              </div>
            </div>

            <div className="ai-gradient-signal rounded-md px-4 py-4 text-primary-foreground">
              <div className="space-y-3">
                <p className="text-[0.66rem] uppercase text-primary-foreground/70">
                  Invite posture
                </p>
                <h4 className="text-lg font-bold tracking-tight">
                  {resources?.botInGuild ? 'Runtime attached' : 'Bring the AI bot into the server'}
                </h4>
                <p className="text-xs leading-6 text-primary-foreground/78">
                  {resources?.botInGuild
                    ? 'Channels and roles are being read directly from Discord so the panel can stay aligned with live server state.'
                    : 'The panel can still be configured now, but the runtime cannot answer until the AI bot is invited to the guild.'}
                </p>
                {!resources?.botInGuild && resources?.inviteUrl ? (
                  <a
                    href={resources.inviteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-card px-4 text-xs font-semibold uppercase text-primary transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-white"
                  >
                    Invite bot
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section id="reply-behavior" className="ai-panel rounded-md px-5 py-5 sm:px-6 sm:py-6">
          <SectionHeading
            icon={MessagesSquare}
            eyebrow="Reply behavior"
            title="Channel and role guardrails"
            detail="Every public answer should be deliberate. Choose exactly which channels are active, whether replies stay inline or move into threads, and which roles are eligible."
          />

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="rounded-md border border-border/80 bg-card px-4 py-4">
                  <span className="text-[0.66rem] uppercase text-muted-foreground">
                    Bot enabled
                  </span>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">
                      {formState?.enabled ? 'Replies allowed' : 'Replies paused'}
                    </span>
                    <input
                      type="checkbox"
                      checked={formState?.enabled ?? false}
                      onChange={(event) =>
                        formState && setFormState({ ...formState, enabled: event.target.checked })
                      }
                      className="size-5 accent-primary"
                    />
                  </div>
                </label>

                <label className="rounded-md border border-border/80 bg-card px-4 py-4">
                  <span className="text-[0.66rem] uppercase text-muted-foreground">
                    Default reply mode
                  </span>
                  <select
                    value={formState?.defaultReplyMode ?? 'inline'}
                    onChange={(event) =>
                      formState &&
                      setFormState({
                        ...formState,
                        defaultReplyMode: event.target.value as ReplyMode,
                      })
                    }
                    className="mt-3 h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  >
                    <option value="inline">Inline reply</option>
                    <option value="thread">Thread reply</option>
                  </select>
                </label>

                <label className="rounded-md border border-border/80 bg-card px-4 py-4">
                  <span className="text-[0.66rem] uppercase text-muted-foreground">
                    Reply frequency
                  </span>
                  <select
                    value={formState?.replyFrequency ?? 'mid'}
                    onChange={(event) =>
                      formState &&
                      setFormState({
                        ...formState,
                        replyFrequency: event.target.value as ReplyFrequency,
                      })
                    }
                    className="mt-3 h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  >
                    <option value="low">Low</option>
                    <option value="mid">Mid</option>
                    <option value="max">Max</option>
                  </select>
                </label>

                <label className="rounded-md border border-border/80 bg-card px-4 py-4">
                  <span className="text-[0.66rem] uppercase text-muted-foreground">
                    Role filter mode
                  </span>
                  <select
                    value={formState?.roleMode ?? 'allowlist'}
                    onChange={(event) =>
                      formState &&
                      setFormState({ ...formState, roleMode: event.target.value as RoleMode })
                    }
                    className="mt-3 h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  >
                    <option value="allowlist">Allowlisted roles only</option>
                    <option value="blocklist">Everyone except blocked roles</option>
                  </select>
                </label>

                <label className="rounded-md border border-border/80 bg-card px-4 py-4">
                  <span className="text-[0.66rem] uppercase text-muted-foreground">
                    Unanswered logging
                  </span>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">
                      {formState?.unansweredLoggingEnabled ? 'Log unanswered' : 'Do not log'}
                    </span>
                    <input
                      type="checkbox"
                      checked={formState?.unansweredLoggingEnabled ?? false}
                      onChange={(event) =>
                        formState &&
                        setFormState({
                          ...formState,
                          unansweredLoggingEnabled: event.target.checked,
                        })
                      }
                      className="size-5 accent-primary"
                    />
                  </div>
                </label>

                <label className="rounded-md border border-border/80 bg-card px-4 py-4 sm:col-span-2 xl:col-span-2">
                  <span className="text-[0.66rem] uppercase text-muted-foreground">
                    Unanswered log channel
                  </span>
                  <select
                    value={formState?.unansweredLogChannelId ?? ''}
                    onChange={(event) =>
                      formState &&
                      setFormState({
                        ...formState,
                        unansweredLogChannelId: event.target.value || null,
                      })
                    }
                    disabled={!formState?.unansweredLoggingEnabled}
                    className="mt-3 h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition disabled:cursor-not-allowed disabled:opacity-50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                  >
                    <option value="">No log channel</option>
                    {channelCategoryOptions.map((category) => (
                      <optgroup key={category.id} label={category.label}>
                        {(channelsByCategory.get(category.id) ?? []).map((channel) => (
                          <option key={channel.id} value={channel.id}>
                            #{channel.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-md border border-border/80 bg-card px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.66rem] uppercase text-muted-foreground">
                      Reply channels
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Select the channels where the bot should actively reply to all qualifying messages.
                    </p>
                  </div>
                  <StatusPill status="neutral">
                    {formState?.replyChannels.length ?? 0} channels / {activeReplyCategoryCount} categories
                  </StatusPill>
                </div>

                {channelCategoryOptions.length > 0 ? (
                  <div className="mt-4 grid gap-3">
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">
                      Category
                      <select
                        value={effectiveReplyCategoryId}
                        onChange={(event) => setSelectedReplyCategoryId(event.target.value)}
                        className="mt-2 h-11 w-full rounded-md border border-input bg-card px-3 text-sm normal-case text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                      >
                        {channelCategoryOptions.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.label} ({category.count})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={selectVisibleReplyChannels}
                        disabled={!formState || visibleReplyChannels.length === 0}
                        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-primary px-4 text-xs font-semibold uppercase text-primary-foreground transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Select category
                      </button>
                      <button
                        type="button"
                        onClick={autoSelectVisibleReplyCategory}
                        disabled={
                          !formState ||
                          effectiveReplyCategoryId === 'uncategorized' ||
                          Boolean(activeReplyCategoryRule)
                        }
                        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-card px-4 text-xs font-semibold uppercase text-foreground transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Auto-select category
                      </button>
                      <button
                        type="button"
                        onClick={clearVisibleReplyChannels}
                        disabled={!formState || (activeVisibleReplyChannelCount === 0 && !activeReplyCategoryRule)}
                        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-muted px-4 text-xs font-semibold uppercase text-foreground transition hover:bg-card focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Clear category
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {visibleReplyChannels.map((channel) => {
                    const selectedChannel = formState?.replyChannels.find(
                      (replyChannel) => replyChannel.channelId === channel.id,
                    );
                    const activeReplyMode =
                      selectedChannel?.replyMode ??
                      activeReplyCategoryRule?.replyMode ??
                      formState?.defaultReplyMode ??
                      'inline';
                    const isCategoryActive = Boolean(activeReplyCategoryRule && !selectedChannel);

                    return (
                      <article key={channel.id} className="rounded-md bg-muted px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">#{channel.name}</p>
                            <p className="mt-1 text-[0.66rem] uppercase text-muted-foreground">
                              {selectedChannel ? 'Active' : isCategoryActive ? 'Auto active' : 'Ignored'}
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedChannel || activeReplyCategoryRule)}
                            onChange={(event) => updateReplyChannel(channel.id, event.target.checked)}
                            disabled={isCategoryActive}
                            className="size-5 accent-primary"
                          />
                        </div>

                        <select
                          value={activeReplyMode}
                          onChange={(event) =>
                            updateReplyChannelMode(channel.id, event.target.value as ReplyMode)
                          }
                          disabled={!selectedChannel}
                          className="mt-3 h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition disabled:cursor-not-allowed disabled:opacity-50 focus:border-primary focus:ring-4 focus:ring-primary/10"
                        >
                          <option value="inline">Inline reply</option>
                          <option value="thread">Thread reply</option>
                        </select>
                      </article>
                    );
                  })}
                  {resources?.botInGuild && visibleReplyChannels.length === 0 ? (
                    <article className="ai-soft-surface rounded-md px-4 py-4 text-sm leading-7 text-muted-foreground lg:col-span-2">
                      No text or announcement channels are available in this category.
                    </article>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-md border border-border/80 bg-card px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.66rem] uppercase text-muted-foreground">
                      Role rules
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {formState?.roleMode === 'blocklist'
                        ? 'Blocked roles are ignored even in active channels.'
                        : 'Only members with these roles can trigger replies.'}
                    </p>
                  </div>
                  <StatusPill status="neutral">
                    {formState?.roleIds.length ?? 0} tracked
                  </StatusPill>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {(resources?.roles ?? []).map((role) => {
                    const selected = formState?.roleIds.includes(role.id) ?? false;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => toggleRole(role.id)}
                        className={cx(
                          'cursor-pointer rounded-md px-3 py-2 text-xs font-semibold uppercase  transition focus-visible:outline-2 focus-visible:outline-primary',
                          selected
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-primary/[0.08] hover:text-primary',
                        )}
                      >
                        {role.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={saveSettings}
                disabled={!formState || isMutating}
                className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isMutating ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save reply behavior
              </button>
            </div>
          </div>
        </section>

        <section id="knowledge" className="ai-panel rounded-md px-5 py-5 sm:px-6 sm:py-6">
          <SectionHeading
            icon={Waypoints}
            eyebrow="Knowledge"
            title="Approved sources and custom answers"
            detail="Websites and Discord knowledge channels are approved explicitly, then refreshed automatically four times per day. Custom Q&A entries remain first-class grounded material."
          />

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="space-y-4">
              <form onSubmit={addWebsiteSource} className="rounded-md border border-border/80 bg-card px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.66rem] uppercase text-muted-foreground">
                      Website source
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Paste one exact URL. The panel ingests it immediately and refreshes it automatically four times per day.
                    </p>
                  </div>
                  <Globe className="mt-1 size-5 text-primary" />
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    value={websiteUrl}
                    onChange={(event) => setWebsiteUrl(event.target.value)}
                    placeholder="https://docs.example.com/faq"
                    className="h-12 flex-1 rounded-md border border-input bg-card px-4 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <button
                    type="submit"
                    disabled={isMutating}
                    className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="size-4" />
                    Add and sync
                  </button>
                </div>
              </form>

              <div className="space-y-3">
                {(snapshot?.websiteSources ?? []).map((source) => (
                  <article key={source.sourceId} className="rounded-md border border-border/80 bg-card px-4 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill
                            status={
                              source.status === 'ready'
                                ? 'good'
                                : source.status === 'failed'
                                  ? 'bad'
                                  : 'warn'
                            }
                          >
                            {source.status}
                          </StatusPill>
                          <span className="text-[0.66rem] uppercase text-muted-foreground">
                            {source.pageTitle || 'Untitled source'}
                          </span>
                        </div>
                        <p className="break-all text-sm font-semibold text-foreground">{source.url}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>HTTP {source.httpStatus ?? 'n/a'}</span>
                          <span>Last sync {formatDateTime(source.lastSyncedAt)}</span>
                          <span>Updated {formatDateTime(source.updatedAt)}</span>
                        </div>
                        {source.lastSyncError ? (
                          <p className="rounded-md bg-muted px-3 py-2 text-xs text-destructive">
                            {source.lastSyncError}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => syncWebsiteSource(source.sourceId)}
                          disabled={isMutating}
                          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-muted px-4 text-xs font-semibold uppercase  text-foreground transition hover:bg-card focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RefreshCcw className="size-4" />
                          Sync
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteWebsiteSource(source.sourceId)}
                          disabled={isMutating}
                          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-muted px-4 text-xs font-semibold uppercase  text-destructive transition hover:brightness-98 focus-visible:outline-2 focus-visible:outline-destructive disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Trash2 className="size-4" />
                          Remove
                        </button>
                      </div>
                    </div>
                  </article>
                ))}

                {!snapshot?.websiteSources.length ? (
                  <article className="ai-soft-surface rounded-md px-4 py-4 text-sm leading-7 text-muted-foreground">
                    No websites have been approved yet. Add the first exact page URL above to start grounding answers.
                  </article>
                ) : null}
              </div>

              <div className="rounded-md border border-border/80 bg-card px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.66rem] uppercase text-muted-foreground">
                      Discord knowledge channels
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Backfills the latest 500 messages from selected read-only or announcement channels. These channels do not become reply channels unless enabled above.
                    </p>
                  </div>
                  <MessagesSquare className="mt-1 size-5 text-primary" />
                </div>

                {channelCategoryOptions.length > 0 ? (
                  <div className="mt-4 grid gap-3">
                    <label className="block text-xs font-semibold uppercase text-muted-foreground">
                      Category
                      <select
                        value={effectiveKnowledgeCategoryId}
                        onChange={(event) => setSelectedKnowledgeCategoryId(event.target.value)}
                        className="mt-2 h-11 w-full rounded-md border border-input bg-card px-3 text-sm normal-case text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                      >
                        {channelCategoryOptions.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.label} ({category.count})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => addDiscordChannelCategorySource(effectiveKnowledgeCategoryId)}
                        disabled={
                          isMutating ||
                          effectiveKnowledgeCategoryId === 'uncategorized' ||
                          Boolean(activeKnowledgeCategorySource)
                        }
                        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-primary px-4 text-xs font-semibold uppercase text-primary-foreground transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Auto-select category
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteDiscordChannelCategorySource(effectiveKnowledgeCategoryId)}
                        disabled={isMutating || !activeKnowledgeCategorySource}
                        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-muted px-4 text-xs font-semibold uppercase text-foreground transition hover:bg-card focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Clear category
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3">
                  {visibleKnowledgeChannels.map((channel) => {
                    const source = snapshot?.discordChannelSources.find(
                      (channelSource) => channelSource.channelId === channel.id,
                    );
                    const isAutoKnowledgeChannel = Boolean(activeKnowledgeCategorySource);

                    return (
                      <article key={channel.id} className="rounded-md bg-muted px-4 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-foreground">#{channel.name}</p>
                            <p className="mt-1 text-[0.66rem] uppercase text-muted-foreground">
                              {source
                                ? `${source.messageCount} synced messages`
                                : isAutoKnowledgeChannel
                                  ? 'Auto-selected'
                                  : 'Not used for knowledge'}
                            </p>
                          </div>

                          {source ? (
                            <div className="flex flex-wrap gap-2">
                              {isAutoKnowledgeChannel ? (
                                <StatusPill status="neutral">auto</StatusPill>
                              ) : null}
                              <StatusPill
                                status={
                                  source.status === 'ready'
                                    ? 'good'
                                    : source.status === 'failed'
                                      ? 'bad'
                                      : 'warn'
                                }
                              >
                                {source.status}
                              </StatusPill>
                              <button
                                type="button"
                                onClick={() => syncDiscordChannelSource(source.sourceId)}
                                disabled={isMutating}
                                className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-card px-3 text-xs font-semibold uppercase text-foreground transition hover:bg-background focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <RefreshCcw className="size-4" />
                                Sync
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteDiscordChannelSource(source.sourceId)}
                                disabled={isMutating || isAutoKnowledgeChannel}
                                className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-card px-3 text-xs font-semibold uppercase text-destructive transition hover:bg-background focus-visible:outline-2 focus-visible:outline-destructive disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 className="size-4" />
                                Remove
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addDiscordChannelSource(channel.id)}
                              disabled={isMutating || isAutoKnowledgeChannel}
                              className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-card px-3 text-xs font-semibold uppercase text-foreground transition hover:bg-background focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Plus className="size-4" />
                              {isAutoKnowledgeChannel ? 'Auto' : 'Add'}
                            </button>
                          )}
                        </div>

                        {source ? (
                          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>Last sync {formatDateTime(source.lastSyncedAt)}</span>
                            <span>Newest message {source.lastMessageId ?? 'n/a'}</span>
                          </div>
                        ) : null}
                        {source?.lastSyncError ? (
                          <p className="mt-3 rounded-md bg-card px-3 py-2 text-xs text-destructive">
                            {source.lastSyncError}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                  {resources?.botInGuild && visibleKnowledgeChannels.length === 0 ? (
                    <article className="ai-soft-surface rounded-md px-4 py-4 text-sm leading-7 text-muted-foreground">
                      No text or announcement channels are available in this category.
                    </article>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <form onSubmit={createCustomQa} className="rounded-md border border-border/80 bg-card px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.66rem] uppercase text-muted-foreground">
                      Custom Q&A
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Add exact answer pairs for policy, pricing, and server-specific questions.
                    </p>
                  </div>
                  <LockKeyhole className="mt-1 size-5 text-primary" />
                </div>

                <div className="mt-4 space-y-3">
                  <textarea
                    value={newQaQuestion}
                    onChange={(event) => setNewQaQuestion(event.target.value)}
                    placeholder="What refund window do you offer?"
                    className="min-h-24 w-full rounded-md border border-input bg-card px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <textarea
                    value={newQaAnswer}
                    onChange={(event) => setNewQaAnswer(event.target.value)}
                    placeholder="Refunds are accepted within 14 days of purchase."
                    className="min-h-28 w-full rounded-md border border-input bg-card px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <button
                    type="submit"
                    disabled={isMutating}
                    className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="size-4" />
                    Save custom Q&A
                  </button>
                </div>
              </form>

              <div className="space-y-3">
                {(snapshot?.customQas ?? []).map((customQa) => (
                  <article key={customQa.customQaId} className="rounded-md border border-border/80 bg-card px-4 py-4">
                    <div className="space-y-3">
                      <textarea
                        value={qaDrafts[customQa.customQaId]?.question ?? customQa.question}
                        onChange={(event) =>
                          setQaDrafts((currentDrafts) => ({
                            ...currentDrafts,
                            [customQa.customQaId]: {
                              question: event.target.value,
                              answer: currentDrafts[customQa.customQaId]?.answer ?? customQa.answer,
                            },
                          }))
                        }
                        className="min-h-20 w-full rounded-md border border-input bg-card px-4 py-3 text-sm font-semibold text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                      />
                      <textarea
                        value={qaDrafts[customQa.customQaId]?.answer ?? customQa.answer}
                        onChange={(event) =>
                          setQaDrafts((currentDrafts) => ({
                            ...currentDrafts,
                            [customQa.customQaId]: {
                              question: currentDrafts[customQa.customQaId]?.question ?? customQa.question,
                              answer: event.target.value,
                            },
                          }))
                        }
                        className="min-h-24 w-full rounded-md border border-input bg-card px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[0.66rem] uppercase text-muted-foreground">
                          Updated {formatDateTime(customQa.updatedAt)}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveCustomQa(customQa.customQaId)}
                            disabled={isMutating}
                            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-muted px-4 text-xs font-semibold uppercase  text-foreground transition hover:bg-card focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Save className="size-4" />
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCustomQa(customQa.customQaId)}
                            disabled={isMutating}
                            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-muted px-4 text-xs font-semibold uppercase  text-destructive transition hover:brightness-98 focus-visible:outline-2 focus-visible:outline-destructive disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="personality" className="ai-panel rounded-md px-5 py-5 sm:px-6 sm:py-6">
          <SectionHeading
            icon={BrainCircuit}
            eyebrow="Personality"
            title="Tone presets and live answer posture"
            detail="Tone is a deliberate layer, not an unrestricted prompt console. Pick the preset, add custom instructions, then preview the resulting response character before saving."
          />

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="rounded-md border border-border/80 bg-card px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[0.66rem] uppercase text-muted-foreground">
                    Tone preset
                  </span>
                  <select
                    value={formState?.tonePreset ?? 'standard'}
                    onChange={(event) =>
                      formState &&
                      setFormState({
                        ...formState,
                        tonePreset: event.target.value as TonePreset,
                      })
                    }
                    className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  >
                    <option value="professional">Professional</option>
                    <option value="standard">Standard</option>
                    <option value="witty">Witty</option>
                    <option value="cheeky">Cheeky</option>
                  </select>
                </label>

                <div className="rounded-md bg-muted px-4 py-4">
                  <p className="text-[0.66rem] uppercase text-muted-foreground">
                    Preview posture
                  </p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {formState?.tonePreset ?? 'standard'}
                  </p>
                </div>
              </div>

              <label className="mt-4 block space-y-2">
                <span className="text-[0.66rem] uppercase text-muted-foreground">
                  Custom instructions
                </span>
                <textarea
                  value={formState?.toneInstructions ?? ''}
                  onChange={(event) =>
                    formState &&
                    setFormState({
                      ...formState,
                      toneInstructions: event.target.value,
                    })
                  }
                  placeholder="Keep answers crisp, avoid slang, and mention when information is limited."
                  className="min-h-32 w-full rounded-md border border-input bg-card px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </label>

              <button
                type="button"
                onClick={saveSettings}
                disabled={!formState || isMutating}
                className="mt-4 inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isMutating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Save tone profile
              </button>
            </div>

            <div className="ai-gradient-signal rounded-md px-4 py-4 text-primary-foreground">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[0.66rem] uppercase text-primary-foreground/75">
                  <BadgeCheck className="size-4" />
                  Grounded preview
                </div>
                <p className="text-lg font-bold tracking-tight">
                  Sample answer posture
                </p>
                <p className="rounded-md border border-border bg-card/10 px-4 py-4 text-sm leading-7 text-primary-foreground/90">
                  {preview}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="diagnostics" className="ai-panel rounded-md px-5 py-5 sm:px-6 sm:py-6">
          <SectionHeading
            icon={ShieldCheck}
            eyebrow="Diagnostics"
            title="Grounding confidence and operator visibility"
            detail="When a sync fails or the bot cannot answer cleanly, the panel should make that obvious. This view keeps failure states, activation posture, and resource counts readable at a glance."
          />

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-3">
              {(snapshot?.diagnostics.sources ?? []).map((source) => (
                <article key={source.sourceId} className="rounded-md border border-border/80 bg-card px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <StatusPill
                          status={
                            source.status === 'ready'
                              ? 'good'
                              : source.status === 'failed'
                                ? 'bad'
                                : 'warn'
                          }
                        >
                          {source.status}
                        </StatusPill>
                        <span className="text-xs text-muted-foreground">
                          {source.documentCount} doc{source.documentCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="break-all text-sm font-semibold text-foreground">{source.url}</p>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>HTTP {source.httpStatus ?? 'n/a'}</span>
                        <span>Synced {formatDateTime(source.lastSyncedAt)}</span>
                        <span>Updated {formatDateTime(source.updatedAt)}</span>
                      </div>
                    </div>
                    {source.lastSyncError ? (
                      <div className="rounded-md bg-muted px-3 py-2 text-xs text-destructive">
                        {source.lastSyncError}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}

              {!snapshot?.diagnostics.sources.length ? (
                <article className="ai-soft-surface rounded-md px-4 py-4 text-sm leading-7 text-muted-foreground">
                  Diagnostics will populate once the first website source is added and synced.
                </article>
              ) : null}
            </div>

            <div className="space-y-4">
              <article className="rounded-md border border-border/80 bg-card px-4 py-4">
                <div className="flex items-center gap-2 text-[0.66rem] uppercase text-muted-foreground">
                  <CircleAlert className="size-4" />
                  Runtime posture
                </div>
                <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                  <p>
                    Activation: <span className="font-semibold text-foreground">{snapshot?.activation.activated ? 'granted' : 'not granted'}</span>
                  </p>
                  <p>
                    Authorized users: <span className="font-semibold text-foreground">{snapshot?.activation.authorizedUserCount ?? 0}</span>
                  </p>
                  <p>
                    Bot membership: <span className="font-semibold text-foreground">{resources?.botInGuild ? 'connected' : 'missing'}</span>
                  </p>
                </div>
              </article>

              <article className="rounded-md border border-border/80 bg-card px-4 py-4">
                <div className="flex items-center gap-2 text-[0.66rem] uppercase text-muted-foreground">
                  <Bot className="size-4" />
                  Resource spread
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-muted px-3 py-3">
                    <p className="text-[0.66rem] uppercase  text-muted-foreground">
                      Channels
                    </p>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {resources?.channels.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted px-3 py-3">
                    <p className="text-[0.66rem] uppercase  text-muted-foreground">
                      Roles
                    </p>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {resources?.roles.length ?? 0}
                    </p>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {isLoading ? (
          <section className="ai-panel rounded-md px-5 py-10 text-sm text-muted-foreground">
            <div className="flex items-center justify-center gap-3">
              <LoaderCircle className="size-5 animate-spin text-primary" />
              Loading live guild state...
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

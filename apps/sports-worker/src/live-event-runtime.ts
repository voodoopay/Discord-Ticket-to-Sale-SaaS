import PQueue from '../../../node_modules/.pnpm/p-queue@8.1.1/node_modules/p-queue/dist/index.js';
import {
  ChannelType,
  type CategoryChannel,
  type Client,
  type Guild,
  type TextChannel,
} from 'discord.js';
import {
  SportsAccessService,
  SportsDataService,
  SportsLiveEventService,
  SportsService,
  logger,
  type SportsChannelBindingSummary,
  type SportsGuildConfigSummary,
  type SportsLiveEvent,
} from '@voodoo/core';

import {
  buildFinishedLiveEventEmbed,
  buildLiveEventEmbed,
  buildLiveEventHeaderMessage,
} from './ui/sports-embeds.js';

const sportsAccessService = new SportsAccessService();
const sportsDataService = new SportsDataService();
const sportsLiveEventService = new SportsLiveEventService();
const sportsService = new SportsService();

const LIVE_EVENT_QUEUE = new PQueue({
  concurrency: 1,
  intervalCap: 4,
  interval: 1_000,
});
const LIVE_EVENT_CLEANUP_WINDOW_MS = 3 * 60 * 60 * 1000;
const DEFAULT_CATEGORY_NAME = 'Sports Listings';

let liveEventSchedulerTimer: NodeJS.Timeout | null = null;
let liveEventSchedulerInFlight = false;

export const LIVE_EVENT_TOPIC_PREFIX = 'voodoo:sports-live-event:';

type LiveEventTopicState = {
  version: 1;
  eventId: string;
  eventName: string;
  sportName: string;
  sportChannelId: string;
  cleanupAfterUtc: string | null;
};

function normalizeChannelName(base: string): string {
  const normalizedBase = base
    .trim()
    .normalize('NFKD')
    .replace(/[^\w\s-]/gu, '')
    .toLowerCase()
    .replace(/[\s_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 90);

  return normalizedBase || 'sport';
}

function reserveUniqueChannelName(input: {
  base: string;
  usedNames: Set<string>;
  currentName?: string | null;
}): string {
  const normalizedBase = normalizeChannelName(input.base);
  const existingName = input.currentName?.trim().toLowerCase() || null;
  const reservedNames = new Set(input.usedNames);

  if (existingName) {
    reservedNames.delete(existingName);
  }

  let candidate = normalizedBase;
  let suffix = 2;
  while (reservedNames.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${normalizedBase.slice(0, Math.max(1, 100 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }

  input.usedNames.add(candidate);
  return candidate;
}

function buildManagedChannelTopic(input: {
  timezone: string;
  publishTime: string;
  broadcastCountry: string;
}): string {
  return `Managed by the sports worker. Daily ${input.broadcastCountry} TV listings refresh automatically at ${input.publishTime} (${input.timezone}).`;
}

function buildLiveEventChannelName(eventName: string): string {
  return normalizeChannelName(`live-${eventName}`);
}

function serializeLiveEventTopic(state: LiveEventTopicState): string {
  return `${LIVE_EVENT_TOPIC_PREFIX}${JSON.stringify(state)}`;
}

function parseLiveEventTopic(topic: string | null | undefined): LiveEventTopicState | null {
  if (!topic?.startsWith(LIVE_EVENT_TOPIC_PREFIX)) {
    return null;
  }

  const rawState = topic.slice(LIVE_EVENT_TOPIC_PREFIX.length);
  try {
    const parsed = JSON.parse(rawState) as Partial<LiveEventTopicState>;
    if (
      parsed.version !== 1 ||
      typeof parsed.eventId !== 'string' ||
      typeof parsed.eventName !== 'string' ||
      typeof parsed.sportName !== 'string' ||
      typeof parsed.sportChannelId !== 'string'
    ) {
      return null;
    }

    return {
      version: 1,
      eventId: parsed.eventId,
      eventName: parsed.eventName,
      sportName: parsed.sportName,
      sportChannelId: parsed.sportChannelId,
      cleanupAfterUtc:
        typeof parsed.cleanupAfterUtc === 'string' || parsed.cleanupAfterUtc === null
          ? parsed.cleanupAfterUtc
          : null,
    };
  } catch {
    return null;
  }
}

function isCategoryChannel(channel: unknown): channel is CategoryChannel {
  return typeof channel === 'object' && channel !== null && 'type' in channel && channel.type === ChannelType.GuildCategory;
}

function isManagedTextChannel(channel: unknown): channel is TextChannel {
  return typeof channel === 'object' && channel !== null && 'type' in channel && channel.type === ChannelType.GuildText;
}

async function clearManagedChannel(channel: TextChannel): Promise<void> {
  while (true) {
    const messages = await channel.messages.fetch({ limit: 100 });
    if (messages.size === 0) {
      return;
    }

    const bulkDeletable = messages.filter((message) => Date.now() - message.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
    if (bulkDeletable.size > 0) {
      await channel.bulkDelete(bulkDeletable, true);
    }

    const oldMessages = messages.filter((message) => !bulkDeletable.has(message.id));
    for (const message of oldMessages.values()) {
      await message.delete().catch(() => null);
    }

    if (messages.size < 100) {
      return;
    }
  }
}

async function getManagedGuildContext(guildId: string): Promise<{
  config: SportsGuildConfigSummary | null;
  bindings: SportsChannelBindingSummary[];
}> {
  const [configResult, bindingsResult] = await Promise.all([
    sportsService.getGuildConfig({ guildId }),
    sportsService.listChannelBindings({ guildId }),
  ]);

  if (configResult.isErr()) {
    throw configResult.error;
  }
  if (bindingsResult.isErr()) {
    throw bindingsResult.error;
  }

  return {
    config: configResult.value,
    bindings: bindingsResult.value,
  };
}

async function fetchManagedCategory(
  guild: Guild,
  config: SportsGuildConfigSummary | null,
): Promise<CategoryChannel | null> {
  if (!config?.managedCategoryChannelId) {
    return null;
  }

  const category = await guild.channels.fetch(config.managedCategoryChannelId).catch(() => null);
  return isCategoryChannel(category) ? category : null;
}

async function ensureSportChannelForLiveEvent(input: {
  guild: Guild;
  config: SportsGuildConfigSummary;
  category: CategoryChannel;
  bindingsBySport: Map<string, SportsChannelBindingSummary>;
  usedNames: Set<string>;
  sportName: string;
}): Promise<TextChannel | null> {
  const existingBinding = input.bindingsBySport.get(input.sportName) ?? null;
  if (existingBinding) {
    const existingChannel = await input.guild.channels.fetch(existingBinding.channelId).catch(() => null);
    if (isManagedTextChannel(existingChannel)) {
      return existingChannel;
    }
  }

  const channelName = reserveUniqueChannelName({
    base: input.sportName,
    usedNames: input.usedNames,
  });
  const createdChannel = (await LIVE_EVENT_QUEUE.add(async () =>
    input.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: input.category.id,
      topic: buildManagedChannelTopic({
        timezone: input.config.timezone,
        publishTime: input.config.localTimeHhMm,
        broadcastCountry: input.config.broadcastCountry,
      }),
      reason: `Create the managed ${input.sportName} sport channel for live event publishing.`,
    }),
  )) as TextChannel;

  const bindingResult = await sportsService.upsertChannelBinding({
    guildId: input.guild.id,
    sportId: null,
    sportName: input.sportName,
    sportSlug: createdChannel.name,
    channelId: createdChannel.id,
  });
  if (bindingResult.isErr()) {
    throw bindingResult.error;
  }

  input.bindingsBySport.set(input.sportName, bindingResult.value);
  return createdChannel;
}

async function renderActiveLiveEventChannel(input: {
  channel: TextChannel;
  event: SportsLiveEvent;
}): Promise<void> {
  await LIVE_EVENT_QUEUE.add(async () => {
    await clearManagedChannel(input.channel);
    await input.channel.send({
      content: buildLiveEventHeaderMessage(input.event),
    });
    await input.channel.send({
      embeds: [buildLiveEventEmbed(input.event)],
    });
  });
}

async function renderFinishedLiveEventChannel(input: {
  channel: TextChannel;
  eventName: string;
  sportName: string;
  deleteAfterUtc: string;
}): Promise<void> {
  await LIVE_EVENT_QUEUE.add(async () => {
    await clearManagedChannel(input.channel);
    await input.channel.send({
      content: `**${input.eventName}**\nThis televised ${input.sportName} event has finished. This temporary channel will be deleted after the cleanup window ends.`,
    });
    await input.channel.send({
      embeds: [
        buildFinishedLiveEventEmbed({
          eventName: input.eventName,
          sportName: input.sportName,
          deleteAfterUtc: input.deleteAfterUtc,
        }),
      ],
    });
  });
}

async function collectManagedLiveEventChannels(guild: Guild): Promise<
  Map<string, { channel: TextChannel; state: LiveEventTopicState }>
> {
  const fetchedChannels = await guild.channels.fetch();
  const liveEventChannels = new Map<string, { channel: TextChannel; state: LiveEventTopicState }>();

  for (const channel of fetchedChannels.values()) {
    if (!isManagedTextChannel(channel)) {
      continue;
    }

    const state = parseLiveEventTopic(channel.topic);
    if (!state) {
      continue;
    }

    liveEventChannels.set(state.eventId, { channel, state });
  }

  return liveEventChannels;
}

export async function reconcileLiveEventsForGuild(input: {
  guild: Guild;
  timezone: string;
  broadcastCountry: string;
  now?: Date;
}): Promise<{
  createdChannelCount: number;
  updatedChannelCount: number;
  markedFinishedCount: number;
}> {
  const now = input.now ?? new Date();
  const { config, bindings } = await getManagedGuildContext(input.guild.id);
  if (!config) {
    return {
      createdChannelCount: 0,
      updatedChannelCount: 0,
      markedFinishedCount: 0,
    };
  }

  const category = await fetchManagedCategory(input.guild, config);
  if (!category) {
    return {
      createdChannelCount: 0,
      updatedChannelCount: 0,
      markedFinishedCount: 0,
    };
  }

  const liveEventsResult = await sportsDataService.listLiveEvents({
    timezone: input.timezone,
    broadcastCountry: input.broadcastCountry,
  });
  if (liveEventsResult.isErr()) {
    throw liveEventsResult.error;
  }

  const televisedLiveEvents = liveEventsResult.value.filter(
    (event) => event.broadcasters.length > 0 && typeof event.sportName === 'string' && event.sportName.trim().length > 0,
  );
  const existingChannelsByEventId = await collectManagedLiveEventChannels(input.guild);
  const bindingsBySport = new Map(bindings.map((binding) => [binding.sportName, binding]));
  const usedNames = new Set(
    [...(await input.guild.channels.fetch()).values()]
      .filter((channel): channel is NonNullable<typeof channel> => channel !== null)
      .map((channel) => channel.name),
  );

  let createdChannelCount = 0;
  let updatedChannelCount = 0;
  let markedFinishedCount = 0;

  for (const event of televisedLiveEvents) {
    const sportName = event.sportName ?? DEFAULT_CATEGORY_NAME;
    const sportChannel = await ensureSportChannelForLiveEvent({
      guild: input.guild,
      config,
      category,
      bindingsBySport,
      usedNames,
      sportName,
    });
    if (!sportChannel) {
      continue;
    }

    const trackedEvent = await sportsLiveEventService.upsertTrackedEvent({
      guildId: input.guild.id,
      sportName,
      eventId: event.eventId,
      eventName: event.eventName,
      sportChannelId: sportChannel.id,
      kickoffAtUtc: now,
    });
    if (trackedEvent.isErr()) {
      throw trackedEvent.error;
    }

    const parentId = sportChannel.parentId ?? category.id;
    const topic = serializeLiveEventTopic({
      version: 1,
      eventId: event.eventId,
      eventName: event.eventName,
      sportName,
      sportChannelId: sportChannel.id,
      cleanupAfterUtc: null,
    });
    const existingChannel = existingChannelsByEventId.get(event.eventId)?.channel ?? null;

    let targetChannel: TextChannel;
    if (existingChannel) {
      const desiredName = reserveUniqueChannelName({
        base: buildLiveEventChannelName(event.eventName),
        usedNames,
        currentName: existingChannel.name,
      });
      await LIVE_EVENT_QUEUE.add(async () =>
        existingChannel.edit({
          name: desiredName,
          parent: parentId,
          topic,
        }),
      );
      updatedChannelCount += 1;
      targetChannel = existingChannel;
    } else {
      const desiredName = reserveUniqueChannelName({
        base: buildLiveEventChannelName(event.eventName),
        usedNames,
      });
      targetChannel = (await LIVE_EVENT_QUEUE.add(async () =>
        input.guild.channels.create({
          name: desiredName,
          type: ChannelType.GuildText,
          parent: parentId,
          topic,
          reason: `Create a temporary live event channel for ${event.eventName}.`,
        }),
      )) as TextChannel;
      createdChannelCount += 1;
    }

    await renderActiveLiveEventChannel({
      channel: targetChannel,
      event,
    });
  }

  const liveEventIds = new Set(televisedLiveEvents.map((event) => event.eventId));
  for (const [eventId, entry] of existingChannelsByEventId.entries()) {
    if (liveEventIds.has(eventId) || entry.state.cleanupAfterUtc) {
      continue;
    }

    const finishedResult = await sportsLiveEventService.markFinished({
      guildId: input.guild.id,
      eventId,
      finishedAtUtc: now,
    });
    if (finishedResult.isErr()) {
      logger.warn(
        { guildId: input.guild.id, eventId, err: finishedResult.error },
        'live event runtime could not mark the tracked event as finished',
      );
      continue;
    }

    const deleteAfterUtc =
      finishedResult.value.deleteAfterUtc?.toISOString() ??
      new Date(now.getTime() + LIVE_EVENT_CLEANUP_WINDOW_MS).toISOString();

    await LIVE_EVENT_QUEUE.add(() =>
      entry.channel.edit({
        topic: serializeLiveEventTopic({
          ...entry.state,
          cleanupAfterUtc: deleteAfterUtc,
        }),
      }),
    );
    await renderFinishedLiveEventChannel({
      channel: entry.channel,
      eventName: entry.state.eventName,
      sportName: entry.state.sportName,
      deleteAfterUtc,
    });
    markedFinishedCount += 1;
  }

  return {
    createdChannelCount,
    updatedChannelCount,
    markedFinishedCount,
  };
}

export async function runPendingLiveEventCleanup(input: {
  guild: Guild;
  now?: Date;
}): Promise<{ deletedChannelCount: number }> {
  const now = input.now ?? new Date();
  const managedChannels = await collectManagedLiveEventChannels(input.guild);
  let deletedChannelCount = 0;

  for (const { channel, state } of managedChannels.values()) {
    if (!state.cleanupAfterUtc) {
      continue;
    }

    const cleanupAt = new Date(state.cleanupAfterUtc);
    if (Number.isNaN(cleanupAt.getTime()) || cleanupAt > now) {
      continue;
    }

    await LIVE_EVENT_QUEUE.add(() =>
      channel.delete(`Delete the finished live event channel for ${state.eventName}.`),
    );
    deletedChannelCount += 1;
  }

  return { deletedChannelCount };
}

async function runLiveEventScheduler(client: Client): Promise<void> {
  const guilds = await client.guilds.fetch();

  for (const guildPreview of guilds.values()) {
    try {
      const activationState = await sportsAccessService.getGuildActivationState({
        guildId: guildPreview.id,
      });
      if (activationState.isErr()) {
        throw activationState.error;
      }
      if (!activationState.value.activated) {
        continue;
      }

      const configResult = await sportsService.getGuildConfig({ guildId: guildPreview.id });
      if (configResult.isErr()) {
        throw configResult.error;
      }
      if (!configResult.value) {
        continue;
      }

      const guild = await client.guilds.fetch(guildPreview.id);
      await reconcileLiveEventsForGuild({
        guild,
        timezone: configResult.value.timezone,
        broadcastCountry: configResult.value.broadcastCountry,
      });
      await runPendingLiveEventCleanup({ guild });
    } catch (error) {
      logger.warn(
        {
          guildId: guildPreview.id,
          errorMessage: error instanceof Error ? error.message : 'unknown',
        },
        'live event scheduler tick failed',
      );
    }
  }
}

function queueLiveEventSchedulerTick(client: Client): void {
  if (liveEventSchedulerInFlight) {
    return;
  }

  liveEventSchedulerInFlight = true;
  void runLiveEventScheduler(client).finally(() => {
    liveEventSchedulerInFlight = false;
  });
}

export function startLiveEventScheduler(client: Client, pollIntervalMs: number): void {
  if (liveEventSchedulerTimer) {
    return;
  }

  const effectivePollIntervalMs = Math.max(5_000, Math.floor(pollIntervalMs));
  queueLiveEventSchedulerTick(client);
  liveEventSchedulerTimer = setInterval(() => {
    queueLiveEventSchedulerTick(client);
  }, effectivePollIntervalMs);
  liveEventSchedulerTimer.unref?.();
}

export function stopLiveEventScheduler(): void {
  if (!liveEventSchedulerTimer) {
    return;
  }

  clearInterval(liveEventSchedulerTimer);
  liveEventSchedulerTimer = null;
  liveEventSchedulerInFlight = false;
}

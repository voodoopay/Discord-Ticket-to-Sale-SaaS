// @ts-ignore -- package.json now declares p-queue, but this worktree has not refreshed node_modules links.
import PQueue from 'p-queue';
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
  SPORTS_LIVE_EVENT_CLEANUP_WINDOW_MINUTES,
  SPORTS_LIVE_EVENT_CLEANUP_WINDOW_MS,
  SportsLiveEventService,
  SportsService,
  logger,
  normalizeBroadcastCountries,
  type SportsChannelBindingSummary,
  type SportsGuildConfigSummary,
  type SportsLiveEvent,
} from '@voodoo/core';

import {
  buildHighlightEmbed,
  buildFinishedLiveEventEmbed,
  buildLiveEventEmbed,
  buildLiveEventHeaderMessage,
  formatBroadcastCountriesLabel,
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
const DEFAULT_CATEGORY_NAME = 'Sports Listings';

let liveEventSchedulerTimer: NodeJS.Timeout | null = null;
let liveEventSchedulerInFlight = false;

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
  broadcastCountries: string[];
  degraded?: boolean;
  failedCountries?: string[];
}): string {
  const countriesLabel = formatBroadcastCountriesLabel(input.broadcastCountries);
  const failedCountriesLabel =
    input.degraded && input.failedCountries && input.failedCountries.length > 0
      ? formatBroadcastCountriesLabel(input.failedCountries)
      : null;

  if (failedCountriesLabel) {
    return `Managed by the sports worker. Daily TV listings currently reflect tracked broadcasters in ${countriesLabel}. Coverage is degraded because data is unavailable for ${failedCountriesLabel}. Refreshes automatically at ${input.publishTime} (${input.timezone}).`;
  }

  return `Managed by the sports worker. Daily TV listings for tracked broadcasters in ${countriesLabel} refresh automatically at ${input.publishTime} (${input.timezone}).`;
}

function buildLiveEventChannelName(eventName: string): string {
  return normalizeChannelName(`live-${eventName}`);
}

function buildLiveEventChannelTopic(eventId: string): string {
  return `Managed by the sports worker for live event ${eventId}.`;
}

function buildLiveEventSnapshots(event: SportsLiveEvent): {
  scoreSnapshot: Record<string, unknown> | null;
  stateSnapshot: Record<string, unknown>;
} {
  return {
    scoreSnapshot: event.scoreLabel ? { scoreLabel: event.scoreLabel } : null,
    stateSnapshot: {
      statusLabel: event.statusLabel,
      broadcasterCount: event.broadcasters.length,
    },
  };
}

function firstNonEmptyString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function mergeLiveEventBroadcasters(event: SportsLiveEvent): SportsLiveEvent['broadcasters'] {
  const broadcasters = new Map<string, SportsLiveEvent['broadcasters'][number]>();

  for (const broadcaster of event.broadcasters) {
    const dedupeKey = [broadcaster.channelId ?? '', broadcaster.country, broadcaster.channelName]
      .join('::')
      .toLowerCase();

    if (!broadcasters.has(dedupeKey)) {
      broadcasters.set(dedupeKey, broadcaster);
    }
  }

  return [...broadcasters.values()];
}

function getLiveEventStatusRank(statusLabel: string | null | undefined): number {
  const normalizedStatus = statusLabel?.trim().toLowerCase() ?? '';

  if (
    normalizedStatus.includes('pen') ||
    normalizedStatus.includes('shootout') ||
    normalizedStatus.includes('extra time')
  ) {
    return 6;
  }
  if (
    normalizedStatus === 'ft' ||
    normalizedStatus.includes('full time') ||
    normalizedStatus.includes('finished')
  ) {
    return 5;
  }
  if (
    normalizedStatus.includes('2nd') ||
    normalizedStatus.includes('second half') ||
    normalizedStatus.includes('h2')
  ) {
    return 4;
  }
  if (normalizedStatus === 'ht' || normalizedStatus.includes('half-time')) {
    return 3;
  }
  if (
    normalizedStatus.includes('1st') ||
    normalizedStatus.includes('first half') ||
    normalizedStatus.includes('h1')
  ) {
    return 2;
  }
  if (normalizedStatus.length > 0) {
    return 1;
  }

  return 0;
}

function parseScoreTotal(scoreLabel: string | null | undefined): number {
  if (!scoreLabel) {
    return -1;
  }

  const scoreParts = scoreLabel.match(/\d+/g);
  if (!scoreParts || scoreParts.length < 2) {
    return -1;
  }

  return scoreParts
    .slice(0, 2)
    .map((scorePart) => Number.parseInt(scorePart, 10))
    .filter((scorePart) => Number.isFinite(scorePart))
    .reduce((total, scorePart) => total + scorePart, 0);
}

function parseUtcTimeValue(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsedValue = Date.parse(value);
  return Number.isNaN(parsedValue) ? Number.NEGATIVE_INFINITY : parsedValue;
}

function countLiveEventDetails(event: SportsLiveEvent): number {
  let detailCount = 0;

  if (typeof event.eventName === 'string' && event.eventName.trim().length > 0) {
    detailCount += 1;
  }
  if (typeof event.sportName === 'string' && event.sportName.trim().length > 0) {
    detailCount += 1;
  }
  if (typeof event.leagueName === 'string' && event.leagueName.trim().length > 0) {
    detailCount += 1;
  }
  if (typeof event.statusLabel === 'string' && event.statusLabel.trim().length > 0) {
    detailCount += 1;
  }
  if (typeof event.scoreLabel === 'string' && event.scoreLabel.trim().length > 0) {
    detailCount += 1;
  }
  if (typeof event.startTimeUtc === 'string' && event.startTimeUtc.trim().length > 0) {
    detailCount += 1;
  }
  if (typeof event.startTimeUkLabel === 'string' && event.startTimeUkLabel.trim().length > 0) {
    detailCount += 1;
  }
  if (typeof event.imageUrl === 'string' && event.imageUrl.trim().length > 0) {
    detailCount += 1;
  }

  detailCount += event.broadcasters.length;

  return detailCount;
}

function compareLiveEventFreshness(left: SportsLiveEvent, right: SportsLiveEvent): number {
  const statusRankDelta = getLiveEventStatusRank(left.statusLabel) - getLiveEventStatusRank(right.statusLabel);
  if (statusRankDelta !== 0) {
    return statusRankDelta;
  }

  const scoreTotalDelta = parseScoreTotal(left.scoreLabel) - parseScoreTotal(right.scoreLabel);
  if (scoreTotalDelta !== 0) {
    return scoreTotalDelta;
  }

  const startTimeDelta = parseUtcTimeValue(left.startTimeUtc) - parseUtcTimeValue(right.startTimeUtc);
  if (startTimeDelta !== 0) {
    return startTimeDelta;
  }

  const detailDelta = countLiveEventDetails(left) - countLiveEventDetails(right);
  if (detailDelta !== 0) {
    return detailDelta;
  }

  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function getPreferredLiveEventPair(
  left: SportsLiveEvent,
  right: SportsLiveEvent,
): [preferred: SportsLiveEvent, secondary: SportsLiveEvent] {
  return compareLiveEventFreshness(left, right) >= 0 ? [left, right] : [right, left];
}

function pickPreferredLiveEventTime(
  left: SportsLiveEvent,
  right: SportsLiveEvent,
): Pick<SportsLiveEvent, 'startTimeUtc' | 'startTimeUkLabel'> {
  const [preferred] = getPreferredLiveEventPair(
    {
      ...left,
      statusLabel: '',
      scoreLabel: null,
      broadcasters: [],
    },
    {
      ...right,
      statusLabel: '',
      scoreLabel: null,
      broadcasters: [],
    },
  );

  return {
    startTimeUtc: preferred.startTimeUtc,
    startTimeUkLabel: preferred.startTimeUkLabel,
  };
}

function mergeDuplicateLiveEvents(events: SportsLiveEvent[]): SportsLiveEvent[] {
  const mergedEvents = new Map<string, SportsLiveEvent>();

  for (const event of events) {
    const existingEvent = mergedEvents.get(event.eventId);
    if (!existingEvent) {
      mergedEvents.set(event.eventId, {
        ...event,
        broadcasters: mergeLiveEventBroadcasters(event),
      });
      continue;
    }

    const [preferredEvent, secondaryEvent] = getPreferredLiveEventPair(existingEvent, event);
    const preferredTimes = pickPreferredLiveEventTime(existingEvent, event);

    mergedEvents.set(event.eventId, {
      ...preferredEvent,
      eventName:
        firstNonEmptyString(preferredEvent.eventName, secondaryEvent.eventName) ??
        preferredEvent.eventName,
      sportName: firstNonEmptyString(preferredEvent.sportName, secondaryEvent.sportName),
      leagueName: firstNonEmptyString(preferredEvent.leagueName, secondaryEvent.leagueName),
      statusLabel:
        firstNonEmptyString(preferredEvent.statusLabel, secondaryEvent.statusLabel) ??
        preferredEvent.statusLabel,
      scoreLabel: firstNonEmptyString(preferredEvent.scoreLabel, secondaryEvent.scoreLabel),
      startTimeUtc: preferredTimes.startTimeUtc,
      startTimeUkLabel: preferredTimes.startTimeUkLabel,
      imageUrl: firstNonEmptyString(preferredEvent.imageUrl, secondaryEvent.imageUrl),
      broadcasters: mergeLiveEventBroadcasters({
        ...preferredEvent,
        broadcasters: [...existingEvent.broadcasters, ...event.broadcasters],
      }),
    });
  }

  return [...mergedEvents.values()];
}

function getMostRecentChannelMessage(
  messages: unknown,
): { id: string; createdTimestamp: number; edit: (input: unknown) => Promise<unknown> } | null {
  if (typeof messages !== 'object' || messages === null || !('values' in messages)) {
    return null;
  }

  const values = messages.values;
  if (typeof values !== 'function') {
    return null;
  }

  let mostRecentMessage: {
    id: string;
    createdTimestamp: number;
    edit: (input: unknown) => Promise<unknown>;
  } | null = null;

  for (const message of values.call(messages) as Iterable<unknown>) {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('id' in message) ||
      !('createdTimestamp' in message) ||
      !('edit' in message)
    ) {
      continue;
    }

    const typedMessage = message as {
      id: string;
      createdTimestamp: number;
      edit: (input: unknown) => Promise<unknown>;
    };

    if (
      mostRecentMessage === null ||
      typedMessage.createdTimestamp > mostRecentMessage.createdTimestamp
    ) {
      mostRecentMessage = typedMessage;
    }
  }

  return mostRecentMessage;
}

function areSnapshotsEqual(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isCategoryChannel(channel: unknown): channel is CategoryChannel {
  return typeof channel === 'object' && channel !== null && 'type' in channel && channel.type === ChannelType.GuildCategory;
}

function isManagedTextChannel(channel: unknown): channel is TextChannel {
  return typeof channel === 'object' && channel !== null && 'type' in channel && channel.type === ChannelType.GuildText;
}

function isUnknownChannelError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  if ('code' in error && error.code === 10_003) {
    return true;
  }

  return 'status' in error && error.status === 404;
}

function findAdoptableLiveEventChannel(input: {
  channels: Iterable<unknown>;
  trackedEventChannelIds: Set<string>;
  desiredName: string;
  eventId: string;
  parentIds: Set<string>;
}): TextChannel | null {
  const desiredTopic = buildLiveEventChannelTopic(input.eventId);

  for (const channel of input.channels) {
    if (
      isManagedTextChannel(channel) &&
      channel.name === input.desiredName &&
      channel.topic === desiredTopic &&
      typeof channel.parentId === 'string' &&
      input.parentIds.has(channel.parentId) &&
      !input.trackedEventChannelIds.has(channel.id)
    ) {
      return channel;
    }
  }

  return null;
}

function isUnknownMessageError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  if ('code' in error && error.code === 10_008) {
    return true;
  }

  return 'status' in error && error.status === 404;
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
  categoryChannelId: string | null | undefined,
): Promise<CategoryChannel | null> {
  if (!categoryChannelId) {
    return null;
  }

  const category = await guild.channels.fetch(categoryChannelId).catch(() => null);
  return isCategoryChannel(category) ? category : null;
}

async function ensureSportChannelForLiveEvent(input: {
  guild: Guild;
  config: SportsGuildConfigSummary;
  listingsCategory: CategoryChannel;
  bindingsBySport: Map<string, SportsChannelBindingSummary>;
  usedNames: Set<string>;
  sportName: string;
  topicBroadcastCountries?: string[];
  topicDegraded?: boolean;
  topicFailedCountries?: string[];
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
      parent: input.listingsCategory.id,
      topic: buildManagedChannelTopic({
        timezone: input.config.timezone,
        publishTime: input.config.localTimeHhMm,
        broadcastCountries:
          input.topicBroadcastCountries ??
          normalizeBroadcastCountries(input.config.broadcastCountries),
        degraded: input.topicDegraded,
        failedCountries: input.topicFailedCountries,
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
  scoreMessageId: string | null;
  shouldSendHeader: boolean;
  allowNoopEdit?: boolean;
}): Promise<{ scoreMessageId: string }> {
  const renderResult = await LIVE_EVENT_QUEUE.add(async (): Promise<{ scoreMessageId: string }> => {
    if (input.scoreMessageId) {
      try {
        const existingMessage = await input.channel.messages.fetch(input.scoreMessageId);
        if (input.allowNoopEdit !== true) {
          await existingMessage.edit({
            embeds: [buildLiveEventEmbed(input.event)],
          });
        }

        return {
          scoreMessageId: existingMessage.id,
        };
      } catch (error) {
        if (!isUnknownMessageError(error)) {
          throw error;
        }
      }
    }

    if (!input.scoreMessageId && !input.shouldSendHeader) {
      const recentMessages = await input.channel.messages.fetch({ limit: 10 });
      const recoveredMessage = getMostRecentChannelMessage(recentMessages);

      if (recoveredMessage) {
        if (input.allowNoopEdit !== true) {
          await recoveredMessage.edit({
            embeds: [buildLiveEventEmbed(input.event)],
          });
        }

        return {
          scoreMessageId: recoveredMessage.id,
        };
      }
    }

    if (input.shouldSendHeader) {
      await input.channel.send({
        content: buildLiveEventHeaderMessage(input.event),
      });
    }

    const scoreMessage = await input.channel.send({
      embeds: [buildLiveEventEmbed(input.event)],
    });

    return {
      scoreMessageId: scoreMessage.id,
    };
  });

  if (!renderResult) {
    throw new Error('Failed to render the managed live event score message.');
  }

  return renderResult;
}

async function renderFinishedLiveEventChannel(input: {
  channel: TextChannel;
  eventName: string;
  sportName: string;
  deleteAfterUtc: string;
}): Promise<void> {
  await LIVE_EVENT_QUEUE.add(async () => {
    await input.channel.send({
      content: `**${input.eventName}**\nThis televised ${input.sportName} event has finished. This temporary channel will be deleted ${SPORTS_LIVE_EVENT_CLEANUP_WINDOW_MINUTES} minutes after full time.`,
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

async function postLiveEventHighlightsIfAvailable(input: {
  guildId: string;
  trackedEvent: {
    eventId: string;
    eventName: string;
    sportName: string;
    highlightsPosted: boolean;
  };
  channel: TextChannel;
  now: Date;
}): Promise<boolean> {
  if (input.trackedEvent.highlightsPosted) {
    return false;
  }

  const highlightResult = await sportsDataService.getEventHighlights({
    eventId: input.trackedEvent.eventId,
  });
  if (highlightResult.isErr()) {
    logger.warn(
      {
        guildId: input.guildId,
        eventId: input.trackedEvent.eventId,
        err: highlightResult.error,
      },
      'live event runtime could not load event highlights',
    );
    return false;
  }
  const highlight = highlightResult.value;
  if (!highlight) {
    return false;
  }

  const markHighlightsPostedResult = await sportsLiveEventService.markHighlightsPosted({
    guildId: input.guildId,
    eventId: input.trackedEvent.eventId,
    postedAtUtc: input.now,
  });
  if (markHighlightsPostedResult.isErr()) {
    logger.warn(
      {
        guildId: input.guildId,
        eventId: input.trackedEvent.eventId,
        err: markHighlightsPostedResult.error,
      },
      'live event runtime could not persist highlight delivery',
    );
    return false;
  }
  if (!markHighlightsPostedResult.value.claimed) {
    return false;
  }

  try {
    await LIVE_EVENT_QUEUE.add(async () => {
      await input.channel.send({
        content: `Highlights are now available for **${input.trackedEvent.eventName}**.`,
        embeds: [
          buildHighlightEmbed({
            eventName: input.trackedEvent.eventName,
            sportName: input.trackedEvent.sportName,
            highlight,
          }),
        ],
      });
    });
  } catch (error) {
    const releaseHighlightClaimResult = await sportsLiveEventService.releaseHighlightClaim({
      guildId: input.guildId,
      eventId: input.trackedEvent.eventId,
      releasedAtUtc: input.now,
    });
    if (releaseHighlightClaimResult.isErr()) {
      logger.warn(
        {
          guildId: input.guildId,
          eventId: input.trackedEvent.eventId,
          err: releaseHighlightClaimResult.error,
        },
        'live event runtime could not release the reserved highlight claim after send failure',
      );
    }

    logger.warn(
      {
        guildId: input.guildId,
        eventId: input.trackedEvent.eventId,
        errorMessage: error instanceof Error ? error.message : 'unknown',
      },
      'live event runtime could not send reserved event highlights',
    );
    return false;
  }

  return true;
}

async function fetchTrackedEventChannel(
  guild: Guild,
  eventChannelId: string | null,
): Promise<TextChannel | null> {
  const channelLookup = await fetchTrackedEventChannelState(guild, eventChannelId);
  return channelLookup.status === 'found' ? channelLookup.channel : null;
}

type TrackedEventChannelState =
  | { status: 'found'; channel: TextChannel }
  | { status: 'missing' }
  | { status: 'error'; error: unknown };

async function fetchTrackedEventChannelState(
  guild: Guild,
  eventChannelId: string | null,
): Promise<TrackedEventChannelState> {
  if (!eventChannelId) {
    return { status: 'missing' };
  }

  try {
    const channel = await guild.channels.fetch(eventChannelId);
    return isManagedTextChannel(channel) ? { status: 'found', channel } : { status: 'missing' };
  } catch (error) {
    if (isUnknownChannelError(error)) {
      return { status: 'missing' };
    }

    return { status: 'error', error };
  }
}

async function cleanupTrackedEventIfDue(input: {
  guild: Guild;
  trackedEvent: SportsLiveEventChannelSummaryLike;
  now: Date;
}): Promise<boolean> {
  if (!input.trackedEvent.deleteAfterUtc) {
    return false;
  }

  const cleanupAt = input.trackedEvent.deleteAfterUtc;
  if (Number.isNaN(cleanupAt.getTime()) || cleanupAt > input.now) {
    return false;
  }

  const channel = await fetchTrackedEventChannel(input.guild, input.trackedEvent.eventChannelId);
  if (channel) {
    await LIVE_EVENT_QUEUE.add(() =>
      channel.delete(`Delete the finished live event channel for ${input.trackedEvent.eventName}.`),
    );
  }

  const markDeletedResult = await sportsLiveEventService.markDeleted({
    guildId: input.guild.id,
    eventId: input.trackedEvent.eventId,
    deletedAtUtc: input.now,
  });
  if (markDeletedResult.isErr()) {
    throw markDeletedResult.error;
  }

  return true;
}

type SportsLiveEventChannelSummaryLike = {
  eventId: string;
  eventName: string;
  sportName: string;
  eventChannelId: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'cleanup_due' | 'deleted' | 'failed';
  deleteAfterUtc: Date | null;
  highlightsPosted: boolean;
};

export async function resumeTrackedLiveEventsForGuild(input: {
  guild: Guild;
  now?: Date;
}): Promise<{
  deletedChannelCount: number;
  failedEventCount: number;
  highlightsPostedCount: number;
}> {
  const now = input.now ?? new Date();
  const recoverableEventsResult = await sportsLiveEventService.listRecoverableEvents({
    guildId: input.guild.id,
  });
  if (recoverableEventsResult.isErr()) {
    throw recoverableEventsResult.error;
  }

  let deletedChannelCount = 0;
  let failedEventCount = 0;
  let highlightsPostedCount = 0;

  for (const trackedEvent of recoverableEventsResult.value) {
    const channelLookup = await fetchTrackedEventChannelState(input.guild, trackedEvent.eventChannelId);
    if (channelLookup.status === 'error') {
      logger.warn(
        {
          guildId: input.guild.id,
          eventId: trackedEvent.eventId,
          eventChannelId: trackedEvent.eventChannelId,
          errorMessage:
            channelLookup.error instanceof Error ? channelLookup.error.message : 'unknown',
        },
        'live event runtime could not recover the tracked event channel because fetching it failed',
      );
      continue;
    }
    if (channelLookup.status === 'missing') {
      const markFailedResult = await sportsLiveEventService.markFailed({
        guildId: input.guild.id,
        eventId: trackedEvent.eventId,
        failedAtUtc: now,
      });
      if (markFailedResult.isErr()) {
        logger.warn(
          { guildId: input.guild.id, eventId: trackedEvent.eventId, err: markFailedResult.error },
          'live event runtime could not mark the tracked event as failed during recovery',
        );
      } else {
        failedEventCount += 1;
      }

      logger.warn(
        { guildId: input.guild.id, eventId: trackedEvent.eventId, eventChannelId: trackedEvent.eventChannelId },
        'live event runtime could not recover the tracked event channel because it is missing',
      );
      continue;
    }
    const channel = channelLookup.channel;

    if (trackedEvent.status === 'cleanup_due') {
      const deleted = await cleanupTrackedEventIfDue({
        guild: input.guild,
        trackedEvent,
        now,
      });
      if (deleted) {
        deletedChannelCount += 1;
        continue;
      }

      const postedHighlights = await postLiveEventHighlightsIfAvailable({
        guildId: input.guild.id,
        trackedEvent,
        channel,
        now,
      });
      if (postedHighlights) {
        highlightsPostedCount += 1;
      }
    }
  }

  return {
    deletedChannelCount,
    failedEventCount,
    highlightsPostedCount,
  };
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

  const listingsCategory = await fetchManagedCategory(input.guild, config.managedCategoryChannelId);
  if (!listingsCategory) {
    return {
      createdChannelCount: 0,
      updatedChannelCount: 0,
      markedFinishedCount: 0,
    };
  }
  const liveCategory = await fetchManagedCategory(input.guild, config.liveCategoryChannelId ?? null);

  const broadcastCountries =
    config.broadcastCountries && config.broadcastCountries.length > 0
      ? config.broadcastCountries
      : [input.broadcastCountry];
  const liveEventsResult = await sportsDataService.listLiveEventsAcrossCountries({
    timezone: input.timezone,
    broadcastCountries,
  });
  if (liveEventsResult.isErr()) {
    throw liveEventsResult.error;
  }
  const trackedEventsResult = await sportsLiveEventService.listTrackedEvents({
    guildId: input.guild.id,
  });
  if (trackedEventsResult.isErr()) {
    throw trackedEventsResult.error;
  }

  const televisedLiveEvents = mergeDuplicateLiveEvents(
    liveEventsResult.value.data.filter(
      (event) =>
        event.broadcasters.length > 0 &&
        typeof event.sportName === 'string' &&
        event.sportName.trim().length > 0,
    ),
  );
  if (liveEventsResult.value.degraded) {
    logger.warn(
      {
        guildId: input.guild.id,
        failedCountries: liveEventsResult.value.failedCountries,
        successfulCountries: liveEventsResult.value.successfulCountries,
      },
      'live event runtime is reconciling with degraded multi-country results',
    );
  }
  const trackedEventsByEventId = new Map(
    trackedEventsResult.value.map((trackedEvent) => [trackedEvent.eventId, trackedEvent]),
  );
  const trackedEventChannelIds = new Set(
    trackedEventsResult.value.flatMap((trackedEvent) =>
      trackedEvent.eventChannelId ? [trackedEvent.eventChannelId] : [],
    ),
  );
  const bindingsBySport = new Map(bindings.map((binding) => [binding.sportName, binding]));
  const guildChannels = await input.guild.channels.fetch();
  const usedNames = new Set(
    [...guildChannels.values()]
      .filter((channel): channel is NonNullable<typeof channel> => channel !== null)
      .map((channel) => channel.name),
  );

  let createdChannelCount = 0;
  let updatedChannelCount = 0;
  let markedFinishedCount = 0;
  const sportChannelTopicBroadcastCountries = liveEventsResult.value.degraded
    ? liveEventsResult.value.successfulCountries
    : normalizeBroadcastCountries(config.broadcastCountries);

  for (const event of televisedLiveEvents) {
    const sportName = event.sportName ?? DEFAULT_CATEGORY_NAME;
    const trackedEvent = trackedEventsByEventId.get(event.eventId) ?? null;
    const existingChannel = await fetchTrackedEventChannel(input.guild, trackedEvent?.eventChannelId ?? null);
    if (!liveCategory) {
      continue;
    }

    const sportChannel = await ensureSportChannelForLiveEvent({
      guild: input.guild,
      config,
      listingsCategory,
      bindingsBySport,
      usedNames,
      sportName,
      topicBroadcastCountries: sportChannelTopicBroadcastCountries,
      topicDegraded: liveEventsResult.value.degraded,
      topicFailedCountries: liveEventsResult.value.failedCountries,
    });
    if (!sportChannel) {
      continue;
    }
    const desiredName = buildLiveEventChannelName(event.eventName);
    const desiredTopic = buildLiveEventChannelTopic(event.eventId);
    const adoptedChannel = existingChannel
      ? null
      : findAdoptableLiveEventChannel({
          channels: guildChannels.values(),
          trackedEventChannelIds,
          desiredName,
          eventId: event.eventId,
          parentIds: liveCategory ? new Set([liveCategory.id]) : new Set<string>(),
        });
    const desiredExistingName = existingChannel
      ? reserveUniqueChannelName({
          base: desiredName,
          usedNames: new Set(usedNames),
          currentName: existingChannel.name,
        })
      : desiredName;
    const desiredSnapshots = buildLiveEventSnapshots(event);
    const isPlacementUnchanged =
      existingChannel?.name === desiredExistingName &&
      existingChannel.topic === desiredTopic &&
      (liveCategory ? (existingChannel.parentId ?? null) === liveCategory.id : true);
    const isTrackedStateUnchanged =
      trackedEvent?.status === 'live' &&
      trackedEvent.eventChannelId === existingChannel?.id &&
      areSnapshotsEqual(trackedEvent.lastScoreSnapshot, desiredSnapshots.scoreSnapshot) &&
      areSnapshotsEqual(trackedEvent.lastStateSnapshot, desiredSnapshots.stateSnapshot);

    if (existingChannel && isPlacementUnchanged && isTrackedStateUnchanged) {
      const renderResult = await renderActiveLiveEventChannel({
        channel: existingChannel,
        event,
        scoreMessageId: trackedEvent?.scoreMessageId ?? null,
        shouldSendHeader: false,
        allowNoopEdit: true,
      });
      const heartbeatResult = await sportsLiveEventService.upsertTrackedEvent({
        guildId: input.guild.id,
        sportName,
        eventId: event.eventId,
        eventName: event.eventName,
        sportChannelId: sportChannel.id,
        kickoffAtUtc: trackedEvent?.kickoffAtUtc ?? now,
        eventChannelId: existingChannel.id,
        scoreMessageId: renderResult.scoreMessageId,
        status: 'live',
        lastScoreSnapshot: desiredSnapshots.scoreSnapshot,
        lastStateSnapshot: desiredSnapshots.stateSnapshot,
        lastSyncedAtUtc: now,
        finishedAtUtc: null,
        deleteAfterUtc: null,
        highlightsPosted: trackedEvent?.highlightsPosted ?? false,
      });
      if (heartbeatResult.isErr()) {
        throw heartbeatResult.error;
      }
      continue;
    }

    let targetChannel: TextChannel;
    let shouldSendHeader = false;
    if (existingChannel && !isPlacementUnchanged) {
      const reservedName = reserveUniqueChannelName({
        base: desiredName,
        usedNames,
        currentName: existingChannel.name,
      });
      await LIVE_EVENT_QUEUE.add(async () =>
        existingChannel.edit(
          liveCategory
            ? {
                name: reservedName,
                parent: liveCategory.id,
                topic: desiredTopic,
              }
            : {
                name: reservedName,
                topic: desiredTopic,
              },
        ),
      );
      updatedChannelCount += 1;
      targetChannel = existingChannel;
    } else if (existingChannel) {
      targetChannel = existingChannel;
    } else if (adoptedChannel) {
      trackedEventChannelIds.add(adoptedChannel.id);
      targetChannel = adoptedChannel;
      shouldSendHeader = true;
    } else {
      const reservedName = reserveUniqueChannelName({
        base: desiredName,
        usedNames,
      });
      targetChannel = (await LIVE_EVENT_QUEUE.add(async () =>
        input.guild.channels.create({
          name: reservedName,
          type: ChannelType.GuildText,
          parent: liveCategory?.id,
          topic: desiredTopic,
          reason: `Create a temporary live event channel for ${event.eventName}.`,
        }),
      )) as TextChannel;
      trackedEventChannelIds.add(targetChannel.id);
      createdChannelCount += 1;
      shouldSendHeader = true;
    }

    const renderResult = await renderActiveLiveEventChannel({
      channel: targetChannel,
      event,
      scoreMessageId: trackedEvent?.scoreMessageId ?? null,
      shouldSendHeader,
    });

    const persistedTrackedEvent = await sportsLiveEventService.upsertTrackedEvent({
      guildId: input.guild.id,
      sportName,
      eventId: event.eventId,
      eventName: event.eventName,
      sportChannelId: sportChannel.id,
      kickoffAtUtc: trackedEvent?.kickoffAtUtc ?? now,
      eventChannelId: targetChannel.id,
      scoreMessageId: renderResult.scoreMessageId,
      status: 'live',
      lastScoreSnapshot: desiredSnapshots.scoreSnapshot,
      lastStateSnapshot: desiredSnapshots.stateSnapshot,
      lastSyncedAtUtc: now,
      finishedAtUtc: null,
      deleteAfterUtc: null,
      highlightsPosted: trackedEvent?.highlightsPosted ?? false,
    });
    if (persistedTrackedEvent.isErr()) {
      throw persistedTrackedEvent.error;
    }
  }

  const liveEventIds = new Set(televisedLiveEvents.map((event) => event.eventId));
  if (!liveEventsResult.value.degraded) {
    for (const trackedEvent of trackedEventsResult.value) {
      if (
        liveEventIds.has(trackedEvent.eventId) ||
        trackedEvent.status === 'cleanup_due' ||
        trackedEvent.status === 'deleted' ||
        trackedEvent.status === 'failed'
      ) {
        continue;
      }

      const finishedResult = await sportsLiveEventService.markFinished({
        guildId: input.guild.id,
        eventId: trackedEvent.eventId,
        finishedAtUtc: now,
      });
      if (finishedResult.isErr()) {
        logger.warn(
          { guildId: input.guild.id, eventId: trackedEvent.eventId, err: finishedResult.error },
          'live event runtime could not mark the tracked event as finished',
        );
        continue;
      }
      const eventChannel = await fetchTrackedEventChannel(input.guild, trackedEvent.eventChannelId);
      const deleteAfterUtc =
        finishedResult.value.deleteAfterUtc?.toISOString() ??
        new Date(now.getTime() + SPORTS_LIVE_EVENT_CLEANUP_WINDOW_MS).toISOString();

      if (eventChannel) {
        await renderFinishedLiveEventChannel({
          channel: eventChannel,
          eventName: trackedEvent.eventName,
          sportName: trackedEvent.sportName,
          deleteAfterUtc,
        });
        await postLiveEventHighlightsIfAvailable({
          guildId: input.guild.id,
          trackedEvent: finishedResult.value,
          channel: eventChannel,
          now,
        });
      }
      markedFinishedCount += 1;
    }
  }

  for (const trackedEvent of trackedEventsResult.value) {
    if (trackedEvent.status !== 'cleanup_due' || trackedEvent.highlightsPosted) {
      continue;
    }

    const eventChannel = await fetchTrackedEventChannel(input.guild, trackedEvent.eventChannelId);
    if (!eventChannel) {
      continue;
    }

    await postLiveEventHighlightsIfAvailable({
      guildId: input.guild.id,
      trackedEvent,
      channel: eventChannel,
      now,
    });
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
  const trackedEventsResult = await sportsLiveEventService.listTrackedEvents({
    guildId: input.guild.id,
    statuses: ['cleanup_due'],
  });
  if (trackedEventsResult.isErr()) {
    throw trackedEventsResult.error;
  }
  let deletedChannelCount = 0;

  for (const trackedEvent of trackedEventsResult.value) {
    if (!trackedEvent.deleteAfterUtc) {
      continue;
    }

    const cleanupAt = trackedEvent.deleteAfterUtc;
    if (Number.isNaN(cleanupAt.getTime()) || cleanupAt > now) {
      continue;
    }

    const channel = await fetchTrackedEventChannel(input.guild, trackedEvent.eventChannelId);
    if (channel) {
      await LIVE_EVENT_QUEUE.add(() =>
        channel.delete(`Delete the finished live event channel for ${trackedEvent.eventName}.`),
      );
    }
    const markDeletedResult = await sportsLiveEventService.markDeleted({
      guildId: input.guild.id,
      eventId: trackedEvent.eventId,
      deletedAtUtc: now,
    });
    if (markDeletedResult.isErr()) {
      throw markDeletedResult.error;
    }
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

async function runLiveEventStartupRecovery(client: Client): Promise<void> {
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
      await resumeTrackedLiveEventsForGuild({ guild });
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

function queueLiveEventSchedulerStartup(client: Client): void {
  if (liveEventSchedulerInFlight) {
    return;
  }

  liveEventSchedulerInFlight = true;
  void runLiveEventStartupRecovery(client)
    .then(async () => {
      await runLiveEventScheduler(client);
    })
    .finally(() => {
      liveEventSchedulerInFlight = false;
    });
}

export function startLiveEventScheduler(client: Client, pollIntervalMs: number): void {
  if (liveEventSchedulerTimer) {
    return;
  }

  const effectivePollIntervalMs = Math.max(5_000, Math.floor(pollIntervalMs));
  queueLiveEventSchedulerStartup(client);
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

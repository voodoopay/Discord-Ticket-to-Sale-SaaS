import {
  AiDiscordChannelSyncService,
  AiKnowledgeManagementService,
  logger,
} from '@voodoo/core';

export const AI_KNOWLEDGE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type AiKnowledgeRefreshDependencies = {
  websiteService: Pick<AiKnowledgeManagementService, 'listAllWebsiteSources' | 'syncWebsiteSource'>;
  channelService: Pick<
    AiDiscordChannelSyncService,
    'listAllChannelSources' | 'reconcileCategorySources' | 'syncChannelSource'
  >;
};

export type AiKnowledgeRefreshScheduler = {
  runOnce(): Promise<void>;
  start(): void;
  stop(): void;
};

export function createAiKnowledgeRefreshScheduler(
  dependencies: AiKnowledgeRefreshDependencies = {
    websiteService: new AiKnowledgeManagementService(),
    channelService: new AiDiscordChannelSyncService(),
  },
  intervalMs = AI_KNOWLEDGE_REFRESH_INTERVAL_MS,
): AiKnowledgeRefreshScheduler {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function runOnce(): Promise<void> {
    if (running) {
      return;
    }

    running = true;
    try {
      const [websiteSourcesResult, channelSourcesResult] = await Promise.all([
        dependencies.websiteService.listAllWebsiteSources(),
        dependencies.channelService.reconcileCategorySources().then((result) => {
          if (result.isErr()) {
            logger.warn(
              { errorMessage: result.error.message },
              'ai knowledge Discord category source reconciliation failed',
            );
          }

          return dependencies.channelService.listAllChannelSources();
        }),
      ]);

      if (websiteSourcesResult.isErr()) {
        logger.warn(
          { errorMessage: websiteSourcesResult.error.message },
          'ai knowledge website refresh source listing failed',
        );
      } else {
        for (const source of websiteSourcesResult.value) {
          const result = await dependencies.websiteService.syncWebsiteSource({
            guildId: source.guildId,
            sourceId: source.sourceId,
            actorDiscordUserId: source.updatedByDiscordUserId ?? source.createdByDiscordUserId,
          });
          if (result.isErr()) {
            logger.warn(
              { guildId: source.guildId, sourceId: source.sourceId, errorMessage: result.error.message },
              'ai knowledge website refresh failed',
            );
          }
        }
      }

      if (channelSourcesResult.isErr()) {
        logger.warn(
          { errorMessage: channelSourcesResult.error.message },
          'ai knowledge Discord channel refresh source listing failed',
        );
      } else {
        for (const source of channelSourcesResult.value) {
          const result = await dependencies.channelService.syncChannelSource({
            guildId: source.guildId,
            sourceId: source.sourceId,
            actorDiscordUserId: source.updatedByDiscordUserId ?? source.createdByDiscordUserId,
          });
          if (result.isErr()) {
            logger.warn(
              { guildId: source.guildId, sourceId: source.sourceId, errorMessage: result.error.message },
              'ai knowledge Discord channel refresh failed',
            );
          }
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    runOnce,
    start() {
      if (timer) {
        return;
      }
      timer = setInterval(() => {
        void runOnce();
      }, intervalMs);
      timer.unref?.();
      void runOnce();
    },
    stop() {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = null;
    },
  };
}

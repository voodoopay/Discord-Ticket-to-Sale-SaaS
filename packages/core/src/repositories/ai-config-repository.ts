import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import {
  aiGuildConfigs,
  aiReplyChannelCategories,
  aiReplyChannels,
  aiRoleRules,
} from '../infra/db/schema/index.js';

export type AiTonePreset = 'professional' | 'standard' | 'witty' | 'cheeky';
export type AiRoleMode = 'allowlist' | 'blocklist';
export type AiReplyMode = 'inline' | 'thread';
export type AiReplyFrequency = 'low' | 'mid' | 'max';

export type AiGuildConfigRecord = {
  id: string;
  guildId: string;
  enabled: boolean;
  tonePreset: AiTonePreset;
  toneInstructions: string;
  roleMode: AiRoleMode;
  defaultReplyMode: AiReplyMode;
  replyFrequency: AiReplyFrequency;
  unansweredLoggingEnabled: boolean;
  unansweredLogChannelId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiReplyChannelRecord = {
  id: string;
  guildId: string;
  channelId: string;
  replyMode: AiReplyMode;
  createdAt: Date;
  updatedAt: Date;
};

export type AiReplyChannelCategoryRecord = {
  id: string;
  guildId: string;
  categoryId: string;
  replyMode: AiReplyMode;
  createdAt: Date;
  updatedAt: Date;
};

export type AiRoleRuleRecord = {
  id: string;
  guildId: string;
  roleId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AiGuildSettingsSnapshot = {
  guildId: string;
  enabled: boolean;
  tonePreset: AiTonePreset;
  toneInstructions: string;
  roleMode: AiRoleMode;
  defaultReplyMode: AiReplyMode;
  replyFrequency: AiReplyFrequency;
  unansweredLoggingEnabled: boolean;
  unansweredLogChannelId: string | null;
  replyChannels: Array<{
    channelId: string;
    replyMode: AiReplyMode;
  }>;
  replyChannelCategories: Array<{
    categoryId: string;
    replyMode: AiReplyMode;
  }>;
  roleIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type SaveAiGuildSettingsInput = {
  guildId: string;
  enabled?: boolean;
  tonePreset: AiTonePreset;
  toneInstructions: string;
  roleMode: AiRoleMode;
  defaultReplyMode: AiReplyMode;
  replyFrequency: AiReplyFrequency;
  unansweredLoggingEnabled: boolean;
  unansweredLogChannelId: string | null;
  replyChannels: Array<{
    channelId: string;
    replyMode: AiReplyMode;
  }>;
  replyChannelCategories: Array<{
    categoryId: string;
    replyMode: AiReplyMode;
  }>;
  roleIds: string[];
  updatedByDiscordUserId: string;
};

function mapGuildConfigRow(row: typeof aiGuildConfigs.$inferSelect): AiGuildConfigRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    enabled: row.enabled,
    tonePreset: row.tonePreset,
    toneInstructions: row.toneInstructions,
    roleMode: row.roleMode,
    defaultReplyMode: row.defaultReplyMode,
    replyFrequency: row.replyFrequency,
    unansweredLoggingEnabled: row.unansweredLoggingEnabled,
    unansweredLogChannelId: row.unansweredLogChannelId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapReplyChannelRow(row: typeof aiReplyChannels.$inferSelect): AiReplyChannelRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    replyMode: row.replyMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapReplyChannelCategoryRow(
  row: typeof aiReplyChannelCategories.$inferSelect,
): AiReplyChannelCategoryRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    categoryId: row.categoryId,
    replyMode: row.replyMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRoleRuleRow(row: typeof aiRoleRules.$inferSelect): AiRoleRuleRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    roleId: row.roleId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function dedupeReplyChannels(
  replyChannels: SaveAiGuildSettingsInput['replyChannels'],
): SaveAiGuildSettingsInput['replyChannels'] {
  const deduped = new Map<string, SaveAiGuildSettingsInput['replyChannels'][number]>();
  for (const replyChannel of replyChannels) {
    if (!deduped.has(replyChannel.channelId)) {
      deduped.set(replyChannel.channelId, replyChannel);
    }
  }

  return [...deduped.values()];
}

function dedupeReplyChannelCategories(
  replyChannelCategories: SaveAiGuildSettingsInput['replyChannelCategories'],
): SaveAiGuildSettingsInput['replyChannelCategories'] {
  const deduped = new Map<string, SaveAiGuildSettingsInput['replyChannelCategories'][number]>();
  for (const replyChannelCategory of replyChannelCategories) {
    if (!deduped.has(replyChannelCategory.categoryId)) {
      deduped.set(replyChannelCategory.categoryId, replyChannelCategory);
    }
  }

  return [...deduped.values()];
}

function dedupeRoleIds(roleIds: string[]): string[] {
  return [...new Set(roleIds)];
}

function buildDefaultSnapshot(guildId: string): AiGuildSettingsSnapshot {
  return {
    guildId,
    enabled: true,
    tonePreset: 'standard',
    toneInstructions: '',
    roleMode: 'allowlist',
    defaultReplyMode: 'inline',
    replyFrequency: 'mid',
    unansweredLoggingEnabled: false,
    unansweredLogChannelId: null,
    replyChannels: [],
    replyChannelCategories: [],
    roleIds: [],
    createdAt: null,
    updatedAt: null,
  };
}

export class AiConfigRepository {
  private readonly db = getDb();

  public async getGuildConfig(guildId: string): Promise<AiGuildConfigRecord | null> {
    const row = await this.db.query.aiGuildConfigs.findFirst({
      where: eq(aiGuildConfigs.guildId, guildId),
    });

    return row ? mapGuildConfigRow(row) : null;
  }

  public async listReplyChannels(input: { guildId: string }): Promise<AiReplyChannelRecord[]> {
    const rows = await this.db.query.aiReplyChannels.findMany({
      where: eq(aiReplyChannels.guildId, input.guildId),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.channelId), asc(table.id)],
    });

    return rows.map(mapReplyChannelRow);
  }

  public async listRoleRules(input: { guildId: string }): Promise<AiRoleRuleRecord[]> {
    const rows = await this.db.query.aiRoleRules.findMany({
      where: eq(aiRoleRules.guildId, input.guildId),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.roleId), asc(table.id)],
    });

    return rows.map(mapRoleRuleRow);
  }

  public async listReplyChannelCategories(input: {
    guildId: string;
  }): Promise<AiReplyChannelCategoryRecord[]> {
    const rows = await this.db.query.aiReplyChannelCategories.findMany({
      where: eq(aiReplyChannelCategories.guildId, input.guildId),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.categoryId), asc(table.id)],
    });

    return rows.map(mapReplyChannelCategoryRow);
  }

  public async getGuildSettingsSnapshot(input: {
    guildId: string;
  }): Promise<AiGuildSettingsSnapshot> {
    const [config, replyChannels, replyChannelCategories, roleRules] = await Promise.all([
      this.getGuildConfig(input.guildId),
      this.listReplyChannels({ guildId: input.guildId }),
      this.listReplyChannelCategories({ guildId: input.guildId }),
      this.listRoleRules({ guildId: input.guildId }),
    ]);

    if (!config) {
      return buildDefaultSnapshot(input.guildId);
    }

    return {
      guildId: config.guildId,
      enabled: config.enabled,
      tonePreset: config.tonePreset,
      toneInstructions: config.toneInstructions,
      roleMode: config.roleMode,
      defaultReplyMode: config.defaultReplyMode,
      replyFrequency: config.replyFrequency,
      unansweredLoggingEnabled: config.unansweredLoggingEnabled,
      unansweredLogChannelId: config.unansweredLogChannelId,
      replyChannels: replyChannels.map((replyChannel) => ({
        channelId: replyChannel.channelId,
        replyMode: replyChannel.replyMode,
      })),
      replyChannelCategories: replyChannelCategories.map((replyChannelCategory) => ({
        categoryId: replyChannelCategory.categoryId,
        replyMode: replyChannelCategory.replyMode,
      })),
      roleIds: roleRules.map((roleRule) => roleRule.roleId),
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }

  public async saveGuildSettings(
    input: SaveAiGuildSettingsInput,
  ): Promise<AiGuildSettingsSnapshot> {
    const now = new Date();
    const replyChannels = dedupeReplyChannels(input.replyChannels);
    const replyChannelCategories = dedupeReplyChannelCategories(input.replyChannelCategories);
    const roleIds = dedupeRoleIds(input.roleIds);

    return this.db.transaction(async (tx) => {
      const existing = await tx.query.aiGuildConfigs.findFirst({
        where: eq(aiGuildConfigs.guildId, input.guildId),
      });
      const enabled = input.enabled ?? true;
      const createdAt = existing?.createdAt ?? now;

      if (existing) {
        await tx
          .update(aiGuildConfigs)
          .set({
            enabled,
            tonePreset: input.tonePreset,
            toneInstructions: input.toneInstructions,
            roleMode: input.roleMode,
            defaultReplyMode: input.defaultReplyMode,
            replyFrequency: input.replyFrequency,
            unansweredLoggingEnabled: input.unansweredLoggingEnabled,
            unansweredLogChannelId: input.unansweredLogChannelId,
            updatedAt: now,
          })
          .where(eq(aiGuildConfigs.id, existing.id));
      } else {
        await tx.insert(aiGuildConfigs).values({
          id: ulid(),
          guildId: input.guildId,
          enabled,
          tonePreset: input.tonePreset,
          toneInstructions: input.toneInstructions,
          roleMode: input.roleMode,
          defaultReplyMode: input.defaultReplyMode,
          replyFrequency: input.replyFrequency,
          unansweredLoggingEnabled: input.unansweredLoggingEnabled,
          unansweredLogChannelId: input.unansweredLogChannelId,
          createdAt: now,
          updatedAt: now,
        });
      }

      await tx.delete(aiReplyChannels).where(eq(aiReplyChannels.guildId, input.guildId));
      if (replyChannels.length > 0) {
        await tx.insert(aiReplyChannels).values(
          replyChannels.map((replyChannel) => ({
            id: ulid(),
            guildId: input.guildId,
            channelId: replyChannel.channelId,
            replyMode: replyChannel.replyMode,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      await tx
        .delete(aiReplyChannelCategories)
        .where(eq(aiReplyChannelCategories.guildId, input.guildId));
      if (replyChannelCategories.length > 0) {
        await tx.insert(aiReplyChannelCategories).values(
          replyChannelCategories.map((replyChannelCategory) => ({
            id: ulid(),
            guildId: input.guildId,
            categoryId: replyChannelCategory.categoryId,
            replyMode: replyChannelCategory.replyMode,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      await tx.delete(aiRoleRules).where(eq(aiRoleRules.guildId, input.guildId));
      if (roleIds.length > 0) {
        await tx.insert(aiRoleRules).values(
          roleIds.map((roleId) => ({
            id: ulid(),
            guildId: input.guildId,
            roleId,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      return {
        guildId: input.guildId,
        enabled,
        tonePreset: input.tonePreset,
        toneInstructions: input.toneInstructions,
        roleMode: input.roleMode,
        defaultReplyMode: input.defaultReplyMode,
        replyFrequency: input.replyFrequency,
        unansweredLoggingEnabled: input.unansweredLoggingEnabled,
        unansweredLogChannelId: input.unansweredLogChannelId,
        replyChannels: replyChannels.map((replyChannel) => ({
          channelId: replyChannel.channelId,
          replyMode: replyChannel.replyMode,
        })),
        replyChannelCategories: replyChannelCategories.map((replyChannelCategory) => ({
          categoryId: replyChannelCategory.categoryId,
          replyMode: replyChannelCategory.replyMode,
        })),
        roleIds,
        createdAt: createdAt.toISOString(),
        updatedAt: now.toISOString(),
      };
    });
  }
}

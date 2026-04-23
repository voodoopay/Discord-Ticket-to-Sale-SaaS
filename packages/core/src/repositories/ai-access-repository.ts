import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import { aiAuthorizedUsers } from '../infra/db/schema/index.js';
import { isMysqlDuplicateEntryError } from '../utils/mysql-errors.js';

export type AiAuthorizedUserRecord = {
  id: string;
  guildId: string;
  discordUserId: string;
  grantedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapAuthorizedUserRow(
  row: typeof aiAuthorizedUsers.$inferSelect,
): AiAuthorizedUserRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    discordUserId: row.discordUserId,
    grantedByDiscordUserId: row.grantedByDiscordUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class AiAccessRepository {
  private readonly db = getDb();

  private async updateAuthorizedUserByGuildAndDiscordId(input: {
    guildId: string;
    discordUserId: string;
    grantedByDiscordUserId: string;
    updatedAt: Date;
  }): Promise<void> {
    await this.db
      .update(aiAuthorizedUsers)
      .set({
        guildId: input.guildId,
        grantedByDiscordUserId: input.grantedByDiscordUserId,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(aiAuthorizedUsers.guildId, input.guildId),
          eq(aiAuthorizedUsers.discordUserId, input.discordUserId),
        ),
      );
  }

  private async getAuthorizedUserByDiscordId(input: {
    guildId: string;
    discordUserId: string;
  }): Promise<AiAuthorizedUserRecord | null> {
    const row = await this.db.query.aiAuthorizedUsers.findFirst({
      where: and(
        eq(aiAuthorizedUsers.guildId, input.guildId),
        eq(aiAuthorizedUsers.discordUserId, input.discordUserId),
      ),
      orderBy: (table, { desc }) => [desc(table.updatedAt), desc(table.createdAt)],
    });

    return row ? mapAuthorizedUserRow(row) : null;
  }

  public async listAuthorizedUsers(input: {
    guildId: string;
  }): Promise<AiAuthorizedUserRecord[]> {
    const rows = await this.db.query.aiAuthorizedUsers.findMany({
      where: eq(aiAuthorizedUsers.guildId, input.guildId),
      orderBy: (table, { desc }) => [desc(table.updatedAt), desc(table.createdAt)],
    });

    const dedupedByDiscordUserId = new Map<string, AiAuthorizedUserRecord>();
    for (const row of rows) {
      const mapped = mapAuthorizedUserRow(row);
      if (!dedupedByDiscordUserId.has(mapped.discordUserId)) {
        dedupedByDiscordUserId.set(mapped.discordUserId, mapped);
      }
    }

    return [...dedupedByDiscordUserId.values()].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );
  }

  public async upsertAuthorizedUser(input: {
    guildId: string;
    discordUserId: string;
    grantedByDiscordUserId: string;
  }): Promise<{ created: boolean; record: AiAuthorizedUserRecord }> {
    const existing = await this.getAuthorizedUserByDiscordId({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    const now = new Date();
    let created = false;

    if (existing) {
      await this.updateAuthorizedUserByGuildAndDiscordId({
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        grantedByDiscordUserId: input.grantedByDiscordUserId,
        updatedAt: now,
      });
    } else {
      try {
        await this.db.insert(aiAuthorizedUsers).values({
          id: ulid(),
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          grantedByDiscordUserId: input.grantedByDiscordUserId,
          createdAt: now,
          updatedAt: now,
        });
        created = true;
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }

        await this.updateAuthorizedUserByGuildAndDiscordId({
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          grantedByDiscordUserId: input.grantedByDiscordUserId,
          updatedAt: now,
        });
      }
    }

    const record = await this.getAuthorizedUserByDiscordId({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    if (!record) {
      throw new Error('Failed to upsert AI authorized user');
    }

    return {
      created,
      record,
    };
  }

  public async revokeAuthorizedUser(input: {
    guildId: string;
    discordUserId: string;
  }): Promise<boolean> {
    const existing = await this.getAuthorizedUserByDiscordId({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    if (!existing) {
      return false;
    }

    await this.db
      .delete(aiAuthorizedUsers)
      .where(
        and(
          eq(aiAuthorizedUsers.guildId, input.guildId),
          eq(aiAuthorizedUsers.discordUserId, input.discordUserId),
        ),
      );

    return true;
  }
}

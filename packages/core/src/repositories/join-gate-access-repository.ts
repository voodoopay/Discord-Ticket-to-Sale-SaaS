import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import { joinGateAuthorizedUsers } from '../infra/db/schema/index.js';

export type JoinGateAuthorizedUserRecord = {
  id: string;
  tenantId: string;
  guildId: string;
  discordUserId: string;
  grantedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapAuthorizedUserRow(
  row: typeof joinGateAuthorizedUsers.$inferSelect,
): JoinGateAuthorizedUserRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guildId: row.guildId,
    discordUserId: row.discordUserId,
    grantedByDiscordUserId: row.grantedByDiscordUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class JoinGateAccessRepository {
  private readonly db = getDb();

  private async getAuthorizedUserByDiscordId(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<JoinGateAuthorizedUserRecord | null> {
    const row = await this.db.query.joinGateAuthorizedUsers.findFirst({
      where: and(
        eq(joinGateAuthorizedUsers.tenantId, input.tenantId),
        eq(joinGateAuthorizedUsers.guildId, input.guildId),
        eq(joinGateAuthorizedUsers.discordUserId, input.discordUserId),
      ),
    });

    return row ? mapAuthorizedUserRow(row) : null;
  }

  public async listAuthorizedUsers(input: {
    tenantId: string;
    guildId: string;
  }): Promise<JoinGateAuthorizedUserRecord[]> {
    const rows = await this.db.query.joinGateAuthorizedUsers.findMany({
      where: and(
        eq(joinGateAuthorizedUsers.tenantId, input.tenantId),
        eq(joinGateAuthorizedUsers.guildId, input.guildId),
      ),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
    });

    return rows.map(mapAuthorizedUserRow);
  }

  public async upsertAuthorizedUser(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    grantedByDiscordUserId: string;
  }): Promise<{ created: boolean; record: JoinGateAuthorizedUserRecord }> {
    const existing = await this.getAuthorizedUserByDiscordId(input);
    const now = new Date();

    if (existing) {
      await this.db
        .update(joinGateAuthorizedUsers)
        .set({
          grantedByDiscordUserId: input.grantedByDiscordUserId,
          updatedAt: now,
        })
        .where(eq(joinGateAuthorizedUsers.id, existing.id));
    } else {
      await this.db.insert(joinGateAuthorizedUsers).values({
        id: ulid(),
        tenantId: input.tenantId,
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        grantedByDiscordUserId: input.grantedByDiscordUserId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const record = await this.getAuthorizedUserByDiscordId(input);
    if (!record) {
      throw new Error('Failed to upsert join-gate authorized user');
    }

    return {
      created: !existing,
      record,
    };
  }

  public async revokeAuthorizedUser(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<boolean> {
    const existing = await this.getAuthorizedUserByDiscordId(input);
    if (!existing) {
      return false;
    }

    await this.db
      .delete(joinGateAuthorizedUsers)
      .where(eq(joinGateAuthorizedUsers.id, existing.id));

    return true;
  }
}

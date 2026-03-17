import { and, eq, ne, or } from 'drizzle-orm';
import { ulid } from 'ulid';

import { getDb } from '../infra/db/client.js';
import { telegramChatLinks } from '../infra/db/schema/index.js';

export type TelegramChatLinkRecord = {
  id: string;
  tenantId: string;
  guildId: string;
  chatId: string;
  chatTitle: string;
  linkedByDiscordUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapTelegramChatLink(row: typeof telegramChatLinks.$inferSelect): TelegramChatLinkRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    guildId: row.guildId,
    chatId: row.chatId,
    chatTitle: row.chatTitle,
    linkedByDiscordUserId: row.linkedByDiscordUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TelegramLinkRepository {
  private readonly db = getDb();

  public async getByChatId(chatId: string): Promise<TelegramChatLinkRecord | null> {
    const row = await this.db.query.telegramChatLinks.findFirst({
      where: eq(telegramChatLinks.chatId, chatId),
    });

    return row ? mapTelegramChatLink(row) : null;
  }

  public async getByGuild(input: {
    tenantId: string;
    guildId: string;
  }): Promise<TelegramChatLinkRecord | null> {
    const row = await this.db.query.telegramChatLinks.findFirst({
      where: and(eq(telegramChatLinks.tenantId, input.tenantId), eq(telegramChatLinks.guildId, input.guildId)),
    });

    return row ? mapTelegramChatLink(row) : null;
  }

  public async upsertLink(input: {
    tenantId: string;
    guildId: string;
    chatId: string;
    chatTitle: string;
    linkedByDiscordUserId: string | null;
  }): Promise<TelegramChatLinkRecord> {
    const chatId = input.chatId.trim();
    const chatTitle = input.chatTitle.trim() || chatId;

    return this.db.transaction(async (tx) => {
      await tx.delete(telegramChatLinks).where(
        and(
          eq(telegramChatLinks.chatId, chatId),
          or(ne(telegramChatLinks.tenantId, input.tenantId), ne(telegramChatLinks.guildId, input.guildId)),
        ),
      );

      const existing = await tx
        .select()
        .from(telegramChatLinks)
        .where(and(eq(telegramChatLinks.tenantId, input.tenantId), eq(telegramChatLinks.guildId, input.guildId)))
        .limit(1);

      const row = existing[0];
      const now = new Date();

      if (row) {
        await tx
          .update(telegramChatLinks)
          .set({
            chatId,
            chatTitle,
            linkedByDiscordUserId: input.linkedByDiscordUserId,
            updatedAt: now,
          })
          .where(eq(telegramChatLinks.id, row.id));

        return {
          ...mapTelegramChatLink(row),
          chatId,
          chatTitle,
          linkedByDiscordUserId: input.linkedByDiscordUserId,
          updatedAt: now,
        };
      }

      const id = ulid();
      await tx.insert(telegramChatLinks).values({
        id,
        tenantId: input.tenantId,
        guildId: input.guildId,
        chatId,
        chatTitle,
        linkedByDiscordUserId: input.linkedByDiscordUserId,
        createdAt: now,
        updatedAt: now,
      });

      return {
        id,
        tenantId: input.tenantId,
        guildId: input.guildId,
        chatId,
        chatTitle,
        linkedByDiscordUserId: input.linkedByDiscordUserId,
        createdAt: now,
        updatedAt: now,
      };
    });
  }
}

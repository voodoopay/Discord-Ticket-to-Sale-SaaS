export type ScopedPlatformId = {
  platform: 'discord' | 'telegram';
  rawId: string;
};

const DISCORD_PREFIX = 'dc:';
const TELEGRAM_PREFIX = 'tg:';

export function parsePlatformScopedId(value: string): ScopedPlatformId {
  const trimmed = value.trim();

  if (trimmed.startsWith(TELEGRAM_PREFIX)) {
    return {
      platform: 'telegram',
      rawId: trimmed.slice(TELEGRAM_PREFIX.length),
    };
  }

  if (trimmed.startsWith(DISCORD_PREFIX)) {
    return {
      platform: 'discord',
      rawId: trimmed.slice(DISCORD_PREFIX.length),
    };
  }

  return {
    platform: 'discord',
    rawId: trimmed,
  };
}

export function toTelegramScopedId(rawId: string): string {
  return `${TELEGRAM_PREFIX}${rawId.trim()}`;
}

export function formatUserReference(value: string): string {
  const scoped = parsePlatformScopedId(value);
  if (scoped.platform === 'telegram') {
    return `Telegram user ${scoped.rawId}`;
  }

  return `<@${scoped.rawId}>`;
}

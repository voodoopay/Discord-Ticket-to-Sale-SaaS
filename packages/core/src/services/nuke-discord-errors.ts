import { AppError, fromUnknownError } from '../domain/errors.js';

type DiscordErrorBody = {
  message?: string;
  code?: number;
  errors?: unknown;
};

function parseDiscordApiFailure(message: string): { statusCode: number; bodyText: string | null } | null {
  const match = /^Discord API \w+ .+ failed \((\d{3})\)(?:: (.+))?$/u.exec(message);
  if (!match) {
    return null;
  }

  return {
    statusCode: Number(match[1]),
    bodyText: match[2]?.trim() ?? null,
  };
}

function extractDiscordBodyMessage(bodyText: string | null): string | null {
  if (!bodyText) {
    return null;
  }

  try {
    const parsed = JSON.parse(bodyText) as DiscordErrorBody;
    if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
      return parsed.message.trim();
    }
  } catch {
    if (bodyText.trim().length > 0) {
      return bodyText.trim();
    }
  }

  return null;
}

export function toNukeAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    const parsed = parseDiscordApiFailure(error.message);
    if (!parsed) {
      return fromUnknownError(error, 'NUKE_INTERNAL_ERROR');
    }

    const discordMessage = extractDiscordBodyMessage(parsed.bodyText);
    if (parsed.statusCode === 403) {
      return new AppError(
        'NUKE_DISCORD_PERMISSION_DENIED',
        'Discord rejected the nuke request: Missing Permissions. Check the nuke bot role and the channel/category permissions.',
        403,
      );
    }

    if (parsed.statusCode === 404) {
      return new AppError(
        'NUKE_DISCORD_TARGET_MISSING',
        'Discord could not find that channel. It may already have been deleted or moved.',
        404,
      );
    }

    return new AppError(
      'NUKE_DISCORD_API_ERROR',
      discordMessage
        ? `Discord rejected the nuke request: ${discordMessage}`
        : `Discord rejected the nuke request (${parsed.statusCode}).`,
      parsed.statusCode >= 500 ? 500 : 422,
    );
  }

  return fromUnknownError(error, 'NUKE_INTERNAL_ERROR');
}

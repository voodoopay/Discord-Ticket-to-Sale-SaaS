import { AppError, fromUnknownError } from '../domain/errors.js';

type DiscordErrorBody = {
  message?: string;
  code?: number;
  errors?: unknown;
};

type ErrorWithOriginalError = Error & {
  originalError?: unknown;
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

function unwrapErrorMessage(error: Error): string {
  const originalError = (error as ErrorWithOriginalError).originalError;
  if (originalError instanceof Error && originalError.message.trim().length > 0) {
    return originalError.message;
  }

  return error.message;
}

export function toNukeAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    const message = unwrapErrorMessage(error);
    const parsed = parseDiscordApiFailure(message);
    if (!parsed) {
      if (/(?:fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)/iu.test(message)) {
        return new AppError(
          'NUKE_DISCORD_NETWORK_ERROR',
          'Nuke worker could not reach Discord. Check outbound network access and DISCORD_API_BASE_URL.',
          503,
        );
      }

      if (message === 'Nuke lock could not be renewed.' || message === 'Nuke lock lease was lost while executing this run.') {
        return new AppError('NUKE_LOCK_LOST', 'Nuke worker lost its execution lock. Try again.', 409);
      }

      if (message === 'Channel does not belong to the expected guild.') {
        return new AppError(
          'NUKE_CHANNEL_GUILD_MISMATCH',
          'Discord returned a channel outside the expected server. Try the command again from the target channel.',
          422,
        );
      }

      if (message === 'Only text and announcement channels are supported for nuke.') {
        return new AppError('NUKE_CHANNEL_TYPE_UNSUPPORTED', message, 422);
      }

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

import { describe, expect, it } from 'vitest';

import { AppError } from '../src/domain/errors.js';
import { toNukeAppError } from '../src/services/nuke-discord-errors.js';

describe('toNukeAppError', () => {
  it('maps Discord permission failures to a user-facing AppError', () => {
    const error = toNukeAppError(
      new Error(
        'Discord API POST /guilds/123/channels failed (403): {"message":"Missing Permissions","code":50013}',
      ),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('NUKE_DISCORD_PERMISSION_DENIED');
    expect(error.statusCode).toBe(403);
  });

  it('maps Discord 404 failures to a user-facing AppError', () => {
    const error = toNukeAppError(
      new Error('Discord API GET /channels/123 failed (404): {"message":"Unknown Channel","code":10003}'),
    );

    expect(error.code).toBe('NUKE_DISCORD_TARGET_MISSING');
    expect(error.statusCode).toBe(404);
  });
});

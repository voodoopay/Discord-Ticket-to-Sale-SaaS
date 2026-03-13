import { describe, expect, it } from 'vitest';

import { AppError } from '@voodoo/core';

import { mapNukeError } from './nuke.js';

describe('mapNukeError', () => {
  it('shows actionable Discord worker failures instead of the generic internal error message', () => {
    const error = new AppError(
      'NUKE_DISCORD_API_ERROR',
      'Discord rejected the nuke request (500).',
      500,
    );

    expect(mapNukeError(error)).toBe('Discord rejected the nuke request (500).');
  });

  it('keeps unknown worker failures generic', () => {
    const error = new AppError('NUKE_INTERNAL_ERROR', 'database exploded', 500);

    expect(mapNukeError(error)).toBe(
      'Nuke command failed due to an internal worker error. Please try again and check logs.',
    );
  });
});

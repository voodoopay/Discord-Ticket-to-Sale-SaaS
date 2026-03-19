import { describe, expect, it } from 'vitest';

import { formatTelegramReferralSubmissionLog } from './referral-submission-log.js';

describe('formatTelegramReferralSubmissionLog', () => {
  it('formats a Discord referral-log message for Telegram submissions', () => {
    expect(
      formatTelegramReferralSubmissionLog({
        submitterLabel: '@merchant',
        submitterTelegramUserId: 'tg:123',
        guildId: 'guild-1',
        referrerEmail: 'referrer@example.com',
        referredEmail: 'new@example.com',
        status: 'accepted',
      }),
    ).toBe(
      [
        '**Referral Submission**',
        'Source: Telegram',
        'Server: `guild-1`',
        'Submitter: @merchant (`tg:123`)',
        'Referrer Email: `referrer@example.com`',
        'Referred Email: `new@example.com`',
        'Result: `accepted`',
      ].join('\n'),
    );
  });
});

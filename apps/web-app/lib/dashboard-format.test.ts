import { describe, expect, it } from 'vitest';

import {
  REFERRAL_SUBMISSION_TEMPLATE_PLACEHOLDERS,
  REFERRAL_THANK_YOU_TEMPLATE_PLACEHOLDERS,
} from './dashboard-format';

describe('dashboard referral placeholder lists', () => {
  it('defines the submission template placeholders shown in the dashboard', () => {
    expect(REFERRAL_SUBMISSION_TEMPLATE_PLACEHOLDERS).toEqual([
      '{submitter_mention}',
      '{referrer_email}',
      '{referred_email}',
    ]);
  });

  it('defines the thank-you template placeholders shown in the dashboard', () => {
    expect(REFERRAL_THANK_YOU_TEMPLATE_PLACEHOLDERS).toEqual([
      '{referrer_mention}',
      '{referrer_email}',
      '{referred_email}',
      '{points}',
      '{amount_gbp}',
      '{order_session_id}',
    ]);
  });
});

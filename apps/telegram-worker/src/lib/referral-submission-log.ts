export function formatTelegramReferralSubmissionLog(input: {
  submitterLabel: string;
  submitterTelegramUserId: string;
  guildId: string;
  referrerEmail: string;
  referredEmail: string;
  status: 'accepted' | 'duplicate' | 'self_blocked';
}): string {
  const safeReferrer = input.referrerEmail.replace(/`/g, "'");
  const safeReferred = input.referredEmail.replace(/`/g, "'");

  return [
    '**Referral Submission**',
    'Source: Telegram',
    `Server: \`${input.guildId}\``,
    `Submitter: ${input.submitterLabel} (\`${input.submitterTelegramUserId}\`)`,
    `Referrer Email: \`${safeReferrer}\``,
    `Referred Email: \`${safeReferred}\``,
    `Result: \`${input.status}\``,
  ].join('\n');
}

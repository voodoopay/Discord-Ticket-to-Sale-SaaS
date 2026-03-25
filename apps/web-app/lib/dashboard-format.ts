import type { QuestionDraft } from './dashboard-types';

export const DEFAULT_CURRENCY = 'GBP';
export const DEFAULT_POINT_VALUE_MAJOR = '0.01';
export const DEFAULT_REFERRAL_REWARD_MAJOR = '0.00';
export const DEFAULT_REFERRAL_THANK_YOU_TEMPLATE =
  'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.';
export const DEFAULT_REFERRAL_SUBMISSION_TEMPLATE =
  'Referral submitted successfully. We will reward points automatically after the first paid order.';
export const REFERRAL_SUBMISSION_TEMPLATE_PLACEHOLDERS = [
  '{submitter_mention}',
  '{referrer_email}',
  '{referred_email}',
] as const;
export const REFERRAL_THANK_YOU_TEMPLATE_PLACEHOLDERS = [
  '{referrer_mention}',
  '{referrer_email}',
  '{referred_email}',
  '{points}',
  '{amount_gbp}',
  '{order_session_id}',
] as const;
export const REQUIRED_EMAIL_QUESTION_KEY = 'email';
export const REQUIRED_EMAIL_QUESTION_LABEL = 'What is your email?';

export function formatMinorToMajor(minor: number): string {
  if (!Number.isFinite(minor) || minor < 0) {
    return '0.00';
  }

  return (minor / 100).toFixed(2);
}

export function formatCurrencyMinor(minor: number, currency = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format((minor || 0) / 100);
}

export function parsePriceToMinor(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Value must be a valid positive number like 9.99');
  }

  return Math.round(parsed * 100);
}

export function parsePointValueMajorToMinor(value: string): number {
  if (!value.trim()) {
    return 1;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Point value must be greater than 0, for example 0.01');
  }

  const minor = Math.round(parsed * 100);
  if (minor < 1) {
    throw new Error('Point value is too small. Minimum is 0.01.');
  }

  return minor;
}

export function formatPointValueMinorToMajor(pointValueMinor: number): string {
  if (!Number.isFinite(pointValueMinor) || pointValueMinor <= 0) {
    return DEFAULT_POINT_VALUE_MAJOR;
  }

  return (pointValueMinor / 100).toFixed(2);
}

export function parseWholePoints(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Points must be a positive whole number.');
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Points must be a positive whole number.');
  }

  return parsed;
}

export function normalizeDiscordId(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }

  return '';
}

export function normalizeDiscordIdList(value: unknown): string[] {
  const normalizeArray = (items: unknown[]): string[] => [
    ...new Set(items.map((item) => normalizeDiscordId(item)).filter(Boolean)),
  ];

  if (Array.isArray(value)) {
    return normalizeArray(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.includes(',')) {
      return normalizeArray(trimmed.split(','));
    }

    return normalizeArray([trimmed]);
  }

  return [];
}

export function normalizeCategoryKey(value: string): string {
  return value.trim().toLowerCase();
}

export function ensureRequiredEmailQuestion(questions: QuestionDraft[]): QuestionDraft[] {
  const nonEmailQuestions = questions.filter(
    (question) => question.key.trim().toLowerCase() !== REQUIRED_EMAIL_QUESTION_KEY,
  );

  const requiredEmailQuestion: QuestionDraft = {
    key: REQUIRED_EMAIL_QUESTION_KEY,
    label: REQUIRED_EMAIL_QUESTION_LABEL,
    fieldType: 'email',
    required: true,
    sensitive: false,
    sortOrder: 0,
  };

  return [requiredEmailQuestion, ...nonEmailQuestions].map((question, sortOrder) => ({
    ...question,
    sortOrder,
  }));
}

export function previewReferralRewardPoints(referralRewardMajor: string, pointValueMajor: string): number {
  try {
    const rewardMinor = parsePriceToMinor(referralRewardMajor);
    const pointValueMinor = parsePointValueMajorToMinor(pointValueMajor);
    return Math.max(0, Math.floor(rewardMinor / Math.max(1, pointValueMinor)));
  } catch {
    return 0;
  }
}

export function normalizeCheckoutDomainInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).host;
    } catch {
      candidate = candidate.replace(/^https?:\/\//i, '');
    }
  }

  candidate = candidate.replace(/^https?:\/\//i, '');
  const slashIndex = candidate.indexOf('/');
  if (slashIndex >= 0) {
    candidate = candidate.slice(0, slashIndex);
  }

  return candidate.replace(/\/+$/, '').trim().toLowerCase();
}

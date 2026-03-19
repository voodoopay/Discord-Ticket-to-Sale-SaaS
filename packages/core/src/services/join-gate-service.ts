import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { AppError, fromUnknownError } from '../domain/errors.js';
import {
  JoinGateRepository,
  type JoinGateEmailIndexRecord,
  type JoinGateMemberRecord,
  type JoinGateLookupType,
  type JoinGateNormalizedEmail,
  type JoinGateSelectionPath,
} from '../repositories/join-gate-repository.js';

export type JoinGateConfigInput = {
  joinGateEnabled?: boolean;
  joinGateFallbackChannelId?: string | null;
  joinGateVerifiedRoleId?: string | null;
  joinGateTicketCategoryId?: string | null;
  joinGateCurrentLookupChannelId?: string | null;
  joinGateNewLookupChannelId?: string | null;
  joinGatePanelTitle?: string | null;
  joinGatePanelMessage?: string | null;
};

export type JoinGateMessageEmbedLike = {
  title?: string | null;
  description?: string | null;
  fields?: Array<{ name?: string | null; value?: string | null }>;
  footer?: { text?: string | null } | null;
  author?: { name?: string | null } | null;
};

export type JoinGateMessageLike = {
  content?: string | null;
  embeds?: JoinGateMessageEmbedLike[];
};

export type JoinGateSubmissionResult =
  | {
      status: 'matched';
      email: JoinGateNormalizedEmail;
      member: JoinGateMemberRecord;
      lookupEntry: JoinGateEmailIndexRecord;
    }
  | {
      status: 'retry';
      attemptsRemaining: number;
      member: JoinGateMemberRecord;
    }
  | {
      status: 'kick_required';
      member: JoinGateMemberRecord;
    }
  | {
      status: 'already_verified';
      member: JoinGateMemberRecord;
    }
  | {
      status: 'already_kicked';
      member: JoinGateMemberRecord;
    };

const emailSchema = z.string().trim().min(3).max(320).email();
const emailCandidatePattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const requiredConfigFields: Array<Exclude<keyof Required<JoinGateConfigInput>, 'joinGateEnabled'>> = [
  'joinGateFallbackChannelId',
  'joinGateVerifiedRoleId',
  'joinGateTicketCategoryId',
  'joinGateCurrentLookupChannelId',
  'joinGateNewLookupChannelId',
];

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectMessageSegments(input: JoinGateMessageLike): string[] {
  const segments: string[] = [];

  const content = input.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    segments.push(content.trim());
  }

  for (const embed of input.embeds ?? []) {
    const title = embed.title;
    if (typeof title === 'string' && title.trim().length > 0) {
      segments.push(title.trim());
    }
    const description = embed.description;
    if (typeof description === 'string' && description.trim().length > 0) {
      segments.push(description.trim());
    }
    for (const field of embed.fields ?? []) {
      const fieldName = field.name;
      if (typeof fieldName === 'string' && fieldName.trim().length > 0) {
        segments.push(fieldName.trim());
      }
      const fieldValue = field.value;
      if (typeof fieldValue === 'string' && fieldValue.trim().length > 0) {
        segments.push(fieldValue.trim());
      }
    }
    const footerText = embed.footer?.text;
    if (typeof footerText === 'string' && footerText.trim().length > 0) {
      segments.push(footerText.trim());
    }
    const authorName = embed.author?.name;
    if (typeof authorName === 'string' && authorName.trim().length > 0) {
      segments.push(authorName.trim());
    }
  }

  return segments;
}

export function validateJoinGateConfig(input: JoinGateConfigInput): Result<void, AppError> {
  if (!input.joinGateEnabled) {
    return ok(undefined);
  }

  const missingFields = requiredConfigFields.filter((field) => !hasText(input[field]));
  if (missingFields.length > 0) {
    return err(
      new AppError(
        'JOIN_GATE_CONFIG_INVALID',
        `Join gate is enabled but missing required settings: ${missingFields.join(', ')}`,
        422,
      ),
    );
  }

  return ok(undefined);
}

export function normalizeJoinGateEmail(email: string): Result<JoinGateNormalizedEmail, AppError> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return err(new AppError('INVALID_EMAIL_ADDRESS', 'Invalid email address', 422));
  }

  const emailDisplay = parsed.data.trim();
  return ok({
    emailDisplay,
    emailNormalized: emailDisplay.toLowerCase(),
  });
}

export function extractJoinGateEmailsFromText(text: string): JoinGateNormalizedEmail[] {
  const found = new Map<string, JoinGateNormalizedEmail>();

  for (const candidate of text.match(emailCandidatePattern) ?? []) {
    const normalized = normalizeJoinGateEmail(candidate);
    if (normalized.isErr()) {
      continue;
    }

    found.set(normalized.value.emailNormalized, normalized.value);
  }

  return [...found.values()];
}

export function extractJoinGateEmailsFromMessage(input: JoinGateMessageLike): JoinGateNormalizedEmail[] {
  const found = new Map<string, JoinGateNormalizedEmail>();

  for (const segment of collectMessageSegments(input)) {
    for (const email of extractJoinGateEmailsFromText(segment)) {
      if (!found.has(email.emailNormalized)) {
        found.set(email.emailNormalized, email);
      }
    }
  }

  return [...found.values()];
}

export type JoinGateRepositoryLike = Pick<
  JoinGateRepository,
  | 'clearLookupSourceEntries'
  | 'completeVerification'
  | 'countLookupEntries'
  | 'deleteLookupMessageEntries'
  | 'findLookupEntry'
  | 'getMember'
  | 'incrementFailedAttempts'
  | 'markMemberKicked'
  | 'markMemberMatched'
  | 'recordDmStatus'
  | 'replaceLookupMessageEntries'
  | 'setMemberSelection'
  | 'upsertMemberOnJoin'
>;

function toLookupEmailInputs(emails: JoinGateNormalizedEmail[]): JoinGateNormalizedEmail[] {
  return emails.map((email) => ({
    emailDisplay: email.emailDisplay,
    emailNormalized: email.emailNormalized,
  }));
}

export class JoinGateService {
  constructor(private readonly repository: JoinGateRepositoryLike = new JoinGateRepository()) {}

  public async registerJoin(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<Result<JoinGateMemberRecord, AppError>> {
    try {
      const record = await this.repository.upsertMemberOnJoin({
        tenantId: input.tenantId,
        guildId: input.guildId,
        discordUserId: input.discordUserId,
      });

      return ok(record);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async setSelection(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    path: JoinGateSelectionPath;
  }): Promise<Result<JoinGateMemberRecord, AppError>> {
    try {
      const record = await this.repository.setMemberSelection({
        tenantId: input.tenantId,
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        path: input.path,
      });

      return ok(record);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async markDmStatus(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    dmStatus: 'unknown' | 'sent' | 'blocked' | 'failed';
  }): Promise<Result<JoinGateMemberRecord, AppError>> {
    try {
      return ok(
        await this.repository.recordDmStatus({
          tenantId: input.tenantId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          dmStatus: input.dmStatus,
        }),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async submitEmail(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    path: JoinGateLookupType;
    email: string;
  }): Promise<Result<JoinGateSubmissionResult, AppError>> {
    try {
      const normalized = normalizeJoinGateEmail(input.email);
      if (normalized.isErr()) {
        return err(normalized.error);
      }

      const existingMember =
        (await this.repository.getMember({
          tenantId: input.tenantId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
        })) ??
        (await this.repository.upsertMemberOnJoin({
          tenantId: input.tenantId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
        }));

      if (existingMember.status === 'verified') {
        return ok({ status: 'already_verified', member: existingMember });
      }

      if (existingMember.status === 'kicked') {
        return ok({ status: 'already_kicked', member: existingMember });
      }

      if (existingMember.failedAttempts >= 3) {
        return ok({ status: 'kick_required', member: existingMember });
      }

      if (existingMember.selectedPath !== input.path || existingMember.status === 'pending') {
        await this.repository.setMemberSelection({
          tenantId: input.tenantId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          path: input.path,
        });
      }

      const lookupEntry = await this.repository.findLookupEntry({
        tenantId: input.tenantId,
        guildId: input.guildId,
        lookupType: input.path,
        emailNormalized: normalized.value.emailNormalized,
      });

      if (!lookupEntry) {
        const failedAttempts = await this.repository.incrementFailedAttempts({
          tenantId: input.tenantId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
        });

        if (failedAttempts.failedAttempts >= 3) {
          return ok({ status: 'kick_required', member: failedAttempts });
        }

        return ok({
          status: 'retry',
          attemptsRemaining: Math.max(0, 3 - failedAttempts.failedAttempts),
          member: failedAttempts,
        });
      }

      const matched = await this.repository.markMemberMatched({
        tenantId: input.tenantId,
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        path: input.path,
        emailDisplay: normalized.value.emailDisplay,
        emailNormalized: normalized.value.emailNormalized,
      });

      return ok({
        status: 'matched',
        email: normalized.value,
        member: matched,
        lookupEntry,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async completeVerification(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    ticketChannelId: string;
  }): Promise<Result<JoinGateMemberRecord, AppError>> {
    try {
      return ok(
        await this.repository.completeVerification({
          tenantId: input.tenantId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          ticketChannelId: input.ticketChannelId,
        }),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async syncLookupMessage(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    sourceChannelId: string;
    sourceMessageId: string;
    message: JoinGateMessageLike;
  }): Promise<
    Result<
      {
        emails: JoinGateNormalizedEmail[];
        entries: JoinGateEmailIndexRecord[];
      },
      AppError
    >
  > {
    try {
      const emails = extractJoinGateEmailsFromMessage(input.message);
      const entries = await this.repository.replaceLookupMessageEntries({
        tenantId: input.tenantId,
        guildId: input.guildId,
        lookupType: input.lookupType,
        sourceChannelId: input.sourceChannelId,
        sourceMessageId: input.sourceMessageId,
        emails: toLookupEmailInputs(emails),
      });

      return ok({ emails, entries });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async deleteLookupMessage(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    sourceChannelId: string;
    sourceMessageId: string;
  }): Promise<Result<number, AppError>> {
    try {
      return ok(
        await this.repository.deleteLookupMessageEntries({
          tenantId: input.tenantId,
          guildId: input.guildId,
          lookupType: input.lookupType,
          sourceChannelId: input.sourceChannelId,
          sourceMessageId: input.sourceMessageId,
        }),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async clearLookupSource(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    sourceChannelId: string;
  }): Promise<Result<number, AppError>> {
    try {
      return ok(
        await this.repository.clearLookupSourceEntries({
          tenantId: input.tenantId,
          guildId: input.guildId,
          lookupType: input.lookupType,
          sourceChannelId: input.sourceChannelId,
        }),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async countLookupEntries(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    sourceChannelId?: string | null;
  }): Promise<Result<number, AppError>> {
    try {
      return ok(
        await this.repository.countLookupEntries({
          tenantId: input.tenantId,
          guildId: input.guildId,
          lookupType: input.lookupType,
          sourceChannelId: input.sourceChannelId ?? null,
        }),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async markKicked(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<Result<JoinGateMemberRecord, AppError>> {
    try {
      return ok(
        await this.repository.markMemberKicked({
          tenantId: input.tenantId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
        }),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }
}

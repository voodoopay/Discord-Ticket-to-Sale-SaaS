import { describe, expect, it } from 'vitest';

import {
  extractJoinGateEmailsFromText,
  extractJoinGateEmailsFromMessage,
  JoinGateService,
  normalizeJoinGateEmail,
  validateJoinGateConfig,
  type JoinGateMessageLike,
  type JoinGateRepositoryLike,
} from '../src/services/join-gate-service.js';
import { AppError } from '../src/domain/errors.js';
import type {
  JoinGateEmailIndexRecord,
  JoinGateMemberRecord,
  JoinGateLookupType,
  JoinGateSelectionPath,
} from '../src/repositories/join-gate-repository.js';

function now(): Date {
  return new Date('2026-03-19T12:00:00.000Z');
}

function makeMember(overrides: Partial<JoinGateMemberRecord> = {}): JoinGateMemberRecord {
  return {
    id: '01J0JOINGATEMEMBER000000001',
    tenantId: '01J0TENANT0000000000000001',
    guildId: '123456789012345678',
    discordUserId: '223456789012345678',
    status: 'pending',
    selectedPath: null,
    failedAttempts: 0,
    verifiedEmailNormalized: null,
    verifiedEmailDisplay: null,
    ticketChannelId: null,
    dmStatus: 'unknown',
    joinedAt: now(),
    selectedAt: null,
    matchedAt: null,
    verifiedAt: null,
    kickedAt: null,
    dmSentAt: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function makeLookupEntry(overrides: Partial<JoinGateEmailIndexRecord> = {}): JoinGateEmailIndexRecord {
  return {
    id: '01J0JOINGATELOOKUP000000001',
    tenantId: '01J0TENANT0000000000000001',
    guildId: '123456789012345678',
    lookupType: 'current_customer',
    sourceChannelId: '333456789012345678',
    sourceMessageId: '444456789012345678',
    emailNormalized: 'customer@example.com',
    emailDisplay: 'customer@example.com',
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function createThrowingRepository(): JoinGateRepositoryLike {
  const boom = async (): Promise<never> => {
    throw new Error('boom');
  };

  return {
    upsertMemberOnJoin: boom,
    getMember: boom,
    setMemberSelection: boom,
    recordDmStatus: boom,
    incrementFailedAttempts: boom,
    markMemberMatched: boom,
    completeVerification: boom,
    markMemberKicked: boom,
    findLookupEntry: boom,
    replaceLookupMessageEntries: boom,
    deleteLookupMessageEntries: boom,
    clearLookupSourceEntries: boom,
    countLookupEntries: boom,
  };
}

class InMemoryJoinGateRepository implements JoinGateRepositoryLike {
  public readonly members = new Map<string, JoinGateMemberRecord>();
  public readonly lookupEntries = new Map<string, JoinGateEmailIndexRecord>();

  private memberKey(input: { tenantId: string; guildId: string; discordUserId: string }): string {
    return [input.tenantId, input.guildId, input.discordUserId].join(':');
  }

  private lookupKey(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    emailNormalized: string;
  }): string {
    return [input.tenantId, input.guildId, input.lookupType, input.emailNormalized].join(':');
  }

  public async upsertMemberOnJoin(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<JoinGateMemberRecord> {
    const key = this.memberKey(input);
    const existing = this.members.get(key);
    const record = existing ?? makeMember({ tenantId: input.tenantId, guildId: input.guildId, discordUserId: input.discordUserId });
    const reset = makeMember({
      tenantId: input.tenantId,
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });

    const next = existing
      ? {
          ...existing,
          ...reset,
          id: existing.id,
          createdAt: existing.createdAt,
        }
      : record;

    this.members.set(key, next);
    return next;
  }

  public async getMember(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<JoinGateMemberRecord | null> {
    return this.members.get(this.memberKey(input)) ?? null;
  }

  public async setMemberSelection(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    path: JoinGateSelectionPath;
  }): Promise<JoinGateMemberRecord> {
    const key = this.memberKey(input);
    const existing = this.members.get(key) ?? makeMember({
      tenantId: input.tenantId,
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    const nowValue = now();
    const next = {
      ...existing,
      selectedPath: input.path,
      status: 'awaiting_email' as const,
      selectedAt: nowValue,
      updatedAt: nowValue,
    };
    this.members.set(key, next);
    return next;
  }

  public async recordDmStatus(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    dmStatus: 'unknown' | 'sent' | 'blocked' | 'failed';
  }): Promise<JoinGateMemberRecord> {
    const key = this.memberKey(input);
    const existing = this.members.get(key) ?? makeMember({
      tenantId: input.tenantId,
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    const nowValue = now();
    const next = {
      ...existing,
      dmStatus: input.dmStatus,
      dmSentAt: input.dmStatus === 'sent' ? nowValue : null,
      updatedAt: nowValue,
    };
    this.members.set(key, next);
    return next;
  }

  public async incrementFailedAttempts(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<JoinGateMemberRecord> {
    const key = this.memberKey(input);
    const existing = this.members.get(key) ?? makeMember({
      tenantId: input.tenantId,
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    const nowValue = now();
    const next = {
      ...existing,
      failedAttempts: existing.failedAttempts + 1,
      updatedAt: nowValue,
    };
    this.members.set(key, next);
    return next;
  }

  public async markMemberMatched(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    path: JoinGateSelectionPath;
    emailNormalized: string;
    emailDisplay: string;
  }): Promise<JoinGateMemberRecord> {
    const key = this.memberKey(input);
    const existing = this.members.get(key) ?? makeMember({
      tenantId: input.tenantId,
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    const nowValue = now();
    const next = {
      ...existing,
      selectedPath: input.path,
      status: 'matched' as const,
      verifiedEmailNormalized: input.emailNormalized,
      verifiedEmailDisplay: input.emailDisplay,
      matchedAt: nowValue,
      updatedAt: nowValue,
    };
    this.members.set(key, next);
    return next;
  }

  public async completeVerification(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    ticketChannelId: string;
  }): Promise<JoinGateMemberRecord> {
    const key = this.memberKey(input);
    const existing = this.members.get(key) ?? makeMember({
      tenantId: input.tenantId,
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    const nowValue = now();
    const next = {
      ...existing,
      status: 'verified' as const,
      ticketChannelId: input.ticketChannelId,
      verifiedAt: nowValue,
      updatedAt: nowValue,
    };
    this.members.set(key, next);
    return next;
  }

  public async markMemberKicked(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<JoinGateMemberRecord> {
    const key = this.memberKey(input);
    const existing = this.members.get(key) ?? makeMember({
      tenantId: input.tenantId,
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    });
    const nowValue = now();
    const next = {
      ...existing,
      status: 'kicked' as const,
      kickedAt: nowValue,
      updatedAt: nowValue,
    };
    this.members.set(key, next);
    return next;
  }

  public async findLookupEntry(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    emailNormalized: string;
  }): Promise<JoinGateEmailIndexRecord | null> {
    return this.lookupEntries.get(this.lookupKey(input)) ?? null;
  }

  public async replaceLookupMessageEntries(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    sourceChannelId: string;
    sourceMessageId: string;
    emails: Array<{ emailNormalized: string; emailDisplay: string }>;
  }): Promise<JoinGateEmailIndexRecord[]> {
    const removed = await this.deleteLookupMessageEntries(input);
    void removed;

    const entries = input.emails.map((email, index) => {
      const record = makeLookupEntry({
        tenantId: input.tenantId,
        guildId: input.guildId,
        lookupType: input.lookupType,
        sourceChannelId: input.sourceChannelId,
        sourceMessageId: input.sourceMessageId,
        emailNormalized: email.emailNormalized,
        emailDisplay: email.emailDisplay,
        id: `01J0JOINGATEL${String(index).padStart(14, '0')}`,
      });
      this.lookupEntries.set(this.lookupKey(record), record);
      return record;
    });

    return entries;
  }

  public async deleteLookupMessageEntries(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    sourceChannelId: string;
    sourceMessageId: string;
  }): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.lookupEntries.entries()) {
      if (
        entry.tenantId === input.tenantId &&
        entry.guildId === input.guildId &&
        entry.lookupType === input.lookupType &&
        entry.sourceChannelId === input.sourceChannelId &&
        entry.sourceMessageId === input.sourceMessageId
      ) {
        this.lookupEntries.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  public async clearLookupSourceEntries(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    sourceChannelId: string;
  }): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.lookupEntries.entries()) {
      if (
        entry.tenantId === input.tenantId &&
        entry.guildId === input.guildId &&
        entry.lookupType === input.lookupType &&
        entry.sourceChannelId === input.sourceChannelId
      ) {
        this.lookupEntries.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  public async countLookupEntries(input: {
    tenantId: string;
    guildId: string;
    lookupType: JoinGateLookupType;
    sourceChannelId?: string | null;
  }): Promise<number> {
    let count = 0;
    for (const entry of this.lookupEntries.values()) {
      if (
        entry.tenantId === input.tenantId &&
        entry.guildId === input.guildId &&
        entry.lookupType === input.lookupType &&
        (input.sourceChannelId == null || entry.sourceChannelId === input.sourceChannelId)
      ) {
        count += 1;
      }
    }

    return count;
  }
}

describe('join gate service', () => {
  it('validates enabled join-gate config before persistence', () => {
    const result = validateJoinGateConfig({
      joinGateEnabled: true,
      joinGateFallbackChannelId: null,
      joinGateVerifiedRoleId: null,
      joinGateTicketCategoryId: null,
      joinGateCurrentLookupChannelId: null,
      joinGateNewLookupChannelId: null,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.code).toBe('JOIN_GATE_CONFIG_INVALID');
  });

  it('accepts a complete join-gate config and normalizes valid email input', () => {
    const configResult = validateJoinGateConfig({
      joinGateEnabled: true,
      joinGateFallbackChannelId: 'fallback-1',
      joinGateVerifiedRoleId: 'role-1',
      joinGateTicketCategoryId: 'category-1',
      joinGateCurrentLookupChannelId: 'current-1',
      joinGateNewLookupChannelId: 'new-1',
    });
    expect(configResult.isOk()).toBe(true);

    const emailResult = normalizeJoinGateEmail('Customer@Example.com');
    expect(emailResult.isOk()).toBe(true);
    if (emailResult.isErr()) {
      return;
    }

    expect(emailResult.value).toEqual({
      emailDisplay: 'Customer@Example.com',
      emailNormalized: 'customer@example.com',
    });
  });

  it('rejects invalid email strings and extracts unique emails from plain text', () => {
    const emailResult = normalizeJoinGateEmail('not-an-email');
    expect(emailResult.isErr()).toBe(true);

    expect(
      extractJoinGateEmailsFromText('One: FIRST@example.com, two: first@example.com, three: new@example.com'),
    ).toEqual([
      {
        emailDisplay: 'first@example.com',
        emailNormalized: 'first@example.com',
      },
      {
        emailDisplay: 'new@example.com',
        emailNormalized: 'new@example.com',
      },
    ]);
  });

  it('extracts and deduplicates emails from message content and embeds', () => {
    const message: JoinGateMessageLike = {
      content: 'Reach us at Current@example.com or billing@example.com.',
      embeds: [
        {
          title: 'Customer record',
          description: 'Backup contact: current@example.com',
          fields: [{ name: 'Referral', value: 'new@example.com' }],
          footer: { text: 'Footer with sales@example.com' },
        },
      ],
    };

    expect(extractJoinGateEmailsFromMessage(message).map((entry) => entry.emailNormalized)).toEqual([
      'current@example.com',
      'billing@example.com',
      'new@example.com',
      'sales@example.com',
    ]);
  });

  it('records DM status transitions for join prompts', async () => {
    const repository = new InMemoryJoinGateRepository();
    const service = new JoinGateService(repository);

    await service.registerJoin({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
    });

    const sent = await service.markDmStatus({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      dmStatus: 'sent',
    });
    expect(sent.isOk()).toBe(true);
    if (sent.isErr()) {
      return;
    }
    expect(sent.value.dmStatus).toBe('sent');
    expect(sent.value.dmSentAt).not.toBeNull();

    const blocked = await service.markDmStatus({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      dmStatus: 'blocked',
    });
    expect(blocked.isOk()).toBe(true);
    if (blocked.isErr()) {
      return;
    }
    expect(blocked.value.dmStatus).toBe('blocked');
    expect(blocked.value.dmSentAt).toBeNull();
  });

  it('rejects invalid submitEmail input before touching repository state', async () => {
    const repository = new InMemoryJoinGateRepository();
    const service = new JoinGateService(repository);

    const result = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
      email: 'definitely-not-an-email',
    });

    expect(result.isErr()).toBe(true);
    expect(repository.members.size).toBe(0);
  });

  it('syncs, counts, deletes, and clears lookup entries', async () => {
    const repository = new InMemoryJoinGateRepository();
    const service = new JoinGateService(repository);

    const synced = await service.syncLookupMessage({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: 'lookup-1',
      sourceMessageId: 'message-1',
      message: {
        content: 'customer@example.com and customer@example.com',
        embeds: [
          {
            description: 'backup@example.com',
          },
        ],
      },
    });
    expect(synced.isOk()).toBe(true);
    if (synced.isErr()) {
      return;
    }
    expect(synced.value.emails.map((entry) => entry.emailNormalized)).toEqual([
      'customer@example.com',
      'backup@example.com',
    ]);

    const countAll = await service.countLookupEntries({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: null,
    });
    expect(countAll.isOk()).toBe(true);
    if (countAll.isErr()) {
      return;
    }
    expect(countAll.value).toBe(2);

    const deleted = await service.deleteLookupMessage({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: 'lookup-1',
      sourceMessageId: 'message-1',
    });
    expect(deleted.isOk()).toBe(true);
    if (deleted.isErr()) {
      return;
    }
    expect(deleted.value).toBe(2);

    await service.syncLookupMessage({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'new_customer',
      sourceChannelId: 'lookup-2',
      sourceMessageId: 'message-2',
      message: {
        content: 'new@example.com',
      },
    });
    await service.syncLookupMessage({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'new_customer',
      sourceChannelId: 'lookup-2',
      sourceMessageId: 'message-3',
      message: {
        content: 'referral@example.com',
      },
    });

    const cleared = await service.clearLookupSource({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'new_customer',
      sourceChannelId: 'lookup-2',
    });
    expect(cleared.isOk()).toBe(true);
    if (cleared.isErr()) {
      return;
    }
    expect(cleared.value).toBe(2);
  });

  it('matches emails, opens the verification state, and preserves shared fail counts', async () => {
    const repository = new InMemoryJoinGateRepository();
    repository.lookupEntries.set(
      '01J0TENANT0000000000000001:123456789012345678:current_customer:customer@example.com',
      makeLookupEntry(),
    );

    const service = new JoinGateService(repository);
    const member = await service.registerJoin({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
    });
    expect(member.isOk()).toBe(true);

    const selection = await service.setSelection({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
    });
    expect(selection.isOk()).toBe(true);

    const matched = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
      email: 'customer@example.com',
    });

    expect(matched.isOk()).toBe(true);
    if (matched.isErr()) {
      return;
    }

    expect(matched.value.status).toBe('matched');
    expect(matched.value.member.status).toBe('matched');
    expect(matched.value.member.verifiedEmailNormalized).toBe('customer@example.com');

    const completed = await service.completeVerification({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      ticketChannelId: '555456789012345678',
    });

    expect(completed.isOk()).toBe(true);
    if (completed.isErr()) {
      return;
    }

    expect(completed.value.status).toBe('verified');
    expect(completed.value.ticketChannelId).toBe('555456789012345678');
  });

  it('matches new-customer lookup entries and exposes terminal verification states', async () => {
    const repository = new InMemoryJoinGateRepository();
    repository.lookupEntries.set(
      '01J0TENANT0000000000000001:123456789012345678:new_customer:new@example.com',
      makeLookupEntry({
        lookupType: 'new_customer',
        emailNormalized: 'new@example.com',
        emailDisplay: 'new@example.com',
      }),
    );

    const service = new JoinGateService(repository);
    await service.registerJoin({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
    });

    const matched = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'new_customer',
      email: 'new@example.com',
    });
    expect(matched.isOk()).toBe(true);
    if (matched.isErr()) {
      return;
    }
    expect(matched.value.status).toBe('matched');

    await service.completeVerification({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      ticketChannelId: 'ticket-1',
    });

    const verified = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'new_customer',
      email: 'new@example.com',
    });
    expect(verified.isOk()).toBe(true);
    if (verified.isErr()) {
      return;
    }
    expect(verified.value.status).toBe('already_verified');

    await service.markKicked({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '999999999999999999',
    });

    const kicked = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '999999999999999999',
      path: 'current_customer',
      email: 'kicked@example.com',
    });
    expect(kicked.isOk()).toBe(true);
    if (kicked.isErr()) {
      return;
    }
    expect(kicked.value.status).toBe('already_kicked');
  });

  it('returns kick required immediately when a member has already exhausted attempts', async () => {
    const repository = new InMemoryJoinGateRepository();
    repository.members.set(
      '01J0TENANT0000000000000001:123456789012345678:223456789012345678',
      makeMember({
        failedAttempts: 3,
        status: 'awaiting_email',
        selectedPath: 'current_customer',
      }),
    );

    const service = new JoinGateService(repository);
    const result = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
      email: 'customer@example.com',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.status).toBe('kick_required');
    expect(result.value.member.failedAttempts).toBe(3);
  });

  it('matches new-customer lookups and returns the matched lookup record', async () => {
    const repository = new InMemoryJoinGateRepository();
    repository.lookupEntries.set(
      '01J0TENANT0000000000000001:123456789012345678:new_customer:new@example.com',
      makeLookupEntry({
        lookupType: 'new_customer',
        emailNormalized: 'new@example.com',
        emailDisplay: 'new@example.com',
      }),
    );

    const service = new JoinGateService(repository);
    await service.registerJoin({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
    });

    const matched = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'new_customer',
      email: 'new@example.com',
    });

    expect(matched.isOk()).toBe(true);
    if (matched.isErr() || matched.value.status !== 'matched') {
      return;
    }

    expect(matched.value.lookupEntry.lookupType).toBe('new_customer');
    expect(matched.value.member.selectedPath).toBe('new_customer');
  });

  it('kicks after three failed attempts across both paths', async () => {
    const repository = new InMemoryJoinGateRepository();
    const service = new JoinGateService(repository);

    await service.registerJoin({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
    });

    await service.setSelection({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
    });

    const first = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
      email: 'missing-1@example.com',
    });
    expect(first.isOk()).toBe(true);
    if (first.isErr()) {
      return;
    }
    expect(first.value.status).toBe('retry');

    await service.setSelection({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'new_customer',
    });

    const second = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'new_customer',
      email: 'missing-2@example.com',
    });
    expect(second.isOk()).toBe(true);
    if (second.isErr()) {
      return;
    }
    expect(second.value.status).toBe('retry');

    const third = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
      email: 'missing-3@example.com',
    });

    expect(third.isOk()).toBe(true);
    if (third.isErr()) {
      return;
    }

    expect(third.value.status).toBe('kick_required');
    expect(third.value.member.status).toBe('awaiting_email');
    expect(third.value.member.failedAttempts).toBe(3);

    const kicked = await service.markKicked({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
    });

    expect(kicked.isOk()).toBe(true);
    if (kicked.isErr()) {
      return;
    }

    expect(kicked.value.status).toBe('kicked');
  });

  it('records dm status and handles already verified/already kicked terminal states', async () => {
    const repository = new InMemoryJoinGateRepository();
    const service = new JoinGateService(repository);

    await service.registerJoin({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
    });

    const dmStatus = await service.markDmStatus({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      dmStatus: 'sent',
    });

    expect(dmStatus.isOk()).toBe(true);
    if (dmStatus.isErr()) {
      return;
    }

    expect(dmStatus.value.dmStatus).toBe('sent');
    expect(dmStatus.value.dmSentAt).not.toBeNull();

    await service.completeVerification({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      ticketChannelId: '555456789012345678',
    });

    const alreadyVerified = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
      email: 'customer@example.com',
    });

    expect(alreadyVerified.isOk()).toBe(true);
    if (alreadyVerified.isErr()) {
      return;
    }

    expect(alreadyVerified.value.status).toBe('already_verified');

    await service.registerJoin({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '323456789012345678',
    });
    await service.markKicked({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '323456789012345678',
    });

    const alreadyKicked = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '323456789012345678',
      path: 'current_customer',
      email: 'customer@example.com',
    });

    expect(alreadyKicked.isOk()).toBe(true);
    if (alreadyKicked.isErr()) {
      return;
    }

    expect(alreadyKicked.value.status).toBe('already_kicked');
  });

  it('syncs, counts, deletes, and clears lookup index entries by message and source channel', async () => {
    const repository = new InMemoryJoinGateRepository();
    const service = new JoinGateService(repository);

    const synced = await service.syncLookupMessage({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: '333456789012345678',
      sourceMessageId: '444456789012345678',
      message: {
        content: 'customer@example.com and second@example.com',
      },
    });

    expect(synced.isOk()).toBe(true);
    if (synced.isErr()) {
      return;
    }

    expect(synced.value.emails.map((entry) => entry.emailNormalized)).toEqual([
      'customer@example.com',
      'second@example.com',
    ]);
    expect(synced.value.entries).toHaveLength(2);

    const counted = await service.countLookupEntries({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
    });

    expect(counted.isOk()).toBe(true);
    if (counted.isErr()) {
      return;
    }

    expect(counted.value).toBe(2);

    const deleted = await service.deleteLookupMessage({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: '333456789012345678',
      sourceMessageId: '444456789012345678',
    });

    expect(deleted.isOk()).toBe(true);
    if (deleted.isErr()) {
      return;
    }

    expect(deleted.value).toBe(2);

    await service.syncLookupMessage({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: '333456789012345678',
      sourceMessageId: '555456789012345678',
      message: {
        content: 'third@example.com',
      },
    });

    const cleared = await service.clearLookupSource({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: '333456789012345678',
    });

    expect(cleared.isOk()).toBe(true);
    if (cleared.isErr()) {
      return;
    }

    expect(cleared.value).toBe(1);
  });

  it('wraps repository failures as AppError results across service boundaries', async () => {
    const service = new JoinGateService(createThrowingRepository());

    const registerJoin = await service.registerJoin({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
    });
    expect(registerJoin.isErr()).toBe(true);
    if (registerJoin.isOk()) {
      return;
    }
    expect(registerJoin.error).toBeInstanceOf(AppError);

    const setSelection = await service.setSelection({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
    });
    expect(setSelection.isErr()).toBe(true);

    const markDmStatus = await service.markDmStatus({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      dmStatus: 'blocked',
    });
    expect(markDmStatus.isErr()).toBe(true);

    const submitEmail = await service.submitEmail({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      path: 'current_customer',
      email: 'customer@example.com',
    });
    expect(submitEmail.isErr()).toBe(true);

    const completeVerification = await service.completeVerification({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
      ticketChannelId: '555456789012345678',
    });
    expect(completeVerification.isErr()).toBe(true);

    const syncLookupMessage = await service.syncLookupMessage({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: '333456789012345678',
      sourceMessageId: '444456789012345678',
      message: { content: 'customer@example.com' },
    });
    expect(syncLookupMessage.isErr()).toBe(true);

    const deleteLookupMessage = await service.deleteLookupMessage({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: '333456789012345678',
      sourceMessageId: '444456789012345678',
    });
    expect(deleteLookupMessage.isErr()).toBe(true);

    const clearLookupSource = await service.clearLookupSource({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
      sourceChannelId: '333456789012345678',
    });
    expect(clearLookupSource.isErr()).toBe(true);

    const countLookupEntries = await service.countLookupEntries({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      lookupType: 'current_customer',
    });
    expect(countLookupEntries.isErr()).toBe(true);

    const markKicked = await service.markKicked({
      tenantId: '01J0TENANT0000000000000001',
      guildId: '123456789012345678',
      discordUserId: '223456789012345678',
    });
    expect(markKicked.isErr()).toBe(true);
  });
});

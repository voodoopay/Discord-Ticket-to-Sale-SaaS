import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiAccessService } from '../src/services/ai-access-service.js';
import { AiConfigService } from '../src/services/ai-config-service.js';

function createAccessRepository() {
  return {
    listAuthorizedUsers: vi.fn().mockResolvedValue([]),
    upsertAuthorizedUser: vi.fn(),
    revokeAuthorizedUser: vi.fn(),
  };
}

function createConfigRepository() {
  const snapshot = {
    guildId: 'guild-1',
    enabled: true,
    tonePreset: 'professional',
    toneInstructions: 'Be sharp and concise.',
    roleMode: 'allowlist',
    defaultReplyMode: 'inline',
    replyFrequency: 'mid',
    unansweredLoggingEnabled: false,
    unansweredLogChannelId: null,
    replyChannels: [{ channelId: 'chan-1', replyMode: 'thread' }],
    replyChannelCategories: [],
    roleIds: ['role-1'],
    createdAt: '2026-04-23T10:00:00.000Z',
    updatedAt: '2026-04-23T10:00:00.000Z',
  } as const;

  return {
    getGuildSettingsSnapshot: vi.fn().mockResolvedValue(snapshot),
    saveGuildSettings: vi.fn().mockResolvedValue(snapshot),
  };
}

describe('AI access and config services', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps AI activation isolated to ai_authorized_users', async () => {
    const repository = createAccessRepository();
    repository.listAuthorizedUsers.mockResolvedValue([
      {
        id: 'auth-1',
        guildId: 'guild-1',
        discordUserId: 'user-2',
        grantedByDiscordUserId: 'owner-1',
        createdAt: new Date('2026-04-23T10:00:00.000Z'),
        updatedAt: new Date('2026-04-23T10:00:00.000Z'),
      },
    ]);
    const service = new AiAccessService(repository);

    const result = await service.getCommandAccessState({
      guildId: 'guild-1',
      discordUserId: 'user-2',
    });

    expect(repository.listAuthorizedUsers).toHaveBeenCalledWith({ guildId: 'guild-1' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      locked: true,
      allowed: true,
      activated: true,
      authorizedUserCount: 1,
    });
  });

  it('returns a guild activation snapshot from ai_authorized_users only', async () => {
    const repository = createAccessRepository();
    const service = new AiAccessService(repository);

    const result = await service.getGuildActivationState({ guildId: 'guild-1' });

    expect(repository.listAuthorizedUsers).toHaveBeenCalledWith({ guildId: 'guild-1' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toEqual({
      activated: false,
      authorizedUserCount: 0,
    });
  });

  it('persists guild config, reply channels, and role rules together', async () => {
    const repository = createConfigRepository();
    const service = new AiConfigService(repository);

    const result = await service.saveGuildSettings({
      guildId: 'guild-1',
      tonePreset: 'professional',
      toneInstructions: 'Be sharp and concise.',
      roleMode: 'allowlist',
      defaultReplyMode: 'inline',
      replyFrequency: 'mid',
      unansweredLoggingEnabled: false,
      unansweredLogChannelId: null,
      replyChannels: [{ channelId: 'chan-1', replyMode: 'thread' }],
      replyChannelCategories: [],
      roleIds: ['role-1'],
      updatedByDiscordUserId: 'user-1',
    });

    expect(repository.saveGuildSettings).toHaveBeenCalledWith({
      guildId: 'guild-1',
      tonePreset: 'professional',
      toneInstructions: 'Be sharp and concise.',
      roleMode: 'allowlist',
      defaultReplyMode: 'inline',
      replyFrequency: 'mid',
      unansweredLoggingEnabled: false,
      unansweredLogChannelId: null,
      replyChannels: [{ channelId: 'chan-1', replyMode: 'thread' }],
      replyChannelCategories: [],
      roleIds: ['role-1'],
      updatedByDiscordUserId: 'user-1',
    });
    expect(repository.getGuildSettingsSnapshot).not.toHaveBeenCalled();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.replyChannels).toEqual([{ channelId: 'chan-1', replyMode: 'thread' }]);
    expect(result.value.roleIds).toEqual(['role-1']);
  });

  it('reads a normalized guild settings snapshot', async () => {
    const repository = createConfigRepository();
    const service = new AiConfigService(repository);

    const result = await service.getGuildSettingsSnapshot({ guildId: 'guild-1' });

    expect(repository.getGuildSettingsSnapshot).toHaveBeenCalledWith({ guildId: 'guild-1' });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value).toMatchObject({
      guildId: 'guild-1',
      enabled: true,
      tonePreset: 'professional',
      roleMode: 'allowlist',
      defaultReplyMode: 'inline',
      replyFrequency: 'mid',
      unansweredLoggingEnabled: false,
      unansweredLogChannelId: null,
      replyChannels: [{ channelId: 'chan-1', replyMode: 'thread' }],
      roleIds: ['role-1'],
    });
  });
});

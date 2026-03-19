import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationCommandOptionType, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

vi.mock('@voodoo/core', () => {
  class AppError extends Error {
    public readonly code: string;
    public readonly statusCode: number;

    constructor(code: string, message: string, statusCode: number) {
      super(message);
      this.name = 'AppError';
      this.code = code;
      this.statusCode = statusCode;
    }
  }

  class JoinGateAccessService {
    public async getCommandAccessState(): Promise<never> {
      throw new Error('Mock getCommandAccessState not implemented');
    }

    public async listAuthorizedUsers(): Promise<never> {
      throw new Error('Mock listAuthorizedUsers not implemented');
    }

    public async grantUserAccess(): Promise<never> {
      throw new Error('Mock grantUserAccess not implemented');
    }

    public async revokeUserAccess(): Promise<never> {
      throw new Error('Mock revokeUserAccess not implemented');
    }
  }

  class TenantRepository {
    public async getTenantByGuildId(): Promise<never> {
      throw new Error('Mock getTenantByGuildId not implemented');
    }

    public async getGuildConfig(): Promise<never> {
      throw new Error('Mock getGuildConfig not implemented');
    }

    public async upsertGuildConfig(): Promise<never> {
      throw new Error('Mock upsertGuildConfig not implemented');
    }
  }

  return {
    AppError,
    JoinGateAccessService,
    TenantRepository,
    getEnv: () => ({
      superAdminDiscordIds: (process.env.SUPER_ADMIN_DISCORD_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    }),
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    resetEnvForTests: () => undefined,
    validateJoinGateConfig: () => ({
      isErr: () => false,
      isOk: () => true,
      value: undefined,
    }),
  };
});

vi.mock('../join-gate-runtime.js', () => ({
  mapJoinGateError: (error: unknown) => (error instanceof Error ? error.message : 'join-gate error'),
  runJoinGateInstall: vi.fn(async () => undefined),
  runJoinGateStatus: vi.fn(async () => undefined),
  runJoinGateSync: vi.fn(async () => undefined),
}));

import { JoinGateAccessService, resetEnvForTests, TenantRepository } from '@voodoo/core';

import { buildJoinGateAuthorizedUsersMessage, joinGateCommand } from './join-gate.js';

const ORIGINAL_SUPER_ADMIN_DISCORD_IDS = process.env.SUPER_ADMIN_DISCORD_IDS;

type InteractionMocks = {
  interaction: ChatInputCommandInteraction;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
};

function createOkResult<T>(value: T): { isErr: () => false; isOk: () => true; value: T } {
  return {
    isErr: () => false,
    isOk: () => true,
    value,
  };
}

function createInteractionMock(input?: {
  userId?: string;
  subcommand?:
    | 'setup'
    | 'disable'
    | 'status'
    | 'sync'
    | 'install'
    | 'panel'
    | 'panel-reset'
    | 'staff-add'
    | 'staff-remove'
    | 'staff-list'
    | 'authorized'
    | 'grant'
    | 'revoke';
  targetUserId?: string;
  channelIds?: {
    fallback?: string;
    ticketCategory?: string;
    currentLookup?: string;
    newLookup?: string;
  };
  roleId?: string;
  panelTitle?: string | null;
  panelMessage?: string | null;
}): InteractionMocks {
  const deferReply = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);

  const channelIds = {
    fallback: input?.channelIds?.fallback ?? 'channel-fallback',
    ticketCategory: input?.channelIds?.ticketCategory ?? 'channel-category',
    currentLookup: input?.channelIds?.currentLookup ?? 'channel-current',
    newLookup: input?.channelIds?.newLookup ?? 'channel-new',
  };

  const interaction = {
    deferred: false,
    deferReply,
    editReply,
    guild: { id: 'guild-1' },
    inGuild: vi.fn().mockReturnValue(true),
    memberPermissions: { has: vi.fn().mockReturnValue(true) },
    options: {
      data: [
        {
          name: input?.subcommand ?? 'status',
          type: ApplicationCommandOptionType.Subcommand,
          options:
            input?.subcommand === 'setup'
              ? [
                  { name: 'fallback_channel', value: channelIds.fallback },
                  { name: 'verified_role', value: input?.roleId ?? 'role-verified' },
                  { name: 'ticket_category', value: channelIds.ticketCategory },
                  { name: 'current_lookup_channel', value: channelIds.currentLookup },
                  { name: 'new_lookup_channel', value: channelIds.newLookup },
                ]
              : input?.subcommand === 'panel'
                ? [
                    ...(input?.panelTitle ? [{ name: 'title', value: input.panelTitle }] : []),
                    ...(input?.panelMessage ? [{ name: 'message', value: input.panelMessage }] : []),
                  ]
                : input?.subcommand === 'staff-add' || input?.subcommand === 'staff-remove'
                  ? [{ name: 'role', value: input?.roleId ?? 'role-staff' }]
              : input?.subcommand === 'grant' || input?.subcommand === 'revoke'
                ? [{ name: 'user', value: input?.targetUserId ?? 'user-2' }]
                : [],
        },
      ],
      getSubcommand: vi.fn().mockReturnValue(input?.subcommand ?? 'status'),
      getString: vi.fn((name: string) => {
        if (name === 'title') {
          return input?.panelTitle ?? null;
        }
        if (name === 'message') {
          return input?.panelMessage ?? null;
        }

        return null;
      }),
      getUser: vi.fn().mockReturnValue({ id: input?.targetUserId ?? 'user-2' }),
      getChannel: vi.fn((name: string) => {
        if (name === 'fallback_channel') {
          return { id: channelIds.fallback };
        }
        if (name === 'ticket_category') {
          return { id: channelIds.ticketCategory };
        }
        if (name === 'current_lookup_channel') {
          return { id: channelIds.currentLookup };
        }
        if (name === 'new_lookup_channel') {
          return { id: channelIds.newLookup };
        }

        return null;
      }),
      getRole: vi.fn().mockReturnValue({ id: input?.roleId ?? 'role-verified' }),
    },
    reply,
    user: { id: input?.userId ?? 'user-1' },
  } as unknown as ChatInputCommandInteraction;

  return {
    interaction,
    deferReply,
    editReply,
    reply,
  };
}

describe('join-gate command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();

    if (ORIGINAL_SUPER_ADMIN_DISCORD_IDS == null) {
      delete process.env.SUPER_ADMIN_DISCORD_IDS;
    } else {
      process.env.SUPER_ADMIN_DISCORD_IDS = ORIGINAL_SUPER_ADMIN_DISCORD_IDS;
    }
  });

  it('formats the authorized join-gate user list for super admins', () => {
    expect(
      buildJoinGateAuthorizedUsersMessage([
        {
          authorizationId: 'auth-1',
          discordUserId: '123',
          grantedByDiscordUserId: '999',
          createdAt: '2026-03-19T12:00:00.000Z',
          updatedAt: '2026-03-19T12:00:00.000Z',
        },
      ]),
    ).toContain('Authorized `/join-gate` users for this server:');
  });

  it('blocks non-super-admin users from granting /join-gate access', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);

    const { interaction, deferReply, editReply } = createInteractionMock({
      userId: 'user-2',
      subcommand: 'grant',
      targetUserId: 'user-3',
    });

    await joinGateCommand.execute(interaction);

    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(editReply).toHaveBeenCalledWith({
      content: 'Only the configured super admin Discord ID can manage `/join-gate` access.',
    });
  });

  it('blocks regular /join-gate usage when the guild access list is locked and the caller is not authorized', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(JoinGateAccessService.prototype, 'getCommandAccessState').mockResolvedValue(
      createOkResult({
        locked: true,
        allowed: false,
        activated: false,
        authorizedUserCount: 0,
      }) as Awaited<ReturnType<JoinGateAccessService['getCommandAccessState']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'user-2',
      subcommand: 'status',
    });

    await joinGateCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content:
        'This join-gate worker is locked for this server. A super admin must activate this server by granting your Discord ID access before you can use `/join-gate` commands.',
    });
  });

  it('lets a configured super admin grant /join-gate access', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(JoinGateAccessService.prototype, 'grantUserAccess').mockResolvedValue(
      createOkResult({
        authorizationId: 'auth-1',
        discordUserId: 'user-3',
        created: true,
      }) as Awaited<ReturnType<JoinGateAccessService['grantUserAccess']>>,
    );

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'grant',
      targetUserId: 'user-3',
    });

    await joinGateCommand.execute(interaction);

    expect(editReply).toHaveBeenCalledWith({
      content: 'Granted `/join-gate` access for <@user-3> in this server.',
    });
  });

  it('saves join-gate setup entirely through slash-command options', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(TenantRepository.prototype, 'getGuildConfig').mockResolvedValue(null);
    const upsertSpy = vi
      .spyOn(TenantRepository.prototype, 'upsertGuildConfig')
      .mockResolvedValue({
        id: 'cfg-1',
        tenantId: 'tenant-1',
        guildId: 'guild-1',
        paidLogChannelId: null,
        staffRoleIds: [],
        defaultCurrency: 'GBP',
        tipEnabled: false,
        pointsEarnCategoryKeys: [],
        pointsRedeemCategoryKeys: [],
        pointValueMinor: 1,
        referralRewardMinor: 0,
        referralRewardCategoryKeys: [],
        referralLogChannelId: null,
        referralThankYouTemplate:
          'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.',
        referralSubmissionTemplate:
          'Referral submitted successfully. We will reward points automatically after the first paid order.',
        ticketMetadataKey: 'isTicket',
        joinGateEnabled: true,
        joinGateFallbackChannelId: 'channel-fallback',
        joinGateVerifiedRoleId: 'role-verified',
        joinGateTicketCategoryId: 'channel-category',
        joinGateCurrentLookupChannelId: 'channel-current',
        joinGateNewLookupChannelId: 'channel-new',
      } as Awaited<ReturnType<TenantRepository['upsertGuildConfig']>>);

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'setup',
    });

    await joinGateCommand.execute(interaction);

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        guildId: 'guild-1',
        joinGateEnabled: true,
        joinGateFallbackChannelId: 'channel-fallback',
        joinGateVerifiedRoleId: 'role-verified',
        joinGateTicketCategoryId: 'channel-category',
        joinGateCurrentLookupChannelId: 'channel-current',
        joinGateNewLookupChannelId: 'channel-new',
      }),
    );
    expect(editReply).toHaveBeenCalledWith({
      content: [
        'Join gate configuration saved for this server.',
        'Fallback verify channel: <#channel-fallback>',
        'Verified role: <@&role-verified>',
        'Ticket category: <#channel-category>',
        'Current-customer lookup: <#channel-current>',
        'New-customer lookup: <#channel-new>',
        'Next steps: run `/join-gate sync`, then `/join-gate install`, then `/join-gate status`.',
      ].join('\n'),
    });
  });

  it('disables join-gate through slash commands without the web dashboard', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(TenantRepository.prototype, 'getGuildConfig').mockResolvedValue({
      id: 'cfg-1',
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      paidLogChannelId: null,
      staffRoleIds: [],
      defaultCurrency: 'GBP',
      tipEnabled: false,
      pointsEarnCategoryKeys: [],
      pointsRedeemCategoryKeys: [],
      pointValueMinor: 1,
      referralRewardMinor: 0,
      referralRewardCategoryKeys: [],
      referralLogChannelId: null,
      referralThankYouTemplate:
        'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.',
      referralSubmissionTemplate:
        'Referral submitted successfully. We will reward points automatically after the first paid order.',
      ticketMetadataKey: 'isTicket',
      joinGateEnabled: true,
      joinGateFallbackChannelId: 'channel-fallback',
      joinGateVerifiedRoleId: 'role-verified',
      joinGateTicketCategoryId: 'channel-category',
      joinGateCurrentLookupChannelId: 'channel-current',
      joinGateNewLookupChannelId: 'channel-new',
    } as Awaited<ReturnType<TenantRepository['getGuildConfig']>>);
    const upsertSpy = vi
      .spyOn(TenantRepository.prototype, 'upsertGuildConfig')
      .mockResolvedValue({
        id: 'cfg-1',
        tenantId: 'tenant-1',
        guildId: 'guild-1',
        paidLogChannelId: null,
        staffRoleIds: [],
        defaultCurrency: 'GBP',
        tipEnabled: false,
        pointsEarnCategoryKeys: [],
        pointsRedeemCategoryKeys: [],
        pointValueMinor: 1,
        referralRewardMinor: 0,
        referralRewardCategoryKeys: [],
        referralLogChannelId: null,
        referralThankYouTemplate:
          'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.',
        referralSubmissionTemplate:
          'Referral submitted successfully. We will reward points automatically after the first paid order.',
        ticketMetadataKey: 'isTicket',
        joinGateEnabled: false,
        joinGateFallbackChannelId: null,
        joinGateVerifiedRoleId: null,
        joinGateTicketCategoryId: null,
        joinGateCurrentLookupChannelId: null,
        joinGateNewLookupChannelId: null,
      } as Awaited<ReturnType<TenantRepository['upsertGuildConfig']>>);

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'disable',
    });

    await joinGateCommand.execute(interaction);

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        joinGateEnabled: false,
        joinGateFallbackChannelId: null,
        joinGateVerifiedRoleId: null,
        joinGateTicketCategoryId: null,
        joinGateCurrentLookupChannelId: null,
        joinGateNewLookupChannelId: null,
      }),
    );
    expect(editReply).toHaveBeenCalledWith({
      content: 'Join gate is disabled for this server. Its Discord-side configuration has been cleared.',
    });
  });

  it('saves a custom fallback panel title and welcome message through slash commands', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(TenantRepository.prototype, 'getGuildConfig').mockResolvedValue({
      id: 'cfg-1',
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      paidLogChannelId: null,
      staffRoleIds: ['shared-staff'],
      defaultCurrency: 'GBP',
      tipEnabled: false,
      pointsEarnCategoryKeys: [],
      pointsRedeemCategoryKeys: [],
      pointValueMinor: 1,
      referralRewardMinor: 0,
      referralRewardCategoryKeys: [],
      referralLogChannelId: null,
      referralThankYouTemplate:
        'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.',
      referralSubmissionTemplate:
        'Referral submitted successfully. We will reward points automatically after the first paid order.',
      ticketMetadataKey: 'isTicket',
      joinGateEnabled: true,
      joinGateStaffRoleIds: ['role-staff'],
      joinGateFallbackChannelId: 'channel-fallback',
      joinGateVerifiedRoleId: 'role-verified',
      joinGateTicketCategoryId: 'channel-category',
      joinGateCurrentLookupChannelId: 'channel-current',
      joinGateNewLookupChannelId: 'channel-new',
      joinGatePanelTitle: null,
      joinGatePanelMessage: null,
    } as Awaited<ReturnType<TenantRepository['getGuildConfig']>>);
    const upsertSpy = vi.spyOn(TenantRepository.prototype, 'upsertGuildConfig').mockResolvedValue({
      id: 'cfg-1',
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      paidLogChannelId: null,
      staffRoleIds: ['shared-staff'],
      defaultCurrency: 'GBP',
      tipEnabled: false,
      pointsEarnCategoryKeys: [],
      pointsRedeemCategoryKeys: [],
      pointValueMinor: 1,
      referralRewardMinor: 0,
      referralRewardCategoryKeys: [],
      referralLogChannelId: null,
      referralThankYouTemplate:
        'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.',
      referralSubmissionTemplate:
        'Referral submitted successfully. We will reward points automatically after the first paid order.',
      ticketMetadataKey: 'isTicket',
      joinGateEnabled: true,
      joinGateStaffRoleIds: ['role-staff'],
      joinGateFallbackChannelId: 'channel-fallback',
      joinGateVerifiedRoleId: 'role-verified',
      joinGateTicketCategoryId: 'channel-category',
      joinGateCurrentLookupChannelId: 'channel-current',
      joinGateNewLookupChannelId: 'channel-new',
      joinGatePanelTitle: 'Welcome to Voodoo',
      joinGatePanelMessage: 'Please verify before chatting with the team.',
    } as Awaited<ReturnType<TenantRepository['upsertGuildConfig']>>);

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'panel',
      panelTitle: 'Welcome to Voodoo',
      panelMessage: 'Please verify before chatting with the team.',
    });

    await joinGateCommand.execute(interaction);

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        staffRoleIds: ['shared-staff'],
        joinGatePanelTitle: 'Welcome to Voodoo',
        joinGatePanelMessage: 'Please verify before chatting with the team.',
      }),
    );
    expect(editReply).toHaveBeenCalledWith({
      content: [
        'Fallback verify panel text saved.',
        'Title: "Welcome to Voodoo"',
        'Message: "Please verify before chatting with the team."',
        'Run `/join-gate install` to post or refresh the fallback panel with the updated embed.',
      ].join('\n'),
    });
  });

  it('adds a join-gate staff role without changing the shared staff role list', async () => {
    process.env.SUPER_ADMIN_DISCORD_IDS = 'owner-1';
    resetEnvForTests();

    vi.spyOn(TenantRepository.prototype, 'getTenantByGuildId').mockResolvedValue({
      tenantId: 'tenant-1',
    } as Awaited<ReturnType<TenantRepository['getTenantByGuildId']>>);
    vi.spyOn(TenantRepository.prototype, 'getGuildConfig').mockResolvedValue({
      id: 'cfg-1',
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      paidLogChannelId: null,
      staffRoleIds: ['shared-staff'],
      defaultCurrency: 'GBP',
      tipEnabled: false,
      pointsEarnCategoryKeys: [],
      pointsRedeemCategoryKeys: [],
      pointValueMinor: 1,
      referralRewardMinor: 0,
      referralRewardCategoryKeys: [],
      referralLogChannelId: null,
      referralThankYouTemplate:
        'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.',
      referralSubmissionTemplate:
        'Referral submitted successfully. We will reward points automatically after the first paid order.',
      ticketMetadataKey: 'isTicket',
      joinGateEnabled: true,
      joinGateStaffRoleIds: ['role-staff-old'],
      joinGateFallbackChannelId: 'channel-fallback',
      joinGateVerifiedRoleId: 'role-verified',
      joinGateTicketCategoryId: 'channel-category',
      joinGateCurrentLookupChannelId: 'channel-current',
      joinGateNewLookupChannelId: 'channel-new',
      joinGatePanelTitle: null,
      joinGatePanelMessage: null,
    } as Awaited<ReturnType<TenantRepository['getGuildConfig']>>);
    const upsertSpy = vi.spyOn(TenantRepository.prototype, 'upsertGuildConfig').mockResolvedValue({
      id: 'cfg-1',
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      paidLogChannelId: null,
      staffRoleIds: ['shared-staff'],
      defaultCurrency: 'GBP',
      tipEnabled: false,
      pointsEarnCategoryKeys: [],
      pointsRedeemCategoryKeys: [],
      pointValueMinor: 1,
      referralRewardMinor: 0,
      referralRewardCategoryKeys: [],
      referralLogChannelId: null,
      referralThankYouTemplate:
        'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.',
      referralSubmissionTemplate:
        'Referral submitted successfully. We will reward points automatically after the first paid order.',
      ticketMetadataKey: 'isTicket',
      joinGateEnabled: true,
      joinGateStaffRoleIds: ['role-staff-old', 'role-staff-new'],
      joinGateFallbackChannelId: 'channel-fallback',
      joinGateVerifiedRoleId: 'role-verified',
      joinGateTicketCategoryId: 'channel-category',
      joinGateCurrentLookupChannelId: 'channel-current',
      joinGateNewLookupChannelId: 'channel-new',
      joinGatePanelTitle: null,
      joinGatePanelMessage: null,
    } as Awaited<ReturnType<TenantRepository['upsertGuildConfig']>>);

    const { interaction, editReply } = createInteractionMock({
      userId: 'owner-1',
      subcommand: 'staff-add',
      roleId: 'role-staff-new',
    });

    await joinGateCommand.execute(interaction);

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        staffRoleIds: ['shared-staff'],
        joinGateStaffRoleIds: ['role-staff-old', 'role-staff-new'],
      }),
    );
    expect(editReply).toHaveBeenCalledWith({
      content: [
        'Added <@&role-staff-new> to join-gate staff ticket access.',
        'Join-gate staff roles:',
        '<@&role-staff-old>',
        '<@&role-staff-new>',
      ].join('\n'),
    });
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateCustomQa = vi.hoisted(() => vi.fn());
const deleteCustomQa = vi.hoisted(() => vi.fn());
const requireAiGuildAccess = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AiKnowledgeManagementService: class {
      public updateCustomQa = updateCustomQa;
      public deleteCustomQa = deleteCustomQa;
    },
  };
});

vi.mock('@/lib/ai-guild-access', () => ({
  requireAiGuildAccess,
}));

import { DELETE, PATCH } from './route';

describe('ai custom q&a item route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAiGuildAccess.mockResolvedValue({
      ok: true,
      value: {
        session: {
          discordUserId: 'discord-user-2',
        },
      },
    });
    updateCustomQa.mockResolvedValue({
      isErr: () => false,
      value: {
        customQaId: 'qa-1',
        question: 'What refund window do you offer?',
        answer: 'Refunds are accepted within 14 days of purchase.',
      },
    });
    deleteCustomQa.mockResolvedValue({
      isErr: () => false,
      value: {
        deleted: true,
      },
    });
  });

  it('updates an existing custom q&a entry', async () => {
    const response = await PATCH(
      new NextRequest('https://ai.example.com/api/guilds/guild-1/custom-qas/qa-1', {
        method: 'PATCH',
        body: JSON.stringify({
          question: 'What refund window do you offer?',
          answer: 'Refunds are accepted within 14 days of purchase.',
        }),
      }),
      {
        params: Promise.resolve({ guildId: 'guild-1', customQaId: 'qa-1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateCustomQa).toHaveBeenCalledWith({
      guildId: 'guild-1',
      customQaId: 'qa-1',
      question: 'What refund window do you offer?',
      answer: 'Refunds are accepted within 14 days of purchase.',
      actorDiscordUserId: 'discord-user-2',
    });
  });

  it('deletes an existing custom q&a entry', async () => {
    const response = await DELETE(
      new NextRequest('https://ai.example.com/api/guilds/guild-1/custom-qas/qa-1', {
        method: 'DELETE',
      }),
      {
        params: Promise.resolve({ guildId: 'guild-1', customQaId: 'qa-1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(deleteCustomQa).toHaveBeenCalledWith({
      guildId: 'guild-1',
      customQaId: 'qa-1',
    });
  });
});

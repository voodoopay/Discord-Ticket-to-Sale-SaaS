import { describe, expect, it } from 'vitest';

import {
  clearSaleDraftsForChat,
  createSaleDraft,
  listSaleDraftsForControlChat,
  updateSaleDraft,
} from './sale-draft-store.js';

describe('telegram sale draft store', () => {
  it('tracks DM control chats separately from the group status chat', () => {
    const draft = createSaleDraft({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      ticketChannelId: 'tg:-100123',
      customerLabel: '@customer',
      staffDiscordUserId: 'tg:111',
      customerDiscordUserId: 'tg:222',
      defaultCurrency: 'GBP',
      tipEnabled: true,
    });

    draft.controlChatId = 'tg:222';
    draft.controlMessageId = 55;
    updateSaleDraft(draft);

    expect(listSaleDraftsForControlChat('tg:222')).toHaveLength(1);

    clearSaleDraftsForChat('tg:-100123');
    expect(listSaleDraftsForControlChat('tg:222')).toHaveLength(0);
  });
});

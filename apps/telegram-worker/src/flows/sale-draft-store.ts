import crypto from 'node:crypto';

export type SaleDraftVariantOption = {
  variantId: string;
  label: string;
  priceMinor: number;
  currency: string;
};

export type SaleDraftBasketItem = {
  productId: string;
  productName: string;
  category: string;
  variantId: string;
  variantLabel: string;
  priceMinor: number;
  currency: string;
};

export type SaleDraftFormField = {
  fieldKey: string;
  label: string;
  required: boolean;
  fieldType: 'short_text' | 'long_text' | 'email' | 'number';
  validation: Record<string, unknown> | null;
};

export type SaleDraftPendingInput =
  | { type: 'coupon' }
  | { type: 'tip' }
  | { type: 'answer'; fieldIndex: number }
  | null;

export type SaleDraft = {
  id: string;
  tenantId: string;
  guildId: string;
  ticketChannelId: string;
  controlMessageId: number;
  customerLabel: string;
  staffDiscordUserId: string;
  customerDiscordUserId: string;
  category: string | null;
  categoryOptions: string[];
  productName: string | null;
  productId: string | null;
  variantId: string | null;
  variantOptions: SaleDraftVariantOption[];
  basketItems: SaleDraftBasketItem[];
  couponCode: string | null;
  couponDiscountMinor: number;
  tipMinor: number;
  tipEnabled: boolean;
  defaultCurrency: string;
  formFields: SaleDraftFormField[];
  answers: Record<string, string>;
  customerEmailNormalized: string | null;
  pointsPromptShown: boolean;
  usePoints: boolean;
  pointsAvailable: number;
  pointsMaxRedeemableByAmount: number;
  pointsReservedIfUsed: number;
  pointsDiscountMinorIfUsed: number;
  pointValueMinor: number;
  pendingInput: SaleDraftPendingInput;
  expiresAt: number;
};

const draftStore = new Map<string, SaleDraft>();

export const SALE_DRAFT_TTL_MS = 60 * 60 * 1000;

function createDraftId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function refreshDraftExpiry(draft: SaleDraft): SaleDraft {
  return {
    ...draft,
    expiresAt: Date.now() + SALE_DRAFT_TTL_MS,
  };
}

export function createSaleDraft(input: {
  tenantId: string;
  guildId: string;
  ticketChannelId: string;
  controlMessageId: number;
  customerLabel: string;
  staffDiscordUserId: string;
  customerDiscordUserId: string;
  tipEnabled?: boolean;
  defaultCurrency?: string;
}): SaleDraft {
  const draft: SaleDraft = {
    id: createDraftId(),
    tenantId: input.tenantId,
    guildId: input.guildId,
    ticketChannelId: input.ticketChannelId,
    controlMessageId: input.controlMessageId,
    customerLabel: input.customerLabel,
    staffDiscordUserId: input.staffDiscordUserId,
    customerDiscordUserId: input.customerDiscordUserId,
    category: null,
    categoryOptions: [],
    productName: null,
    productId: null,
    variantId: null,
    variantOptions: [],
    basketItems: [],
    couponCode: null,
    couponDiscountMinor: 0,
    tipMinor: 0,
    tipEnabled: input.tipEnabled ?? false,
    defaultCurrency: input.defaultCurrency ?? 'GBP',
    formFields: [],
    answers: {},
    customerEmailNormalized: null,
    pointsPromptShown: false,
    usePoints: false,
    pointsAvailable: 0,
    pointsMaxRedeemableByAmount: 0,
    pointsReservedIfUsed: 0,
    pointsDiscountMinorIfUsed: 0,
    pointValueMinor: 1,
    pendingInput: null,
    expiresAt: Date.now() + SALE_DRAFT_TTL_MS,
  };

  draftStore.set(draft.id, draft);
  return draft;
}

export function clearSaleDraftsForChat(ticketChannelId: string): void {
  for (const [draftId, draft] of draftStore.entries()) {
    if (draft.ticketChannelId === ticketChannelId) {
      draftStore.delete(draftId);
    }
  }
}

export function getSaleDraft(draftId: string): SaleDraft | null {
  const draft = draftStore.get(draftId);
  if (!draft) {
    return null;
  }

  if (draft.expiresAt < Date.now()) {
    draftStore.delete(draftId);
    return null;
  }

  const refreshedDraft = refreshDraftExpiry(draft);
  draftStore.set(draftId, refreshedDraft);
  return refreshedDraft;
}

export function listSaleDraftsForChat(ticketChannelId: string): SaleDraft[] {
  const drafts: SaleDraft[] = [];

  for (const [draftId, draft] of draftStore.entries()) {
    if (draft.expiresAt < Date.now()) {
      draftStore.delete(draftId);
      continue;
    }

    if (draft.ticketChannelId === ticketChannelId) {
      drafts.push(refreshDraftExpiry(draft));
    }
  }

  for (const draft of drafts) {
    draftStore.set(draft.id, draft);
  }

  return drafts;
}

export function updateSaleDraft(draft: SaleDraft): void {
  draftStore.set(draft.id, refreshDraftExpiry(draft));
}

export function removeSaleDraft(draftId: string): void {
  draftStore.delete(draftId);
}

import {
  computeCouponEligibleSubtotalMinor,
  CouponRepository,
  ProductRepository,
  SaleService,
  getEnv,
  type SaleCheckoutOption,
  toTelegramScopedId,
} from '@voodoo/core';
import { type Api, type Context, InlineKeyboard } from 'grammy';

import {
  clearSaleDraftsForChat,
  createSaleDraft,
  getSaleDraft,
  listSaleDraftsForControlChat,
  removeSaleDraft,
  updateSaleDraft,
  type SaleDraft,
  type SaleDraftFormField,
} from '../flows/sale-draft-store.js';
import {
  buildTelegramBotDeepLink,
  buildTelegramCheckoutRedirectUrl,
  parseTelegramSaleStartPayload,
} from '../lib/sale-links.js';
import {
  formatTelegramUserLabel,
  getLinkedStoreForChat,
  isTelegramChatAdmin,
  isTelegramGroupChat,
} from '../lib/telegram.js';

const env = getEnv();
const productRepository = new ProductRepository();
const couponRepository = new CouponRepository();
const saleService = new SaleService();
const displayLabelCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function canInteractWithDraft(draft: SaleDraft, userId: string): boolean {
  return draft.customerDiscordUserId === userId;
}

function normalizeCategoryLabel(category: string): string {
  return category.trim() || 'Uncategorized';
}

function isTelegramPrivateChat(chatType: string | undefined): boolean {
  return chatType === 'private';
}

function compareVariantForDisplay(
  left: { label: string; priceMinor: number; variantId: string },
  right: { label: string; priceMinor: number; variantId: string },
): number {
  const labelCompare = displayLabelCollator.compare(left.label, right.label);
  if (labelCompare !== 0) return labelCompare;
  if (left.priceMinor !== right.priceMinor) return left.priceMinor - right.priceMinor;
  return left.variantId.localeCompare(right.variantId);
}

function compareProductNameForDisplay(
  left: { name: string; productId: string },
  right: { name: string; productId: string },
): number {
  const nameCompare = displayLabelCollator.compare(left.name, right.name);
  return nameCompare !== 0 ? nameCompare : left.productId.localeCompare(right.productId);
}

function getControlChatId(draft: SaleDraft): string {
  if (!draft.controlChatId) {
    throw new Error('Sale draft is not linked to a Telegram DM yet.');
  }

  return draft.controlChatId.slice(3);
}

async function editDraftMessage(input: {
  api: Api;
  draft: SaleDraft;
  content: string;
  keyboard?: InlineKeyboard;
}): Promise<void> {
  if (input.draft.controlMessageId == null) {
    throw new Error('Sale draft does not have an active Telegram DM control message.');
  }

  try {
    await input.api.editMessageText(getControlChatId(input.draft), input.draft.controlMessageId, input.content, {
      ...(input.keyboard ? { reply_markup: input.keyboard } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('message is not modified')) return;
    throw error;
  }
}

function buildKeyboard(buttons: Array<{ label: string; data?: string; url?: string }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  buttons.forEach((button, index) => {
    if (button.url) keyboard.url(button.label, button.url);
    else if (button.data) keyboard.text(button.label, button.data);
    if (index < buttons.length - 1) keyboard.row();
  });
  return keyboard;
}

function formatMinorCurrency(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function getBasketSubtotalMinor(draft: SaleDraft): number {
  return draft.basketItems.reduce((sum, item) => sum + item.priceMinor, 0);
}

function getCouponDiscountMinor(draft: SaleDraft): number {
  return Math.min(getBasketSubtotalMinor(draft), Math.max(0, draft.couponDiscountMinor));
}

function getBasketTotalMinor(draft: SaleDraft): number {
  return Math.max(0, getBasketSubtotalMinor(draft) - getCouponDiscountMinor(draft) + draft.tipMinor);
}

function resetPointsSelection(draft: SaleDraft): void {
  draft.customerEmailNormalized = null;
  draft.pointsPromptShown = false;
  draft.usePoints = false;
  draft.pointsAvailable = 0;
  draft.pointsMaxRedeemableByAmount = 0;
  draft.pointsReservedIfUsed = 0;
  draft.pointsDiscountMinorIfUsed = 0;
  draft.pointValueMinor = 1;
}

function buildBasketSummaryLines(draft: SaleDraft): string[] {
  if (draft.basketItems.length === 0) return ['Basket: (empty)'];
  const lines = draft.basketItems.map(
    (item, index) =>
      `${index + 1}. ${item.category} / ${item.productName} / ${item.variantLabel} - ${formatMinorCurrency(item.priceMinor, item.currency)}`,
  );
  const currency = draft.basketItems[0]?.currency ?? draft.defaultCurrency;
  lines.push(`Subtotal: ${formatMinorCurrency(getBasketSubtotalMinor(draft), currency)}`);
  if (draft.couponCode) {
    const couponDiscountMinor = getCouponDiscountMinor(draft);
    lines.push(
      couponDiscountMinor > 0
        ? `Coupon (${draft.couponCode}): -${formatMinorCurrency(couponDiscountMinor, currency)}`
        : `Coupon (${draft.couponCode}): 0.00 ${currency}`,
    );
  }
  if (draft.tipMinor > 0) lines.push(`Tip: +${formatMinorCurrency(draft.tipMinor, currency)}`);
  lines.push(`Total Due: ${formatMinorCurrency(getBasketTotalMinor(draft), currency)}`);
  return lines;
}

function parseTipToMinor(rawValue: string): number {
  const value = rawValue.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Tip must be a valid amount, for example 2.50');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Tip must be greater than zero.');
  return Math.round(amount * 100);
}

function mergeFormFields(existing: SaleDraftFormField[], incoming: SaleDraftFormField[]): SaleDraftFormField[] {
  const merged = [...existing];
  const existingKeys = new Set(existing.map((field) => field.fieldKey.toLowerCase()));
  for (const field of incoming) {
    const key = field.fieldKey.toLowerCase();
    if (existingKeys.has(key)) continue;
    merged.push(field);
    existingKeys.add(key);
  }
  return merged;
}

async function rebuildFormFieldsFromBasket(draft: SaleDraft): Promise<SaleDraftFormField[]> {
  const uniqueProductIds = Array.from(new Set(draft.basketItems.map((item) => item.productId)));
  let merged: SaleDraftFormField[] = [];
  for (const productId of uniqueProductIds) {
    const product = await productRepository.getById({ tenantId: draft.tenantId, guildId: draft.guildId, productId });
    if (!product) continue;
    merged = mergeFormFields(
      merged,
      product.formFields.map((field) => ({
        fieldKey: field.fieldKey,
        label: field.label,
        required: field.required,
        fieldType: field.fieldType,
        validation: field.validation,
      })),
    );
  }
  return merged;
}

async function sendCheckoutMessage(input: {
  api: Api;
  draft: SaleDraft;
  checkoutOptions?: SaleCheckoutOption[];
  orderSessionId: string;
}): Promise<void> {
  const options =
    input.checkoutOptions && input.checkoutOptions.length > 0
      ? input.checkoutOptions
      : [{ method: 'pay' as const, label: 'Pay', url: buildTelegramCheckoutRedirectUrl({
        botPublicUrl: env.BOT_PUBLIC_URL,
        orderSessionId: input.orderSessionId,
        method: 'pay',
      }) }];
  const redirectOptions = options.map((option) => ({
    label: option.label,
    url: buildTelegramCheckoutRedirectUrl({
      botPublicUrl: env.BOT_PUBLIC_URL,
      orderSessionId: input.orderSessionId,
      method: option.method,
    }),
  }));
  await input.api.sendMessage(
    getControlChatId(input.draft),
    [
      `Sale created for ${input.draft.customerLabel}.`,
      `Order Session: ${input.orderSessionId}`,
      'Choose payment method below.',
      '',
      'Paid and fulfilled status updates will be posted in the linked Telegram group. This may take up to 30 minutes. Do NOT pay again.',
    ].join('\n'),
    {
      reply_markup: buildKeyboard(
        redirectOptions.map((option, index) => ({
          label:
            redirectOptions.length === 1 && index === 0
              ? 'Click Here To Pay'
              : option.label,
          url: option.url,
        })),
      ),
    },
  );
}

async function finalizeDraft(input: { api: Api; draft: SaleDraft }): Promise<void> {
  const primaryItem = input.draft.basketItems[0];
  if (!primaryItem) {
    await editDraftMessage({ api: input.api, draft: input.draft, content: 'Basket is empty. Start /sale again.' });
    return;
  }

  const created = await saleService.createSaleSessionFromBot({
    tenantId: input.draft.tenantId,
    guildId: input.draft.guildId,
    ticketChannelId: input.draft.ticketChannelId,
    staffDiscordUserId: input.draft.staffDiscordUserId,
    customerDiscordUserId: input.draft.customerDiscordUserId,
    productId: primaryItem.productId,
    variantId: primaryItem.variantId,
    items: input.draft.basketItems.map((item) => ({ productId: item.productId, variantId: item.variantId })),
    couponCode: input.draft.couponCode,
    tipMinor: input.draft.tipMinor,
    usePoints: input.draft.usePoints,
    answers: input.draft.answers,
  });

  if (created.isErr()) {
    await editDraftMessage({ api: input.api, draft: input.draft, content: created.error.message });
    return;
  }

  removeSaleDraft(input.draft.id);
  await sendCheckoutMessage({
    api: input.api,
    draft: input.draft,
    checkoutOptions: created.value.checkoutOptions,
    orderSessionId: created.value.orderSessionId,
  });
  await editDraftMessage({
    api: input.api,
    draft: input.draft,
    content: [
      `Checkout link generated. Order session: ${created.value.orderSessionId}`,
      ...created.value.warnings.map((warning) => `Warning: ${warning}`),
    ].join('\n'),
  });
}

async function maybePromptPointsBeforeFinalize(input: { api: Api; draft: SaleDraft }): Promise<void> {
  const preview = await saleService.previewPointsForDraft({
    tenantId: input.draft.tenantId,
    guildId: input.draft.guildId,
    basketItems: input.draft.basketItems.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      category: item.category,
      priceMinor: item.priceMinor,
    })),
    couponCode: input.draft.couponCode,
    tipMinor: input.draft.tipMinor,
    answers: input.draft.answers,
  });
  if (preview.isErr()) {
    await editDraftMessage({ api: input.api, draft: input.draft, content: preview.error.message });
    return;
  }

  const points = preview.value;
  if (!points.canRedeem || points.availablePoints <= 0 || points.pointsReservedIfUsed <= 0 || points.pointsDiscountMinorIfUsed <= 0) {
    resetPointsSelection(input.draft);
    input.draft.customerEmailNormalized = points.emailNormalized;
    input.draft.pointValueMinor = points.pointValueMinor;
    input.draft.pointsAvailable = points.availablePoints;
    updateSaleDraft(input.draft);
    await editDraftMessage({ api: input.api, draft: input.draft, content: 'Creating checkout link...' });
    await finalizeDraft(input);
    return;
  }

  const currency = input.draft.basketItems[0]?.currency ?? input.draft.defaultCurrency;
  input.draft.customerEmailNormalized = points.emailNormalized;
  input.draft.pointsPromptShown = true;
  input.draft.usePoints = false;
  input.draft.pointsAvailable = points.availablePoints;
  input.draft.pointsMaxRedeemableByAmount = points.maxRedeemablePointsByAmount;
  input.draft.pointsReservedIfUsed = points.pointsReservedIfUsed;
  input.draft.pointsDiscountMinorIfUsed = points.pointsDiscountMinorIfUsed;
  input.draft.pointValueMinor = points.pointValueMinor;
  input.draft.pendingInput = null;
  updateSaleDraft(input.draft);

  await editDraftMessage({
    api: input.api,
    draft: input.draft,
    content: [
      'Step 8/8: Use Points?',
      ...buildBasketSummaryLines(input.draft),
      `Available points: ${points.availablePoints}`,
      `Point value: 1 point = ${formatMinorCurrency(points.pointValueMinor, currency)}`,
      `Redeemable now: ${points.pointsReservedIfUsed} point(s)`,
      `Discount if used: -${formatMinorCurrency(points.pointsDiscountMinorIfUsed, currency)}`,
      'Would the customer like to apply points to this checkout?',
    ].join('\n'),
    keyboard: buildKeyboard([
      { label: 'Use Points', data: `sale:act:${input.draft.id}:pu` },
      { label: 'Continue Without Points', data: `sale:act:${input.draft.id}:ps` },
    ]),
  });
}

async function renderCategorySelectionStep(api: Api, draft: SaleDraft): Promise<void> {
  const optionsResult = await saleService.getSaleOptions({ tenantId: draft.tenantId, guildId: draft.guildId });
  if (optionsResult.isErr()) {
    await editDraftMessage({ api, draft, content: optionsResult.error.message });
    return;
  }

  const products = optionsResult.value.filter((product) => product.variants.length > 0);
  if (products.length === 0) {
    await editDraftMessage({ api, draft, content: 'No active products or variants are configured for this store yet.' });
    return;
  }

  const categoryCounts = new Map<string, { label: string; productCount: number }>();
  for (const product of products) {
    const label = normalizeCategoryLabel(product.category);
    const key = label.toLowerCase();
    const existing = categoryCounts.get(key);
    if (existing) existing.productCount += 1;
    else categoryCounts.set(key, { label, productCount: 1 });
  }

  draft.category = null;
  draft.categoryOptions = Array.from(categoryCounts.values())
    .sort((left, right) => displayLabelCollator.compare(left.label, right.label))
    .map((item) => item.label);
  draft.productName = null;
  draft.productId = null;
  draft.variantId = null;
  draft.variantOptions = [];
  draft.pendingInput = null;
  resetPointsSelection(draft);
  updateSaleDraft(draft);

  await editDraftMessage({
    api,
    draft,
    content: [`Step 1/7: Select category for ${draft.customerLabel}`, ...buildBasketSummaryLines(draft)].join('\n'),
    keyboard: buildKeyboard(draft.categoryOptions.map((category, index) => ({ label: category, data: `sale:cat:${draft.id}:${index}` }))),
  });
}

async function renderProductSelectionStep(api: Api, draft: SaleDraft): Promise<void> {
  if (!draft.category) {
    await editDraftMessage({ api, draft, content: 'Category not selected. Start /sale again.' });
    return;
  }

  const optionsResult = await saleService.getSaleOptions({ tenantId: draft.tenantId, guildId: draft.guildId });
  if (optionsResult.isErr()) {
    await editDraftMessage({ api, draft, content: optionsResult.error.message });
    return;
  }

  const products = optionsResult.value.filter(
    (product) =>
      product.variants.length > 0 &&
      normalizeCategoryLabel(product.category).toLowerCase() === draft.category?.toLowerCase(),
  );
  if (products.length === 0) {
    await editDraftMessage({ api, draft, content: `No products found for category "${draft.category}".` });
    return;
  }

  draft.productName = null;
  draft.productId = null;
  draft.variantId = null;
  draft.variantOptions = [];
  draft.pendingInput = null;
  updateSaleDraft(draft);

  await editDraftMessage({
    api,
    draft,
    content: [`Step 2/7: Select product`, ...buildBasketSummaryLines(draft)].join('\n'),
    keyboard: buildKeyboard(
      products.sort(compareProductNameForDisplay).map((product) => ({
        label: product.name,
        data: `sale:prd:${draft.id}:${product.productId}`,
      })),
    ),
  });
}

async function renderVariantSelectionStep(api: Api, draft: SaleDraft): Promise<void> {
  if (!draft.productId || !draft.productName || !draft.category) {
    await editDraftMessage({ api, draft, content: 'Product not selected. Start /sale again.' });
    return;
  }

  await editDraftMessage({
    api,
    draft,
    content: [`Step 3/7: Select price option`, `Category: ${draft.category}`, `Product: ${draft.productName}`, ...buildBasketSummaryLines(draft)].join('\n'),
    keyboard: buildKeyboard(
      draft.variantOptions.map((variant) => ({
        label: `${variant.label} (${formatMinorCurrency(variant.priceMinor, variant.currency)})`,
        data: `sale:var:${draft.id}:${variant.variantId}`,
      })),
    ),
  });
}

async function renderBasketDecisionStep(api: Api, draft: SaleDraft): Promise<void> {
  draft.pendingInput = null;
  updateSaleDraft(draft);
  await editDraftMessage({
    api,
    draft,
    content: ['Step 4/7: Basket Review', ...buildBasketSummaryLines(draft), 'Choose the next action.'].join('\n'),
    keyboard: buildKeyboard([
      { label: 'Add More', data: `sale:act:${draft.id}:add` },
      { label: 'Change Last', data: `sale:act:${draft.id}:chg` },
      { label: 'Continue Checkout', data: `sale:act:${draft.id}:co` },
    ]),
  });
}

async function renderCouponSelectionStep(api: Api, draft: SaleDraft): Promise<void> {
  draft.pendingInput = null;
  updateSaleDraft(draft);
  const buttons = draft.couponCode
    ? [
        { label: 'Replace Coupon', data: `sale:act:${draft.id}:cap` },
        { label: 'Continue', data: `sale:act:${draft.id}:ccn` },
      ]
    : [
        { label: 'Apply Coupon', data: `sale:act:${draft.id}:cap` },
        { label: 'No Coupon', data: `sale:act:${draft.id}:csk` },
      ];
  await editDraftMessage({
    api,
    draft,
    content: ['Step 5/7: Coupon (optional)', ...buildBasketSummaryLines(draft)].join('\n'),
    keyboard: buildKeyboard(buttons),
  });
}

async function renderAnswerCollectionStep(api: Api, draft: SaleDraft): Promise<void> {
  draft.pendingInput = null;
  updateSaleDraft(draft);
  if (draft.formFields.length === 0) {
    if (draft.tipEnabled) await renderTipDecisionStep(api, draft);
    else {
      await editDraftMessage({ api, draft, content: 'Checking points...' });
      await maybePromptPointsBeforeFinalize({ api, draft });
    }
    return;
  }
  const answeredCount = Object.keys(draft.answers).filter((key) => draft.answers[key]?.trim()).length;
  await editDraftMessage({
    api,
    draft,
    content: ['Step 6/7: Customer Details', ...buildBasketSummaryLines(draft), `Answered questions: ${answeredCount}/${draft.formFields.length}`].join('\n'),
    keyboard: buildKeyboard([{ label: 'Answer Questions', data: `sale:act:${draft.id}:ans` }]),
  });
}

async function renderTipDecisionStep(api: Api, draft: SaleDraft): Promise<void> {
  draft.pendingInput = null;
  updateSaleDraft(draft);
  await editDraftMessage({
    api,
    draft,
    content: ['Step 7/7: Tip (optional)', ...buildBasketSummaryLines(draft), 'Would the customer like to add a tip?'].join('\n'),
    keyboard: buildKeyboard([
      { label: 'Yes, Add Tip', data: `sale:act:${draft.id}:ty` },
      { label: 'No Tip, Continue', data: `sale:act:${draft.id}:ts` },
    ]),
  });
}

async function promptForCoupon(api: Api, draft: SaleDraft): Promise<void> {
  draft.pendingInput = { type: 'coupon' };
  updateSaleDraft(draft);
  await editDraftMessage({
    api,
    draft,
    content: ['Step 5/7: Coupon (optional)', ...buildBasketSummaryLines(draft), 'Send the coupon code as your next message.'].join('\n'),
  });
}

async function promptForAnswer(api: Api, draft: SaleDraft, fieldIndex: number): Promise<void> {
  const field = draft.formFields[fieldIndex];
  if (!field) {
    if (draft.tipEnabled) await renderTipDecisionStep(api, draft);
    else {
      await editDraftMessage({ api, draft, content: 'Checking points...' });
      await maybePromptPointsBeforeFinalize({ api, draft });
    }
    return;
  }

  draft.pendingInput = { type: 'answer', fieldIndex };
  updateSaleDraft(draft);
  await editDraftMessage({
    api,
    draft,
    content: [`Customer Details (${fieldIndex + 1}/${draft.formFields.length})`, ...buildBasketSummaryLines(draft), `Send the answer for: ${field.label}${field.required ? ' (required)' : ''}`].join('\n'),
  });
}

async function promptForTip(api: Api, draft: SaleDraft): Promise<void> {
  draft.pendingInput = { type: 'tip' };
  updateSaleDraft(draft);
  await editDraftMessage({
    api,
    draft,
    content: ['Step 7/7: Tip (optional)', ...buildBasketSummaryLines(draft), 'Send the tip amount as your next message, for example 2.50.'].join('\n'),
  });
}

async function handleCategorySelection(api: Api, draft: SaleDraft, categoryIndexRaw: string): Promise<void> {
  const categoryIndex = Number(categoryIndexRaw);
  const category = Number.isInteger(categoryIndex) ? draft.categoryOptions[categoryIndex] : null;
  if (!category) {
    await editDraftMessage({ api, draft, content: 'Invalid category selection. Start /sale again.' });
    return;
  }

  draft.category = category;
  draft.productName = null;
  draft.productId = null;
  draft.variantId = null;
  draft.variantOptions = [];
  draft.pendingInput = null;
  resetPointsSelection(draft);
  updateSaleDraft(draft);
  await renderProductSelectionStep(api, draft);
}

async function handleProductSelection(api: Api, draft: SaleDraft, selectedProductId: string): Promise<void> {
  const optionsResult = await saleService.getSaleOptions({ tenantId: draft.tenantId, guildId: draft.guildId });
  if (optionsResult.isErr()) {
    await editDraftMessage({ api, draft, content: optionsResult.error.message });
    return;
  }

  const selectedProduct = optionsResult.value.find((product) => product.productId === selectedProductId);
  if (!selectedProduct || selectedProduct.variants.length === 0) {
    await editDraftMessage({ api, draft, content: 'Product not found. Start /sale again.' });
    return;
  }

  draft.productName = selectedProduct.name;
  draft.productId = selectedProduct.productId;
  draft.variantId = null;
  draft.variantOptions = [...selectedProduct.variants].sort(compareVariantForDisplay).map((variant) => ({
    variantId: variant.variantId,
    label: variant.label,
    priceMinor: variant.priceMinor,
    currency: variant.currency,
  }));
  updateSaleDraft(draft);
  await renderVariantSelectionStep(api, draft);
}

async function handleVariantSelection(api: Api, draft: SaleDraft, selectedVariantId: string): Promise<void> {
  const variant = draft.variantOptions.find((item) => item.variantId === selectedVariantId);
  if (!variant || !draft.productId || !draft.productName || !draft.category) {
    await editDraftMessage({ api, draft, content: 'Price option not found. Start /sale again.' });
    return;
  }

  const fullProduct = await productRepository.getById({ tenantId: draft.tenantId, guildId: draft.guildId, productId: draft.productId });
  if (!fullProduct) {
    await editDraftMessage({ api, draft, content: 'Product details could not be loaded. Start /sale again.' });
    return;
  }

  const mergedFields = mergeFormFields(
    draft.formFields,
    fullProduct.formFields.map((field) => ({
      fieldKey: field.fieldKey,
      label: field.label,
      required: field.required,
      fieldType: field.fieldType,
      validation: field.validation,
    })),
  );
  if (mergedFields.length > 5) {
    await editDraftMessage({ api, draft, content: 'This basket requires more than 5 questions. Reduce the product questions and try again.' });
    return;
  }

  draft.variantId = selectedVariantId;
  draft.formFields = mergedFields;
  draft.basketItems.push({
    productId: draft.productId,
    productName: draft.productName,
    category: draft.category,
    variantId: variant.variantId,
    variantLabel: variant.label,
    priceMinor: variant.priceMinor,
    currency: variant.currency,
  });
  draft.pendingInput = null;
  resetPointsSelection(draft);
  updateSaleDraft(draft);
  await renderBasketDecisionStep(api, draft);
}

async function handleCouponInput(api: Api, draft: SaleDraft, rawCoupon: string): Promise<void> {
  const couponCode = rawCoupon.trim().toUpperCase();
  const invalidButtons = buildKeyboard([
    { label: 'Try Again', data: `sale:act:${draft.id}:cap` },
    { label: 'No Coupon', data: `sale:act:${draft.id}:csk` },
  ]);
  if (!couponCode) {
    await editDraftMessage({ api, draft, content: 'Coupon code cannot be empty.', keyboard: invalidButtons });
    return;
  }

  const coupon = await couponRepository.getByCode({ tenantId: draft.tenantId, guildId: draft.guildId, code: couponCode });
  if (!coupon || !coupon.active) {
    await editDraftMessage({ api, draft, content: `Coupon ${couponCode} is invalid or inactive.`, keyboard: invalidButtons });
    return;
  }

  const eligibleSubtotalMinor = computeCouponEligibleSubtotalMinor(
    { allowedProductIds: coupon.allowedProductIds, allowedVariantIds: coupon.allowedVariantIds },
    draft.basketItems.map((item) => ({ productId: item.productId, variantId: item.variantId, priceMinor: item.priceMinor })),
  );
  if (eligibleSubtotalMinor <= 0) {
    await editDraftMessage({ api, draft, content: `Coupon ${couponCode} does not apply to the selected products or variations.`, keyboard: invalidButtons });
    return;
  }

  const effectiveCouponDiscountMinor = Math.min(eligibleSubtotalMinor, coupon.discountMinor);
  draft.couponCode = coupon.code;
  draft.couponDiscountMinor = effectiveCouponDiscountMinor;
  draft.pendingInput = null;
  resetPointsSelection(draft);
  updateSaleDraft(draft);
  await editDraftMessage({
    api,
    draft,
    content: [`Coupon ${coupon.code} applied (-${formatMinorCurrency(effectiveCouponDiscountMinor, draft.basketItems[0]?.currency ?? draft.defaultCurrency)}).`, ...buildBasketSummaryLines(draft), 'Continue to customer details.'].join('\n'),
    keyboard: buildKeyboard([{ label: 'Continue', data: `sale:act:${draft.id}:ccn` }]),
  });
}

async function handleAnswerInput(api: Api, draft: SaleDraft, fieldIndex: number, value: string): Promise<void> {
  const field = draft.formFields[fieldIndex];
  if (!field) {
    await editDraftMessage({ api, draft, content: 'Form questions changed. Start /sale again.' });
    return;
  }
  const normalizedValue = value.trim();
  if (field.required && !normalizedValue) {
    await editDraftMessage({ api, draft, content: `Required field is missing: ${field.label}. Send that answer again.` });
    return;
  }
  draft.answers[field.fieldKey] = normalizedValue;
  draft.pendingInput = null;
  resetPointsSelection(draft);
  updateSaleDraft(draft);
  await promptForAnswer(api, draft, fieldIndex + 1);
}

async function handleTipInput(api: Api, draft: SaleDraft, value: string): Promise<void> {
  let tipMinor = 0;
  try {
    tipMinor = parseTipToMinor(value);
  } catch (error) {
    await editDraftMessage({
      api,
      draft,
      content: error instanceof Error ? error.message : 'Invalid tip amount.',
      keyboard: buildKeyboard([
        { label: 'Try Tip Again', data: `sale:act:${draft.id}:ty` },
        { label: 'No Tip, Continue', data: `sale:act:${draft.id}:ts` },
      ]),
    });
    return;
  }
  draft.tipMinor = tipMinor;
  draft.pendingInput = null;
  resetPointsSelection(draft);
  updateSaleDraft(draft);
  await editDraftMessage({ api, draft, content: 'Checking points...' });
  await maybePromptPointsBeforeFinalize({ api, draft });
}

export async function handleSaleStartCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !isTelegramPrivateChat(ctx.chat.type)) {
    return false;
  }

  const payload =
    'match' in ctx && typeof (ctx as Context & { match?: unknown }).match === 'string'
      ? ((ctx as Context & { match?: string }).match ?? '').trim()
      : '';
  const draftId = parseTelegramSaleStartPayload(payload);
  if (!draftId) {
    return false;
  }

  const draft = getSaleDraft(draftId);
  if (!draft) {
    await ctx.reply('This sale link expired. Ask an admin to start the sale again in the Telegram group.');
    return true;
  }

  if (!canInteractWithDraft(draft, toTelegramScopedId(String(ctx.from.id)))) {
    await ctx.reply('This private sale link is only valid for the selected customer.');
    return true;
  }

  const controlMessage = await ctx.reply(
    [
      'Private sale started.',
      'This chat now handles product selection, checkout, coupon codes, customer details, and payment links privately.',
    ].join('\n'),
  );

  draft.controlChatId = toTelegramScopedId(String(ctx.chat.id));
  draft.controlMessageId = controlMessage.message_id;
  draft.pendingInput = null;
  updateSaleDraft(draft);

  await renderCategorySelectionStep(ctx.api, draft);
  return true;
}

export async function handleSaleCommand(ctx: Context): Promise<void> {
  if (!ctx.chat || !ctx.from || !ctx.message || !('text' in ctx.message)) return;
  if (!isTelegramGroupChat(ctx.chat.type)) {
    await ctx.reply('Use /sale inside a linked Telegram group chat. The bot will then move the sale into a private DM.');
    return;
  }

  const linkedStore = await getLinkedStoreForChat(String(ctx.chat.id));
  if (!linkedStore) {
    await ctx.reply('This Telegram group is not linked to a store yet. Generate a link command in the dashboard first.');
    return;
  }
  if (!(await isTelegramChatAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
    await ctx.reply('Only Telegram chat admins can start sales here.');
    return;
  }

  const configResult = await saleService.getGuildRuntimeConfig({ tenantId: linkedStore.tenantId, guildId: linkedStore.guildId });
  if (configResult.isErr()) {
    await ctx.reply(configResult.error.message);
    return;
  }

  const customer =
    ctx.message.reply_to_message?.from && !ctx.message.reply_to_message.from.is_bot ? ctx.message.reply_to_message.from : ctx.from;
  clearSaleDraftsForChat(toTelegramScopedId(String(ctx.chat.id)));
  const draft = createSaleDraft({
    tenantId: linkedStore.tenantId,
    guildId: linkedStore.guildId,
    ticketChannelId: toTelegramScopedId(String(ctx.chat.id)),
    customerLabel: formatTelegramUserLabel(customer),
    staffDiscordUserId: toTelegramScopedId(String(ctx.from.id)),
    customerDiscordUserId: toTelegramScopedId(String(customer.id)),
    tipEnabled: configResult.value.tipEnabled,
    defaultCurrency: configResult.value.defaultCurrency,
  });
  let continueUrl: string;

  try {
    continueUrl = buildTelegramBotDeepLink(env.TELEGRAM_BOT_USERNAME, `sale_${draft.id}`);
  } catch (error) {
    removeSaleDraft(draft.id);
    await ctx.reply(error instanceof Error ? error.message : 'TELEGRAM_BOT_USERNAME is required for Telegram DM sales.');
    return;
  }

  await ctx.reply(
    [
      `Private sale started for ${draft.customerLabel}.`,
      'Continue in a private chat with the bot to keep product selection, details, and payment links out of the group.',
      'If Telegram shows a START button in the DM, press it to continue.',
      'Only the selected customer can continue this sale.',
    ].join('\n'),
    {
      reply_markup: buildKeyboard([{ label: 'Continue in DM', url: continueUrl }]),
    },
  );
}

export async function handleSaleCallbackQuery(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !ctx.callbackQuery || !('data' in ctx.callbackQuery)) return false;
  const callbackData = ctx.callbackQuery.data;
  if (!callbackData) return false;
  const data = callbackData.trim();
  if (!data.startsWith('sale:')) return false;

  const [, kind, draftId, value] = data.split(':');
  const draft = draftId ? getSaleDraft(draftId) : null;
  if (!draft) {
    await ctx.answerCallbackQuery({ text: 'Sale draft expired. Start /sale again.', show_alert: true });
    return true;
  }
  if (!draft.controlChatId || draft.controlChatId !== toTelegramScopedId(String(ctx.chat.id))) {
    await ctx.answerCallbackQuery({ text: 'This sale is handled in the customer DM only.', show_alert: true });
    return true;
  }
  if (!canInteractWithDraft(draft, toTelegramScopedId(String(ctx.from.id)))) {
    await ctx.answerCallbackQuery({ text: 'Only the selected customer can use these private sale controls.', show_alert: true });
    return true;
  }
  await ctx.answerCallbackQuery();

  if (kind === 'cat' && value) await handleCategorySelection(ctx.api, draft, value);
  else if (kind === 'prd' && value) await handleProductSelection(ctx.api, draft, value);
  else if (kind === 'var' && value) await handleVariantSelection(ctx.api, draft, value);
  else if (kind === 'act' && value === 'add') await renderCategorySelectionStep(ctx.api, draft);
  else if (kind === 'act' && value === 'chg') {
    draft.basketItems.pop();
    draft.formFields = await rebuildFormFieldsFromBasket(draft);
    resetPointsSelection(draft);
    updateSaleDraft(draft);
    await renderVariantSelectionStep(ctx.api, draft);
  } else if (kind === 'act' && value === 'co') await renderCouponSelectionStep(ctx.api, draft);
  else if (kind === 'act' && value === 'cap') await promptForCoupon(ctx.api, draft);
  else if (kind === 'act' && value === 'csk') {
    draft.couponCode = null;
    draft.couponDiscountMinor = 0;
    draft.pendingInput = null;
    resetPointsSelection(draft);
    updateSaleDraft(draft);
    await renderAnswerCollectionStep(ctx.api, draft);
  } else if (kind === 'act' && value === 'ccn') await renderAnswerCollectionStep(ctx.api, draft);
  else if (kind === 'act' && value === 'ans') await promptForAnswer(ctx.api, draft, 0);
  else if (kind === 'act' && value === 'ty') await promptForTip(ctx.api, draft);
  else if (kind === 'act' && value === 'ts') {
    draft.tipMinor = 0;
    draft.pendingInput = null;
    resetPointsSelection(draft);
    updateSaleDraft(draft);
    await editDraftMessage({ api: ctx.api, draft, content: 'Checking points...' });
    await maybePromptPointsBeforeFinalize({ api: ctx.api, draft });
  } else if (kind === 'act' && (value === 'pu' || value === 'ps')) {
    draft.usePoints = value === 'pu';
    draft.pendingInput = null;
    updateSaleDraft(draft);
    await editDraftMessage({ api: ctx.api, draft, content: 'Creating checkout link...' });
    await finalizeDraft({ api: ctx.api, draft });
  } else await editDraftMessage({ api: ctx.api, draft, content: 'Unknown sale action. Start /sale again.' });
  return true;
}

export async function handleSaleTextMessage(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !ctx.message || !('text' in ctx.message)) return false;
  const actor = ctx.from;
  if (!actor) return false;
  const draft = listSaleDraftsForControlChat(toTelegramScopedId(String(ctx.chat.id))).find(
    (candidate) => candidate.pendingInput !== null && canInteractWithDraft(candidate, toTelegramScopedId(String(actor.id))),
  );
  if (!draft || !draft.pendingInput) return false;

  const messageText = ctx.message.text ?? '';
  if (draft.pendingInput.type === 'coupon') await handleCouponInput(ctx.api, draft, messageText);
  else if (draft.pendingInput.type === 'tip') await handleTipInput(ctx.api, draft, messageText);
  else await handleAnswerInput(ctx.api, draft, draft.pendingInput.fieldIndex, messageText);
  return true;
}

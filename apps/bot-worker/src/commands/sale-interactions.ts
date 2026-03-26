import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import {
  computeCouponEligibleSubtotalMinor,
  CouponRepository,
  ProductRepository,
  SaleService,
  TenantRepository,
} from '@voodoo/core';

import {
  getSaleDraft,
  removeSaleDraft,
  updateSaleDraft,
  type SaleDraft,
  type SaleDraftFormField,
} from '../flows/sale-draft-store.js';
import {
  buildCheckoutLinksEmbed,
  sendCheckoutMessage,
  startSaleFlowFromButton,
} from './sale-flow.js';

const productRepository = new ProductRepository();
const couponRepository = new CouponRepository();
const saleService = new SaleService();
const displayLabelCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function canInteractWithDraft(draft: SaleDraft, userId: string): boolean {
  return draft.customerDiscordUserId === userId || draft.staffDiscordUserId === userId;
}

function normalizeCategoryLabel(category: string): string {
  const trimmed = category.trim();
  if (!trimmed) {
    return 'Uncategorized';
  }

  return trimmed;
}

function compareVariantForDisplay(
  left: { label: string; priceMinor: number; variantId: string },
  right: { label: string; priceMinor: number; variantId: string },
): number {
  const labelCompare = displayLabelCollator.compare(left.label, right.label);
  if (labelCompare !== 0) {
    return labelCompare;
  }

  if (left.priceMinor !== right.priceMinor) {
    return left.priceMinor - right.priceMinor;
  }

  return left.variantId.localeCompare(right.variantId);
}

function compareProductNameForDisplay(
  left: { name: string; productId: string },
  right: { name: string; productId: string },
): number {
  const nameCompare = displayLabelCollator.compare(left.name, right.name);
  if (nameCompare !== 0) {
    return nameCompare;
  }

  return left.productId.localeCompare(right.productId);
}

type SaleStepInteraction = StringSelectMenuInteraction | ButtonInteraction;
type StepButton = {
  customId: string;
  label: string;
  style: ButtonStyle;
};
type DraftFinalizeInteraction = {
  channel: ModalSubmitInteraction['channel'] | StringSelectMenuInteraction['channel'] | ButtonInteraction['channel'];
  editReply: (payload: { content: string; components?: any[]; embeds?: any[] }) => Promise<unknown>;
  inGuild: () => boolean;
};

function formatMinorCurrency(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2);
  return `${major} ${currency}`;
}

function getBasketSubtotalMinor(draft: SaleDraft): number {
  return draft.basketItems.reduce((sum, item) => sum + item.priceMinor, 0);
}

function getCouponDiscountMinor(draft: SaleDraft): number {
  const subtotal = getBasketSubtotalMinor(draft);
  return Math.min(subtotal, Math.max(0, draft.couponDiscountMinor));
}

function getBasketTotalMinor(draft: SaleDraft): number {
  const subtotal = getBasketSubtotalMinor(draft);
  const couponDiscountMinor = getCouponDiscountMinor(draft);
  return Math.max(0, subtotal - couponDiscountMinor + draft.tipMinor);
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
  if (draft.basketItems.length === 0) {
    return ['Basket: (empty)'];
  }

  const lines = draft.basketItems.map(
    (item, index) =>
      `${index + 1}. ${item.category} / ${item.productName} / ${item.variantLabel} - ${formatMinorCurrency(item.priceMinor, item.currency)}`,
  );

  const currency = draft.basketItems[0]?.currency ?? draft.defaultCurrency;
  const subtotalMinor = getBasketSubtotalMinor(draft);
  const couponDiscountMinor = getCouponDiscountMinor(draft);
  const totalMinor = getBasketTotalMinor(draft);

  lines.push(`Subtotal: ${formatMinorCurrency(subtotalMinor, currency)}`);

  if (draft.couponCode) {
    if (couponDiscountMinor > 0) {
      lines.push(`Coupon (${draft.couponCode}): -${formatMinorCurrency(couponDiscountMinor, currency)}`);
    } else {
      lines.push(`Coupon (${draft.couponCode}): 0.00 ${currency}`);
    }
  }

  if (draft.tipMinor > 0) {
    lines.push(`Tip: +${formatMinorCurrency(draft.tipMinor, currency)}`);
  }

  lines.push(`Total Due: ${formatMinorCurrency(totalMinor, currency)}`);

  return lines;
}

function buildSelectRow(input: {
  customId: string;
  placeholder: string;
  options: Array<{ label: string; description?: string; value: string }>;
}): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(input.customId)
    .setPlaceholder(input.placeholder)
    .addOptions(input.options.slice(0, 25));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function buildBackRow(input: { customId: string; label?: string }): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId(input.customId)
    .setLabel(input.label ?? 'Back')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

function buildButtonRow(buttons: StepButton[]): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const button of buttons.slice(0, 5)) {
    row.addComponents(
      new ButtonBuilder().setCustomId(button.customId).setLabel(button.label).setStyle(button.style),
    );
  }

  return row;
}

function buildDoneAddingRow(draft: SaleDraft): ActionRowBuilder<ButtonBuilder> | null {
  if (draft.basketItems.length === 0) {
    return null;
  }

  return buildButtonRow([
    {
      customId: `sale:action:${draft.id}:continue_checkout`,
      label: 'Done Adding',
      style: ButtonStyle.Primary,
    },
  ]);
}

function toOptionDescription(input: { description: string; variantCount: number }): string {
  const description = input.description.trim();
  if (description.length > 0) {
    return description.slice(0, 100);
  }

  return `${input.variantCount} price option(s)`.slice(0, 100);
}

function buildFormModal(
  draftId: string,
  productFields: Array<{
    fieldKey: string;
    label: string;
    required: boolean;
    fieldType: 'short_text' | 'long_text' | 'email' | 'number';
    validation: Record<string, unknown> | null;
  }>,
  existingAnswers: Record<string, string>,
): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(`sale:modal:${draftId}:answers`).setTitle('Customer Details');

  for (const field of productFields) {
    const validation = field.validation ?? {};
    const input = new TextInputBuilder()
      .setCustomId(field.fieldKey)
      .setLabel(field.label.slice(0, 45))
      .setRequired(field.required)
      .setStyle(field.fieldType === 'long_text' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setMaxLength(
        typeof validation.maxLength === 'number' ? Math.max(1, Number(validation.maxLength)) : 1000,
      );

    if (typeof validation.minLength === 'number') {
      input.setMinLength(Math.max(0, Number(validation.minLength)));
    }

    const existing = existingAnswers[field.fieldKey];
    if (existing) {
      input.setValue(existing);
    }

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  return modal;
}

function buildCouponModal(draftId: string, existingCouponCode: string | null): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(`sale:modal:${draftId}:coupon`).setTitle('Apply Coupon');

  const codeInput = new TextInputBuilder()
    .setCustomId('couponCode')
    .setLabel('Coupon code')
    .setRequired(true)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(40)
    .setPlaceholder('SAVE10');

  if (existingCouponCode) {
    codeInput.setValue(existingCouponCode);
  }

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput));
  return modal;
}

function buildTipModal(draftId: string, existingTipMinor: number): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(`sale:modal:${draftId}:tip`).setTitle('Add Tip (GBP)');

  const tipInput = new TextInputBuilder()
    .setCustomId('tipAmount')
    .setLabel('Tip amount in GBP')
    .setRequired(true)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(12)
    .setPlaceholder('2.50');

  if (existingTipMinor > 0) {
    tipInput.setValue((existingTipMinor / 100).toFixed(2));
  }

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(tipInput));
  return modal;
}

function parseTipToMinor(rawValue: string): number {
  const value = rawValue.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error('Tip must be a valid GBP amount, for example 2.50');
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Tip must be greater than zero.');
  }

  return Math.round(amount * 100);
}

function mergeFormFields(existing: SaleDraftFormField[], incoming: SaleDraftFormField[]): SaleDraftFormField[] {
  const merged = [...existing];
  const existingKeys = new Set(existing.map((field) => field.fieldKey.toLowerCase()));

  for (const field of incoming) {
    const key = field.fieldKey.toLowerCase();
    if (existingKeys.has(key)) {
      continue;
    }

    merged.push(field);
    existingKeys.add(key);
  }

  return merged;
}

async function rebuildFormFieldsFromBasket(draft: SaleDraft): Promise<SaleDraftFormField[]> {
  const uniqueProductIds = Array.from(new Set(draft.basketItems.map((item) => item.productId)));
  let merged: SaleDraftFormField[] = [];

  for (const productId of uniqueProductIds) {
    const product = await productRepository.getById({
      tenantId: draft.tenantId,
      guildId: draft.guildId,
      productId,
    });

    if (!product) {
      continue;
    }

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

async function finalizeDraft(input: {
  draftId: string;
  draft: SaleDraft;
  interaction: DraftFinalizeInteraction;
}): Promise<void> {
  try {
    if (!input.interaction.inGuild() || !input.interaction.channel || input.draft.basketItems.length === 0) {
      await input.interaction.editReply({
        content: 'Sale draft expired. Please start again with `/sale`.',
        components: [],
      });
      return;
    }

    const primaryItem = input.draft.basketItems[0];
    if (!primaryItem) {
      await input.interaction.editReply({
        content: 'Basket is empty. Please restart `/sale`.',
        components: [],
      });
      return;
    }

    const created = await saleService.createSaleSessionFromBot({
      tenantId: input.draft.tenantId,
      guildId: input.draft.guildId,
      ticketChannelId: input.draft.ticketChannelId,
      staffDiscordUserId: input.draft.staffDiscordUserId,
      customerDiscordUserId: input.draft.customerDiscordUserId,
      defaultCurrency: input.draft.defaultCurrency,
      productId: primaryItem.productId,
      variantId: primaryItem.variantId,
      items: input.draft.basketItems.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
      })),
      couponCode: input.draft.couponCode,
      tipMinor: input.draft.tipMinor,
      usePoints: input.draft.usePoints,
      answers: input.draft.answers,
    });

    if (created.isErr()) {
      await input.interaction.editReply({ content: created.error.message, components: [] });
      return;
    }

    removeSaleDraft(input.draftId);

    try {
      await sendCheckoutMessage(input.interaction.channel as any, {
        checkoutUrl: created.value.checkoutUrl,
        checkoutOptions: created.value.checkoutOptions,
        orderSessionId: created.value.orderSessionId,
        customerDiscordUserId: input.draft.customerDiscordUserId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error while posting checkout message.';
      await input.interaction.editReply({
        content: [
          'Checkout created, but I could not post the public checkout message in this channel.',
          `Reason: ${reason}`,
          'Use the checkout link below instead.',
          `Order Session: \`${created.value.orderSessionId}\``,
        ].join('\n'),
        components: [],
        embeds: [
          buildCheckoutLinksEmbed({
            checkoutUrl: created.value.checkoutUrl,
            checkoutOptions: created.value.checkoutOptions,
          }),
        ],
      });
      return;
    }

    const warningLines = created.value.warnings.map((warning) => `Warning: ${warning}`);
    await input.interaction.editReply({
      content: [
        `Checkout link generated. Order session: \`${created.value.orderSessionId}\``,
        ...warningLines,
      ].join('\n'),
      components: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected checkout error.';
    await input.interaction.editReply({
      content: `Checkout creation failed: ${message}`,
      components: [],
    });
  }
}

async function maybePromptPointsBeforeFinalize(input: {
  draftId: string;
  draft: SaleDraft;
  interaction: DraftFinalizeInteraction;
}): Promise<void> {
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
    await input.interaction.editReply({
      content: preview.error.message,
      components: [],
    });
    return;
  }

  const points = preview.value;
  if (
    !points.canRedeem ||
    points.availablePoints <= 0 ||
    points.pointsReservedIfUsed <= 0 ||
    points.pointsDiscountMinorIfUsed <= 0
  ) {
    resetPointsSelection(input.draft);
    input.draft.customerEmailNormalized = points.emailNormalized;
    input.draft.pointValueMinor = points.pointValueMinor;
    input.draft.pointsAvailable = points.availablePoints;
    updateSaleDraft(input.draft);

    await input.interaction.editReply({
      content: 'Creating checkout link...',
      components: [],
    });

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
  updateSaleDraft(input.draft);

  await input.interaction.editReply({
    content: [
      'Step 8/8: Use Points?',
      ...buildBasketSummaryLines(input.draft),
      `Available points: ${points.availablePoints}`,
      `Point value: 1 point = ${formatMinorCurrency(points.pointValueMinor, currency)}`,
      `Redeemable now: ${points.pointsReservedIfUsed} point(s)`,
      `Discount if used: -${formatMinorCurrency(points.pointsDiscountMinorIfUsed, currency)}`,
      'Would the customer like to apply points to this checkout?',
    ].join('\n'),
    components: [
      buildButtonRow([
        {
          customId: `sale:action:${input.draft.id}:points_use`,
          label: 'Use Points',
          style: ButtonStyle.Primary,
        },
        {
          customId: `sale:action:${input.draft.id}:points_skip`,
          label: 'Continue Without Points',
          style: ButtonStyle.Secondary,
        },
      ]),
    ],
  });
}

async function renderCategorySelectionStep(
  interaction: SaleStepInteraction,
  draft: SaleDraft,
): Promise<void> {
  const optionsResult = await saleService.getSaleOptions({
    tenantId: draft.tenantId,
    guildId: draft.guildId,
  });
  if (optionsResult.isErr()) {
    await interaction.update({ content: optionsResult.error.message, components: [] });
    return;
  }

  const products = optionsResult.value.filter((product) => product.variants.length > 0);
  if (products.length === 0) {
    await interaction.update({
      content: 'No active products/variants are configured for this server yet.',
      components: [],
    });
    return;
  }

  const categoryCounts = new Map<string, { label: string; productCount: number }>();
  for (const product of products) {
    const normalizedCategory = normalizeCategoryLabel(product.category);
    const key = normalizedCategory.toLowerCase();
    const existing = categoryCounts.get(key);
    if (existing) {
      existing.productCount += 1;
      continue;
    }

    categoryCounts.set(key, {
      label: normalizedCategory,
      productCount: 1,
    });
  }

  const categoryOptions = Array.from(categoryCounts.values())
    .sort((left, right) => displayLabelCollator.compare(left.label, right.label))
    .map((category) => ({
      label: category.label.slice(0, 100),
      description: `${category.productCount} product(s)`.slice(0, 100),
      value: category.label,
    }));

  draft.category = null;
  draft.productName = null;
  draft.productId = null;
  draft.variantId = null;
  draft.variantOptions = [];
  resetPointsSelection(draft);
  updateSaleDraft(draft);

  const row = buildSelectRow({
    customId: `sale:start:${draft.id}:category`,
    placeholder: 'Select category',
    options: categoryOptions,
  });
  const doneAddingRow = buildDoneAddingRow(draft);

  await interaction.update({
    content: [
      `Step 1/7: Select category for <@${draft.customerDiscordUserId}>`,
      ...buildBasketSummaryLines(draft),
    ].join('\n'),
    components: doneAddingRow ? [row, doneAddingRow] : [row],
  });
}

async function renderProductSelectionStep(
  interaction: SaleStepInteraction,
  draft: SaleDraft,
): Promise<void> {
  if (!draft.category) {
    await interaction.update({
      content: 'Category not selected. Start `/sale` again.',
      components: [],
    });
    return;
  }

  const optionsResult = await saleService.getSaleOptions({
    tenantId: draft.tenantId,
    guildId: draft.guildId,
  });
  if (optionsResult.isErr()) {
    await interaction.update({ content: optionsResult.error.message, components: [] });
    return;
  }

  const products = optionsResult.value.filter((product) => {
    if (product.variants.length === 0) {
      return false;
    }

    return normalizeCategoryLabel(product.category).toLowerCase() === draft.category?.toLowerCase();
  });

  if (products.length === 0) {
    await interaction.update({
      content: `No products found for category "${draft.category}". Start \`/sale\` again.`,
      components: [],
    });
    return;
  }

  draft.productName = null;
  draft.productId = null;
  draft.variantId = null;
  draft.variantOptions = [];
  updateSaleDraft(draft);

  const row = buildSelectRow({
    customId: `sale:start:${draft.id}:product`,
    placeholder: 'Select product',
    options: products
      .sort(compareProductNameForDisplay)
      .map((product) => ({
        label: product.name.slice(0, 100),
        description: toOptionDescription({
          description: product.description,
          variantCount: product.variants.length,
        }),
        value: product.productId,
      })),
  });
  const doneAddingRow = buildDoneAddingRow(draft);

  await interaction.update({
    content: [
      `Step 2/7: Category **${draft.category}** selected. Now select product.`,
      ...buildBasketSummaryLines(draft),
    ].join('\n'),
    components: doneAddingRow
      ? [row, buildBackRow({ customId: `sale:back:${draft.id}:category` }), doneAddingRow]
      : [row, buildBackRow({ customId: `sale:back:${draft.id}:category` })],
  });
}

async function handleCategorySelection(
  interaction: StringSelectMenuInteraction,
  draft: SaleDraft,
  selectedCategory: string,
): Promise<void> {
  draft.category = normalizeCategoryLabel(selectedCategory);
  updateSaleDraft(draft);
  await renderProductSelectionStep(interaction, draft);
}

async function renderVariantSelectionStep(
  interaction: SaleStepInteraction,
  draft: SaleDraft,
): Promise<void> {
  if (!draft.productId || !draft.productName || !draft.category) {
    await interaction.update({
      content: 'Product not selected. Start `/sale` again.',
      components: [],
    });
    return;
  }

  if (draft.variantOptions.length === 0) {
    await interaction.update({
      content: 'No variants available for this product. Start `/sale` again.',
      components: [],
    });
    return;
  }

  const row = buildSelectRow({
    customId: `sale:start:${draft.id}:variant`,
    placeholder: 'Select price option',
    options: draft.variantOptions.map((variant) => ({
      label: variant.label.slice(0, 100),
      description: `${(variant.priceMinor / 100).toFixed(2)} ${variant.currency}`.slice(0, 100),
      value: variant.variantId,
    })),
  });

  const optionsResult = await saleService.getSaleOptions({
    tenantId: draft.tenantId,
    guildId: draft.guildId,
  });

  const selectedProduct = optionsResult.isOk()
    ? optionsResult.value.find((product) => product.productId === draft.productId)
    : null;
  const description = selectedProduct?.description?.trim() ?? '';
  const descriptionLine =
    description.length > 0
      ? `Description: ${description.length > 280 ? `${description.slice(0, 277)}...` : description}`
      : null;
  const doneAddingRow = buildDoneAddingRow(draft);

  await interaction.update({
    content: [
      `Step 3/7: Product **${draft.productName}** selected.`,
      `Category: **${draft.category}**`,
      descriptionLine,
      'Now select a price option.',
      ...buildBasketSummaryLines(draft),
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
    components: doneAddingRow
      ? [row, buildBackRow({ customId: `sale:back:${draft.id}:product` }), doneAddingRow]
      : [row, buildBackRow({ customId: `sale:back:${draft.id}:product` })],
  });
}

async function renderBasketDecisionStep(
  interaction: SaleStepInteraction,
  draft: SaleDraft,
): Promise<void> {
  const last = draft.basketItems[draft.basketItems.length - 1];
  const lastLine =
    last && last.currency
      ? `Added: ${last.category} / ${last.productName} / ${last.variantLabel} - ${formatMinorCurrency(last.priceMinor, last.currency)}`
      : null;

  const buttons: StepButton[] = [
    {
      customId: `sale:action:${draft.id}:add_more`,
      label: 'Add More Products',
      style: ButtonStyle.Secondary,
    },
    {
      customId: `sale:action:${draft.id}:continue_checkout`,
      label: 'Continue',
      style: ButtonStyle.Primary,
    },
  ];

  if (draft.productId && draft.variantOptions.length > 0) {
    buttons.unshift({
      customId: `sale:action:${draft.id}:change_last`,
      label: 'Change Last Item',
      style: ButtonStyle.Secondary,
    });
  }

  await interaction.update({
    content: [
      'Step 4/7: Basket updated.',
      lastLine,
      ...buildBasketSummaryLines(draft),
      'Would you like to add another product?',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
    components: [buildButtonRow(buttons)],
  });
}

async function renderCouponSelectionStep(
  interaction: SaleStepInteraction,
  draft: SaleDraft,
): Promise<void> {
  const applyLabel = draft.couponCode ? 'Change Coupon' : 'Apply Coupon';

  await interaction.update({
    content: [
      'Step 5/7: Coupon (optional)',
      ...buildBasketSummaryLines(draft),
      draft.couponCode ? `Current coupon: ${draft.couponCode}` : 'No coupon selected.',
    ].join('\n'),
    components: [
      buildButtonRow([
        {
          customId: `sale:action:${draft.id}:coupon_apply`,
          label: applyLabel,
          style: ButtonStyle.Secondary,
        },
        {
          customId: `sale:action:${draft.id}:coupon_skip`,
          label: 'No Coupon',
          style: ButtonStyle.Secondary,
        },
        {
          customId: `sale:action:${draft.id}:coupon_continue`,
          label: 'Continue',
          style: ButtonStyle.Primary,
        },
      ]),
      buildBackRow({ customId: `sale:back:${draft.id}:category`, label: 'Back To Category' }),
    ],
  });
}

async function renderAnswerCollectionStep(
  interaction: SaleStepInteraction,
  draft: SaleDraft,
): Promise<void> {
  if (draft.formFields.length > 5) {
    await interaction.update({
      content:
        'This basket requires more than 5 questions. Current modal flow supports up to 5 questions total. Reduce category questions and try again.',
      components: [],
    });
    return;
  }

  if (draft.formFields.length === 0) {
    if (draft.tipEnabled) {
      await renderTipDecisionStep(interaction, draft);
      return;
    }

    await interaction.update({
      content: 'Creating checkout link...',
      components: [],
    });

    await maybePromptPointsBeforeFinalize({
      draftId: draft.id,
      draft,
      interaction: {
        channel: interaction.channel,
        editReply: async (payload) => interaction.editReply(payload),
        inGuild: () => interaction.inGuild(),
      },
    });

    return;
  }

  await interaction.update({
    content: [
      'Step 6/7: Customer details',
      ...buildBasketSummaryLines(draft),
      `Questions required: ${draft.formFields.length}`,
      'Click the button below to enter customer answers.',
    ].join('\n'),
    components: [
      buildButtonRow([
        {
          customId: `sale:action:${draft.id}:answers_open`,
          label: 'Enter Answers',
          style: ButtonStyle.Primary,
        },
      ]),
      buildBackRow({ customId: `sale:back:${draft.id}:coupon` }),
    ],
  });
}

async function renderTipDecisionStep(
  interaction: SaleStepInteraction,
  draft: SaleDraft,
): Promise<void> {
  await interaction.update({
    content: [
      'Step 7/7: Tip (optional)',
      ...buildBasketSummaryLines(draft),
      'Would the customer like to add a tip in GBP?',
    ].join('\n'),
    components: [
      buildButtonRow([
        {
          customId: `sale:action:${draft.id}:tip_yes`,
          label: 'Yes, Add Tip',
          style: ButtonStyle.Secondary,
        },
        {
          customId: `sale:action:${draft.id}:tip_skip`,
          label: 'No Tip, Continue',
          style: ButtonStyle.Primary,
        },
      ]),
    ],
  });
}

async function handleProductSelection(
  interaction: StringSelectMenuInteraction,
  draft: SaleDraft,
  selectedProductId: string,
): Promise<void> {
  if (!draft.category) {
    await interaction.update({
      content: 'Category not selected. Start `/sale` again.',
      components: [],
    });
    return;
  }

  const optionsResult = await saleService.getSaleOptions({
    tenantId: draft.tenantId,
    guildId: draft.guildId,
  });
  if (optionsResult.isErr()) {
    await interaction.update({ content: optionsResult.error.message, components: [] });
    return;
  }

  const selectedProduct = optionsResult.value.find((product) => product.productId === selectedProductId);
  if (!selectedProduct) {
    await interaction.update({
      content: 'Product not found. Start `/sale` again.',
      components: [],
    });
    return;
  }

  if (normalizeCategoryLabel(selectedProduct.category).toLowerCase() !== draft.category.toLowerCase()) {
    await interaction.update({
      content: 'Selected product does not belong to the chosen category. Start `/sale` again.',
      components: [],
    });
    return;
  }

  if (selectedProduct.variants.length === 0) {
    await interaction.update({
      content: 'No variants available for this product. Start `/sale` again.',
      components: [],
    });
    return;
  }

  draft.productName = selectedProduct.name;
  draft.productId = selectedProduct.productId;
  draft.variantId = null;
  draft.variantOptions = [...selectedProduct.variants]
    .sort(compareVariantForDisplay)
    .map((variant) => ({
      variantId: variant.variantId,
      label: variant.label,
      priceMinor: variant.priceMinor,
      currency: draft.defaultCurrency,
    }));
  updateSaleDraft(draft);

  await renderVariantSelectionStep(interaction, draft);
}

async function handleVariantSelection(
  interaction: StringSelectMenuInteraction,
  draft: SaleDraft,
  selectedVariantId: string,
): Promise<void> {
  if (!draft.productId || !draft.productName || !draft.category) {
    await interaction.update({
      content: 'Product not selected. Start `/sale` again.',
      components: [],
    });
    return;
  }

  const variant = draft.variantOptions.find((item) => item.variantId === selectedVariantId);
  if (!variant) {
    await interaction.update({
      content: 'Variant not found. Please restart `/sale`.',
      components: [],
    });
    return;
  }

  const existingCurrency = draft.basketItems[0]?.currency;
  if (existingCurrency && existingCurrency !== variant.currency) {
    await interaction.update({
      content: `Basket currency mismatch. Existing basket uses ${existingCurrency}, but this option uses ${variant.currency}.`,
      components: [],
    });
    return;
  }

  const fullProduct = await productRepository.getById({
    tenantId: draft.tenantId,
    guildId: draft.guildId,
    productId: draft.productId,
  });
  if (!fullProduct) {
    await interaction.update({
      content: 'Product details could not be loaded. Start `/sale` again.',
      components: [],
    });
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
    await interaction.update({
      content:
        'This basket requires more than 5 questions. Current modal flow supports up to 5 questions total. Reduce category questions and try again.',
      components: [],
    });
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
    currency: draft.defaultCurrency,
  });
  resetPointsSelection(draft);
  updateSaleDraft(draft);

  await renderBasketDecisionStep(interaction, draft);
}

export async function handleSaleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [, , draftId, step] = interaction.customId.split(':');
  if (!draftId || !step) {
    await interaction.update({ content: 'Invalid sale draft.', components: [] });
    return;
  }

  const draft = getSaleDraft(draftId);
  if (!draft) {
    await interaction.update({
      content: 'Sale draft expired. Start `/sale` again.',
      components: [],
    });
    return;
  }

  if (!canInteractWithDraft(draft, interaction.user.id)) {
    await interaction.reply({
      content: 'Only the selected customer (or the staff member who started this sale) can use this menu.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedValue = interaction.values[0]?.trim();
  if (!selectedValue) {
    await interaction.update({
      content: 'Invalid selection. Start `/sale` again.',
      components: [],
    });
    return;
  }

  if (step === 'category') {
    await handleCategorySelection(interaction, draft, selectedValue);
    return;
  }

  if (step === 'product') {
    await handleProductSelection(interaction, draft, selectedValue);
    return;
  }

  if (step === 'variant') {
    await handleVariantSelection(interaction, draft, selectedValue);
    return;
  }

  await interaction.update({ content: 'Unknown sale step. Start `/sale` again.', components: [] });
}

export async function handleSaleBack(interaction: Interaction): Promise<void> {
  if (!interaction.isButton() || !interaction.customId.startsWith('sale:back:')) {
    return;
  }

  const [, , draftId, targetStep] = interaction.customId.split(':');
  if (!draftId || !targetStep) {
    await interaction.update({ content: 'Invalid sale draft.', components: [] });
    return;
  }

  const draft = getSaleDraft(draftId);
  if (!draft) {
    await interaction.update({
      content: 'Sale draft expired. Start `/sale` again.',
      components: [],
    });
    return;
  }

  if (!canInteractWithDraft(draft, interaction.user.id)) {
    await interaction.reply({
      content: 'Only the selected customer (or the staff member who started this sale) can use this button.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetStep === 'category') {
    await renderCategorySelectionStep(interaction, draft);
    return;
  }

  if (targetStep === 'product') {
    if (!draft.category) {
      await interaction.update({
        content: 'Category not selected. Start `/sale` again.',
        components: [],
      });
      return;
    }

    await renderProductSelectionStep(interaction, draft);
    return;
  }

  if (targetStep === 'coupon') {
    await renderCouponSelectionStep(interaction, draft);
    return;
  }

  await interaction.update({ content: 'Unknown sale step. Start `/sale` again.', components: [] });
}

function getDraftFromInteraction(interaction: SaleStepInteraction, draftId: string): SaleDraft | null {
  const draft = getSaleDraft(draftId);
  if (!draft) {
    return null;
  }

  if (!canInteractWithDraft(draft, interaction.user.id)) {
    return null;
  }

  return draft;
}

export async function handleSaleAction(interaction: Interaction): Promise<void> {
  if (!interaction.isButton() || !interaction.customId.startsWith('sale:action:')) {
    return;
  }

  const [, , draftId, action] = interaction.customId.split(':');
  if (!draftId || !action) {
    await interaction.update({ content: 'Invalid sale draft.', components: [] });
    return;
  }

  const draft = getDraftFromInteraction(interaction, draftId);
  if (!draft) {
    if (getSaleDraft(draftId)) {
      await interaction.reply({
        content: 'Only the selected customer (or the staff member who started this sale) can use this button.',
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.update({ content: 'Sale draft expired. Start `/sale` again.', components: [] });
    }
    return;
  }

  if (action === 'add_more') {
    await renderCategorySelectionStep(interaction, draft);
    return;
  }

  if (action === 'change_last') {
    const popped = draft.basketItems.pop();
    if (!popped) {
      await interaction.update({ content: 'No basket item to change.', components: [] });
      return;
    }

    draft.formFields = await rebuildFormFieldsFromBasket(draft);
    resetPointsSelection(draft);
    updateSaleDraft(draft);
    await renderVariantSelectionStep(interaction, draft);
    return;
  }

  if (action === 'continue_checkout') {
    if (draft.basketItems.length === 0) {
      await interaction.update({
        content: 'Basket is empty. Please select at least one item.',
        components: [],
      });
      return;
    }

    await renderCouponSelectionStep(interaction, draft);
    return;
  }

  if (action === 'coupon_apply') {
    await interaction.showModal(buildCouponModal(draft.id, draft.couponCode));
    return;
  }

  if (action === 'coupon_skip') {
    draft.couponCode = null;
    draft.couponDiscountMinor = 0;
    resetPointsSelection(draft);
    updateSaleDraft(draft);
    await renderAnswerCollectionStep(interaction, draft);
    return;
  }

  if (action === 'coupon_continue') {
    resetPointsSelection(draft);
    updateSaleDraft(draft);
    await renderAnswerCollectionStep(interaction, draft);
    return;
  }

  if (action === 'answers_open') {
    if (draft.formFields.length === 0) {
      await renderAnswerCollectionStep(interaction, draft);
      return;
    }

    if (draft.formFields.length > 5) {
      await interaction.update({
        content:
          'This basket requires more than 5 questions. Current modal flow supports up to 5 questions total. Reduce category questions and try again.',
        components: [],
      });
      return;
    }

    await interaction.showModal(buildFormModal(draft.id, draft.formFields, draft.answers));
    return;
  }

  if (action === 'tip_yes') {
    await interaction.showModal(buildTipModal(draft.id, draft.tipMinor));
    return;
  }

  if (action === 'tip_skip') {
    draft.tipMinor = 0;
    resetPointsSelection(draft);
    updateSaleDraft(draft);

    await interaction.update({
      content: 'Checking points...',
      components: [],
    });

    await maybePromptPointsBeforeFinalize({
      draftId: draft.id,
      draft,
      interaction: {
        channel: interaction.channel,
        editReply: async (payload) => interaction.editReply(payload),
        inGuild: () => interaction.inGuild(),
      },
    });
    return;
  }

  if (action === 'points_use') {
    draft.usePoints = true;
    updateSaleDraft(draft);

    await interaction.update({
      content: 'Creating checkout link...',
      components: [],
    });

    await finalizeDraft({
      draftId: draft.id,
      draft,
      interaction: {
        channel: interaction.channel,
        editReply: async (payload) => interaction.editReply(payload),
        inGuild: () => interaction.inGuild(),
      },
    });
    return;
  }

  if (action === 'points_skip') {
    draft.usePoints = false;
    updateSaleDraft(draft);

    await interaction.update({
      content: 'Creating checkout link...',
      components: [],
    });

    await finalizeDraft({
      draftId: draft.id,
      draft,
      interaction: {
        channel: interaction.channel,
        editReply: async (payload) => interaction.editReply(payload),
        inGuild: () => interaction.inGuild(),
      },
    });
    return;
  }

  await interaction.update({ content: 'Unknown sale action. Start `/sale` again.', components: [] });
}

async function handleAnswersModal(interaction: ModalSubmitInteraction, draft: SaleDraft): Promise<void> {
  for (const field of draft.formFields) {
    let value = '';

    try {
      value = interaction.fields.getTextInputValue(field.fieldKey);
    } catch {
      if (field.required) {
        await interaction.editReply({
          content: 'Form questions changed during checkout. Please restart `/sale`.',
        });
        return;
      }

      continue;
    }

    const normalizedValue = value.trim();
    if (field.required && !normalizedValue) {
      await interaction.editReply({
        content: `Required field is missing: \`${field.fieldKey}\`. Please restart \`/sale\`.`,
      });
      return;
    }

    draft.answers[field.fieldKey] = normalizedValue;
  }

  resetPointsSelection(draft);
  updateSaleDraft(draft);

  if (draft.tipEnabled) {
    await interaction.editReply({
      content: [
        'Step 7/7: Tip (optional)',
        ...buildBasketSummaryLines(draft),
        'Would the customer like to add a tip in GBP?',
      ].join('\n'),
      components: [
        buildButtonRow([
          {
            customId: `sale:action:${draft.id}:tip_yes`,
            label: 'Yes, Add Tip',
            style: ButtonStyle.Secondary,
          },
          {
            customId: `sale:action:${draft.id}:tip_skip`,
            label: 'No Tip, Continue',
            style: ButtonStyle.Primary,
          },
        ]),
      ],
    });
    return;
  }

  await interaction.editReply({
    content: 'Checking points...',
    components: [],
  });

  await maybePromptPointsBeforeFinalize({
    draftId: draft.id,
    draft,
    interaction: {
      channel: interaction.channel,
      editReply: async (payload) => interaction.editReply(payload),
      inGuild: () => interaction.inGuild(),
    },
  });
}

async function handleCouponModal(interaction: ModalSubmitInteraction, draft: SaleDraft): Promise<void> {
  const rawCoupon = interaction.fields.getTextInputValue('couponCode').trim().toUpperCase();

  if (!rawCoupon) {
    await interaction.editReply({
      content: 'Coupon code cannot be empty. Enter a code or continue without coupon.',
      components: [
        buildButtonRow([
          {
            customId: `sale:action:${draft.id}:coupon_apply`,
            label: 'Try Again',
            style: ButtonStyle.Secondary,
          },
          {
            customId: `sale:action:${draft.id}:coupon_skip`,
            label: 'No Coupon',
            style: ButtonStyle.Primary,
          },
        ]),
      ],
    });
    return;
  }

  const coupon = await couponRepository.getByCode({
    tenantId: draft.tenantId,
    guildId: draft.guildId,
    code: rawCoupon,
  });

  if (!coupon || !coupon.active) {
    await interaction.editReply({
      content: `Coupon \`${rawCoupon}\` is invalid or inactive.`,
      components: [
        buildButtonRow([
          {
            customId: `sale:action:${draft.id}:coupon_apply`,
            label: 'Try Another Code',
            style: ButtonStyle.Secondary,
          },
          {
            customId: `sale:action:${draft.id}:coupon_skip`,
            label: 'No Coupon',
            style: ButtonStyle.Primary,
          },
        ]),
      ],
    });
    return;
  }

  const eligibleSubtotalMinor = computeCouponEligibleSubtotalMinor(
    {
      allowedCategories: coupon.allowedCategories,
      allowedProductIds: coupon.allowedProductIds,
      allowedVariantIds: coupon.allowedVariantIds,
    },
    draft.basketItems.map((item) => ({
      category: item.category,
      productId: item.productId,
      variantId: item.variantId,
      priceMinor: item.priceMinor,
    })),
  );
  if (eligibleSubtotalMinor <= 0) {
    await interaction.editReply({
      content: `Coupon \`${rawCoupon}\` does not apply to the selected products/variations.`,
      components: [
        buildButtonRow([
          {
            customId: `sale:action:${draft.id}:coupon_apply`,
            label: 'Try Another Code',
            style: ButtonStyle.Secondary,
          },
          {
            customId: `sale:action:${draft.id}:coupon_skip`,
            label: 'No Coupon',
            style: ButtonStyle.Primary,
          },
        ]),
      ],
    });
    return;
  }

  const effectiveCouponDiscountMinor = Math.min(eligibleSubtotalMinor, coupon.discountMinor);

  draft.couponCode = coupon.code;
  draft.couponDiscountMinor = effectiveCouponDiscountMinor;
  resetPointsSelection(draft);
  updateSaleDraft(draft);

  await interaction.editReply({
    content: [
      `Coupon \`${coupon.code}\` applied (-${formatMinorCurrency(effectiveCouponDiscountMinor, draft.basketItems[0]?.currency ?? draft.defaultCurrency)}).`,
      ...buildBasketSummaryLines(draft),
      'Continue to customer details.',
    ].join('\n'),
    components: [
      buildButtonRow([
        {
          customId: `sale:action:${draft.id}:coupon_continue`,
          label: 'Continue',
          style: ButtonStyle.Primary,
        },
      ]),
    ],
  });
}

async function handleTipModal(interaction: ModalSubmitInteraction, draft: SaleDraft): Promise<void> {
  const rawTip = interaction.fields.getTextInputValue('tipAmount');

  let tipMinor = 0;
  try {
    tipMinor = parseTipToMinor(rawTip);
  } catch (error) {
    await interaction.editReply({
      content: error instanceof Error ? error.message : 'Invalid tip amount.',
      components: [
        buildButtonRow([
          {
            customId: `sale:action:${draft.id}:tip_yes`,
            label: 'Try Tip Again',
            style: ButtonStyle.Secondary,
          },
          {
            customId: `sale:action:${draft.id}:tip_skip`,
            label: 'No Tip, Continue',
            style: ButtonStyle.Primary,
          },
        ]),
      ],
    });
    return;
  }

  draft.tipMinor = tipMinor;
  resetPointsSelection(draft);
  updateSaleDraft(draft);

  await interaction.editReply({
    content: 'Checking points...',
    components: [],
  });

  await maybePromptPointsBeforeFinalize({
    draftId: draft.id,
    draft,
    interaction: {
      channel: interaction.channel,
      editReply: async (payload) => interaction.editReply(payload),
      inGuild: () => interaction.inGuild(),
    },
  });
}

export async function handleSaleModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [, , draftId, modalStepRaw] = interaction.customId.split(':');
  const modalStep = modalStepRaw ?? 'answers';

  if (!draftId) {
    await interaction.editReply({ content: 'Invalid sale draft.' });
    return;
  }

  const draft = getSaleDraft(draftId);
  if (!draft || draft.basketItems.length === 0) {
    await interaction.editReply({
      content: 'Sale draft expired. Start `/sale` again.',
    });
    return;
  }

  if (!canInteractWithDraft(draft, interaction.user.id)) {
    await interaction.editReply({
      content: 'Only the selected customer (or the staff member who started this sale) can submit this form.',
    });
    return;
  }

  if (modalStep === 'coupon') {
    await handleCouponModal(interaction, draft);
    return;
  }

  if (modalStep === 'tip') {
    await handleTipModal(interaction, draft);
    return;
  }

  await handleAnswersModal(interaction, draft);
}

export async function handleSaleCancel(interaction: Interaction): Promise<void> {
  if (!interaction.isButton() || !interaction.inGuild() || !interaction.guildId || !interaction.channel) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tenantRepo = new TenantRepository();
  const tenant = await tenantRepo.getTenantByGuildId(interaction.guildId);
  if (!tenant) {
    await interaction.editReply({
      content: 'No tenant is connected for this guild.',
    });
    return;
  }

  const cancelled = await saleService.cancelLatestPendingSession({
    tenantId: tenant.tenantId,
    guildId: interaction.guildId,
    ticketChannelId: interaction.channel.id,
  });

  if (cancelled.isErr()) {
    await interaction.editReply({
      content: cancelled.error.message,
    });
    return;
  }

  await interaction.editReply({
    content: `Cancelled pending sale session: \`${cancelled.value.orderSessionId}\``,
  });
}

export async function handleSaleButtonStart(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) {
    return;
  }

  await startSaleFlowFromButton(interaction);
}

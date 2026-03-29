import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { AppError, fromUnknownError, validationError } from '../domain/errors.js';
import type { ProductFormFieldInput } from '../domain/types.js';
import type { SessionPayload } from '../security/session-token.js';
import { ProductRepository } from '../repositories/product-repository.js';
import { TenantRepository } from '../repositories/tenant-repository.js';
import { AuthorizationService } from './authorization-service.js';

const variantSchema = z.object({
  label: z.string().min(1).max(80),
  priceMinor: z.number().int().nonnegative(),
  referralRewardMinor: z.number().int().nonnegative().optional().default(0),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  wooProductId: z.string().max(64).optional(),
  wooCheckoutPath: z.string().max(255).optional(),
});

const productSchema = z.object({
  category: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).transform((value) => value.trim()),
  active: z.boolean().default(true),
  variants: z.array(variantSchema).min(1),
});
const categorySchema = z.string().trim().min(1).max(80);

const fieldValidationSchema = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    regex: z.string().optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
  })
  .optional();

const formFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  fieldType: z.enum(['short_text', 'long_text', 'email', 'number']),
  required: z.boolean(),
  sensitive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  validation: fieldValidationSchema,
});

const formFieldsSchema = z.array(formFieldSchema).max(100);
const REQUIRED_EMAIL_FIELD_KEY = 'email';
const REQUIRED_EMAIL_FIELD_LABEL = 'What is your email?';

export class ProductService {
  private readonly productRepository = new ProductRepository();
  private readonly tenantRepository = new TenantRepository();
  private readonly authorizationService = new AuthorizationService();

  public async listProducts(
    actor: SessionPayload,
    input: { tenantId: string; guildId: string },
  ): Promise<Result<Awaited<ReturnType<ProductRepository['listByGuild']>>, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'member',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant(input);
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      const products = await this.productRepository.listByGuild(input);
      return ok(products);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async createProduct(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      product: unknown;
      formFields: unknown;
    },
  ): Promise<Result<Awaited<ReturnType<ProductRepository['create']>>, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant(input);
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      const parsedProduct = productSchema.safeParse(input.product);
      if (!parsedProduct.success) {
        return err(validationError(parsedProduct.error.issues));
      }

      const parsedFields = formFieldsSchema.safeParse(input.formFields);
      if (!parsedFields.success) {
        return err(validationError(parsedFields.error.issues));
      }

      let formFields = parsedFields.data;
      if (formFields.length === 0) {
        formFields = await this.productRepository.getCategoryFormFieldsTemplate({
          tenantId: input.tenantId,
          guildId: input.guildId,
          category: parsedProduct.data.category,
        });
      }
      formFields = this.normalizeCategoryFormFields(formFields);

      const created = await this.productRepository.create({
        tenantId: input.tenantId,
        guildId: input.guildId,
        product: parsedProduct.data,
        formFields,
      });

      return ok(created);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async updateProduct(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      productId: string;
      product: unknown;
    },
  ): Promise<Result<void, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const parsedProduct = productSchema.safeParse(input.product);
      if (!parsedProduct.success) {
        return err(validationError(parsedProduct.error.issues));
      }

      await this.productRepository.update({
        tenantId: input.tenantId,
        guildId: input.guildId,
        productId: input.productId,
        product: parsedProduct.data,
      });

      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async deleteProduct(
    actor: SessionPayload,
    input: { tenantId: string; guildId: string; productId: string },
  ): Promise<Result<void, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      await this.productRepository.delete(input);
      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async getFormFields(
    actor: SessionPayload,
    input: { tenantId: string; guildId: string; productId: string },
  ): Promise<Result<Array<{ key: string; label: string; fieldType: string; required: boolean; sensitive: boolean; sortOrder: number; validation: Record<string, unknown> | null }>, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'member',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const product = await this.productRepository.getById(input);
      if (!product) {
        return err(new AppError('PRODUCT_NOT_FOUND', 'Product not found', 404));
      }

      return ok(
        product.formFields.map((field) => ({
          key: field.fieldKey,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required,
          sensitive: field.sensitive,
          sortOrder: field.sortOrder,
          validation: field.validation,
        })),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async replaceFormFields(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      productId: string;
      formFields: unknown;
    },
  ): Promise<Result<void, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const parsedFields = formFieldsSchema.safeParse(input.formFields);
      if (!parsedFields.success) {
        return err(validationError(parsedFields.error.issues));
      }

      const product = await this.productRepository.getById({
        tenantId: input.tenantId,
        guildId: input.guildId,
        productId: input.productId,
      });
      if (!product) {
        return err(new AppError('PRODUCT_NOT_FOUND', 'Product not found', 404));
      }

      const productIdsInCategory = await this.productRepository.listProductIdsByCategory({
        tenantId: input.tenantId,
        guildId: input.guildId,
        category: product.category,
      });

      await this.productRepository.replaceFormFieldsForProducts({
        tenantId: input.tenantId,
        guildId: input.guildId,
        productIds:
          productIdsInCategory.length > 0 ? productIdsInCategory : [input.productId],
        formFields: this.normalizeCategoryFormFields(parsedFields.data),
      });

      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async renameCategory(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      category: string;
      newCategory: string;
    },
  ): Promise<Result<{ updatedProducts: number; category: string; newCategory: string }, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      const parsedCategory = categorySchema.safeParse(input.category);
      if (!parsedCategory.success) {
        return err(validationError(parsedCategory.error.issues));
      }

      const parsedNewCategory = categorySchema.safeParse(input.newCategory);
      if (!parsedNewCategory.success) {
        return err(validationError(parsedNewCategory.error.issues));
      }

      const sourceCategory = parsedCategory.data;
      const targetCategory = parsedNewCategory.data;
      if (sourceCategory.toLowerCase() === targetCategory.toLowerCase()) {
        return err(new AppError('CATEGORY_UNCHANGED', 'New category name must be different', 400));
      }

      const products = await this.productRepository.listByGuild({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      const categoriesByKey = new Map<string, string>();
      for (const product of products) {
        const key = product.category.trim().toLowerCase();
        if (!key || categoriesByKey.has(key)) {
          continue;
        }
        categoriesByKey.set(key, product.category);
      }

      const sourceResolved = categoriesByKey.get(sourceCategory.toLowerCase());
      if (!sourceResolved) {
        return err(new AppError('CATEGORY_NOT_FOUND', 'Category not found', 404));
      }

      const targetResolved = categoriesByKey.get(targetCategory.toLowerCase());
      if (targetResolved) {
        return err(
          new AppError('CATEGORY_ALREADY_EXISTS', 'Target category already exists. Use a different name.', 409),
        );
      }

      const updatedProducts = await this.productRepository.renameCategory({
        tenantId: input.tenantId,
        guildId: input.guildId,
        category: sourceResolved,
        newCategory: targetCategory,
      });

      await this.syncPointsCategoryRename({
        tenantId: input.tenantId,
        guildId: input.guildId,
        sourceCategory: sourceResolved,
        targetCategory,
      });

      return ok({
        updatedProducts,
        category: sourceResolved,
        newCategory: targetCategory,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async deleteCategory(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      category: string;
    },
  ): Promise<Result<{ deletedProducts: number; category: string }, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      const parsedCategory = categorySchema.safeParse(input.category);
      if (!parsedCategory.success) {
        return err(validationError(parsedCategory.error.issues));
      }

      const products = await this.productRepository.listByGuild({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      const categoryMap = new Map<string, string>();
      for (const product of products) {
        const key = product.category.trim().toLowerCase();
        if (!key || categoryMap.has(key)) {
          continue;
        }
        categoryMap.set(key, product.category);
      }

      const sourceResolved = categoryMap.get(parsedCategory.data.toLowerCase());
      if (!sourceResolved) {
        return err(new AppError('CATEGORY_NOT_FOUND', 'Category not found', 404));
      }

      const deletedProducts = await this.productRepository.deleteCategory({
        tenantId: input.tenantId,
        guildId: input.guildId,
        category: sourceResolved,
      });

      await this.syncPointsCategoryDelete({
        tenantId: input.tenantId,
        guildId: input.guildId,
        deletedCategory: sourceResolved,
      });

      return ok({
        deletedProducts,
        category: sourceResolved,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  private normalizeCategoryFormFields(fields: ProductFormFieldInput[]): ProductFormFieldInput[] {
    const normalized = fields.map((field) => ({
      ...field,
      key: field.key.trim(),
      label: field.label.trim(),
    }));

    const nonEmailFields = normalized
      .filter((field) => field.key.toLowerCase() !== REQUIRED_EMAIL_FIELD_KEY)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const requiredEmailField = {
      key: REQUIRED_EMAIL_FIELD_KEY,
      label: REQUIRED_EMAIL_FIELD_LABEL,
      fieldType: 'email' as const,
      required: true,
      sensitive: false,
      sortOrder: 0,
      validation: undefined,
    };

    const merged = [requiredEmailField, ...nonEmailFields];
    return merged.map((field, index) => ({
      ...field,
      sortOrder: index,
    }));
  }

  private normalizeCategoryKey(category: string): string {
    return category.trim().toLowerCase();
  }

  private replaceCategoryKey(
    categories: string[],
    sourceCategory: string,
    targetCategory: string,
  ): string[] {
    const sourceKey = this.normalizeCategoryKey(sourceCategory);
    const targetKey = this.normalizeCategoryKey(targetCategory);
    const output: string[] = [];
    const seen = new Set<string>();

    for (const category of categories) {
      const normalized = this.normalizeCategoryKey(category);
      const nextCategory = normalized === sourceKey ? targetCategory : category;
      const nextNormalized = this.normalizeCategoryKey(nextCategory);
      if (!nextNormalized || seen.has(nextNormalized)) {
        continue;
      }

      seen.add(nextNormalized);
      output.push(nextNormalized === targetKey ? targetCategory : nextCategory);
    }

    return output;
  }

  private removeCategoryKey(categories: string[], deletedCategory: string): string[] {
    const deletedKey = this.normalizeCategoryKey(deletedCategory);
    const output: string[] = [];
    const seen = new Set<string>();

    for (const category of categories) {
      const normalized = this.normalizeCategoryKey(category);
      if (!normalized || normalized === deletedKey || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      output.push(category);
    }

    return output;
  }

  private async syncPointsCategoryRename(input: {
    tenantId: string;
    guildId: string;
    sourceCategory: string;
    targetCategory: string;
  }): Promise<void> {
    const config = await this.tenantRepository.getGuildConfig({
      tenantId: input.tenantId,
      guildId: input.guildId,
    });
    if (!config) {
      return;
    }

    const nextEarn = this.replaceCategoryKey(
      config.pointsEarnCategoryKeys,
      input.sourceCategory,
      input.targetCategory,
    );
    const nextRedeem = this.replaceCategoryKey(
      config.pointsRedeemCategoryKeys,
      input.sourceCategory,
      input.targetCategory,
    );

    await this.tenantRepository.upsertGuildConfig({
      tenantId: input.tenantId,
      guildId: input.guildId,
      paidLogChannelId: config.paidLogChannelId,
      staffRoleIds: config.staffRoleIds,
      defaultCurrency: config.defaultCurrency,
      couponsEnabled: config.couponsEnabled,
      pointsEnabled: config.pointsEnabled,
      referralsEnabled: config.referralsEnabled,
      telegramEnabled: config.telegramEnabled,
      tipEnabled: config.tipEnabled,
      pointsEarnCategoryKeys: nextEarn,
      pointsRedeemCategoryKeys: nextRedeem,
      pointValueMinor: config.pointValueMinor,
      referralRewardMinor: config.referralRewardMinor,
      referralRewardCategoryKeys: this.replaceCategoryKey(
        config.referralRewardCategoryKeys,
        input.sourceCategory,
        input.targetCategory,
      ),
      referralLogChannelId: config.referralLogChannelId,
      referralThankYouTemplate: config.referralThankYouTemplate,
      referralSubmissionTemplate: config.referralSubmissionTemplate,
      ticketMetadataKey: config.ticketMetadataKey,
      salesHistoryClearedAt: config.salesHistoryClearedAt,
      salesHistoryAutoClearEnabled: config.salesHistoryAutoClearEnabled,
      salesHistoryAutoClearFrequency: config.salesHistoryAutoClearFrequency,
      salesHistoryAutoClearLocalTimeHhMm: config.salesHistoryAutoClearLocalTimeHhMm,
      salesHistoryAutoClearTimezone: config.salesHistoryAutoClearTimezone,
      salesHistoryAutoClearDayOfWeek: config.salesHistoryAutoClearDayOfWeek,
      salesHistoryAutoClearDayOfMonth: config.salesHistoryAutoClearDayOfMonth,
      salesHistoryAutoClearNextRunAtUtc: config.salesHistoryAutoClearNextRunAtUtc,
      salesHistoryAutoClearLastRunAtUtc: config.salesHistoryAutoClearLastRunAtUtc,
      salesHistoryAutoClearLastLocalRunDate: config.salesHistoryAutoClearLastLocalRunDate,
    });
  }

  private async syncPointsCategoryDelete(input: {
    tenantId: string;
    guildId: string;
    deletedCategory: string;
  }): Promise<void> {
    const config = await this.tenantRepository.getGuildConfig({
      tenantId: input.tenantId,
      guildId: input.guildId,
    });
    if (!config) {
      return;
    }

    const nextEarn = this.removeCategoryKey(config.pointsEarnCategoryKeys, input.deletedCategory);
    const nextRedeem = this.removeCategoryKey(config.pointsRedeemCategoryKeys, input.deletedCategory);

    await this.tenantRepository.upsertGuildConfig({
      tenantId: input.tenantId,
      guildId: input.guildId,
      paidLogChannelId: config.paidLogChannelId,
      staffRoleIds: config.staffRoleIds,
      defaultCurrency: config.defaultCurrency,
      couponsEnabled: config.couponsEnabled,
      pointsEnabled: config.pointsEnabled,
      referralsEnabled: config.referralsEnabled,
      telegramEnabled: config.telegramEnabled,
      tipEnabled: config.tipEnabled,
      pointsEarnCategoryKeys: nextEarn,
      pointsRedeemCategoryKeys: nextRedeem,
      pointValueMinor: config.pointValueMinor,
      referralRewardMinor: config.referralRewardMinor,
      referralRewardCategoryKeys: this.removeCategoryKey(
        config.referralRewardCategoryKeys,
        input.deletedCategory,
      ),
      referralLogChannelId: config.referralLogChannelId,
      referralThankYouTemplate: config.referralThankYouTemplate,
      referralSubmissionTemplate: config.referralSubmissionTemplate,
      ticketMetadataKey: config.ticketMetadataKey,
      salesHistoryClearedAt: config.salesHistoryClearedAt,
      salesHistoryAutoClearEnabled: config.salesHistoryAutoClearEnabled,
      salesHistoryAutoClearFrequency: config.salesHistoryAutoClearFrequency,
      salesHistoryAutoClearLocalTimeHhMm: config.salesHistoryAutoClearLocalTimeHhMm,
      salesHistoryAutoClearTimezone: config.salesHistoryAutoClearTimezone,
      salesHistoryAutoClearDayOfWeek: config.salesHistoryAutoClearDayOfWeek,
      salesHistoryAutoClearDayOfMonth: config.salesHistoryAutoClearDayOfMonth,
      salesHistoryAutoClearNextRunAtUtc: config.salesHistoryAutoClearNextRunAtUtc,
      salesHistoryAutoClearLastRunAtUtc: config.salesHistoryAutoClearLastRunAtUtc,
      salesHistoryAutoClearLastLocalRunDate: config.salesHistoryAutoClearLastLocalRunDate,
    });
  }
}


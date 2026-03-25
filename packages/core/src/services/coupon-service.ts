import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { AppError, fromUnknownError, validationError } from '../domain/errors.js';
import type { SessionPayload } from '../security/session-token.js';
import { CouponRepository } from '../repositories/coupon-repository.js';
import { ProductRepository } from '../repositories/product-repository.js';
import { AuthorizationService } from './authorization-service.js';
import { GuildFeatureService } from './guild-feature-service.js';

const idListSchema = z
  .array(z.string().trim().min(1).max(64))
  .default([])
  .transform((values) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))));

const categoryListSchema = z
  .array(z.string().trim().min(1).max(80))
  .default([])
  .transform((values) => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      const trimmed = value.trim();
      const normalized = trimmed.toLowerCase();
      if (!trimmed || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      result.push(trimmed);
    }

    return result;
  });

const couponPayloadSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Coupon code can only include letters, numbers, "_" and "-".')
    .transform((value) => value.toUpperCase()),
  discountMinor: z.number().int().positive(),
  active: z.boolean().default(true),
  allowedCategories: categoryListSchema,
  allowedProductIds: idListSchema,
  allowedVariantIds: idListSchema,
});

export class CouponService {
  private readonly couponRepository = new CouponRepository();
  private readonly productRepository = new ProductRepository();
  private readonly authorizationService = new AuthorizationService();
  private readonly guildFeatureService = new GuildFeatureService();

  public async listCoupons(
    actor: SessionPayload,
    input: { tenantId: string; guildId: string },
  ): Promise<
    Result<
      Array<{
        id: string;
        code: string;
        discountMinor: number;
        active: boolean;
        allowedCategories: string[];
        allowedProductIds: string[];
        allowedVariantIds: string[];
      }>,
      AppError
    >
  > {
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

      const coupons = await this.couponRepository.listByGuild(input);
      return ok(
        coupons.map((coupon) => ({
          id: coupon.id,
          code: coupon.code,
          discountMinor: coupon.discountMinor,
          active: coupon.active,
          allowedCategories: coupon.allowedCategories,
          allowedProductIds: coupon.allowedProductIds,
          allowedVariantIds: coupon.allowedVariantIds,
        })),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async createCoupon(
    actor: SessionPayload,
    input: { tenantId: string; guildId: string; coupon: unknown },
  ): Promise<
    Result<
      {
        id: string;
        code: string;
        discountMinor: number;
        active: boolean;
        allowedCategories: string[];
        allowedProductIds: string[];
        allowedVariantIds: string[];
      },
      AppError
    >
  > {
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

      const featureCheck = await this.guildFeatureService.ensureFeatureEnabled({
        tenantId: input.tenantId,
        guildId: input.guildId,
        feature: 'coupons',
      });
      if (featureCheck.isErr()) {
        return err(featureCheck.error);
      }

      const parsed = couponPayloadSchema.safeParse(input.coupon);
      if (!parsed.success) {
        return err(validationError(parsed.error.issues));
      }

      const scopeValidation = await this.validateCouponScopes({
        tenantId: input.tenantId,
        guildId: input.guildId,
        allowedCategories: parsed.data.allowedCategories,
        allowedProductIds: parsed.data.allowedProductIds,
        allowedVariantIds: parsed.data.allowedVariantIds,
      });
      if (scopeValidation.isErr()) {
        return err(scopeValidation.error);
      }

      try {
        const created = await this.couponRepository.create({
          tenantId: input.tenantId,
          guildId: input.guildId,
          code: parsed.data.code,
          discountMinor: parsed.data.discountMinor,
          active: parsed.data.active,
          allowedCategories: parsed.data.allowedCategories,
          allowedProductIds: parsed.data.allowedProductIds,
          allowedVariantIds: parsed.data.allowedVariantIds,
        });

        return ok({
          id: created.id,
          code: created.code,
          discountMinor: created.discountMinor,
          active: created.active,
          allowedCategories: created.allowedCategories,
          allowedProductIds: created.allowedProductIds,
          allowedVariantIds: created.allowedVariantIds,
        });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'ER_DUP_ENTRY'
        ) {
          return err(new AppError('COUPON_ALREADY_EXISTS', 'Coupon code already exists for this server', 409));
        }

        throw error;
      }
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async updateCoupon(
    actor: SessionPayload,
    input: { tenantId: string; guildId: string; couponId: string; coupon: unknown },
  ): Promise<Result<void, AppError>> {
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

      const featureCheck = await this.guildFeatureService.ensureFeatureEnabled({
        tenantId: input.tenantId,
        guildId: input.guildId,
        feature: 'coupons',
      });
      if (featureCheck.isErr()) {
        return err(featureCheck.error);
      }

      const parsed = couponPayloadSchema.safeParse(input.coupon);
      if (!parsed.success) {
        return err(validationError(parsed.error.issues));
      }

      const scopeValidation = await this.validateCouponScopes({
        tenantId: input.tenantId,
        guildId: input.guildId,
        allowedCategories: parsed.data.allowedCategories,
        allowedProductIds: parsed.data.allowedProductIds,
        allowedVariantIds: parsed.data.allowedVariantIds,
      });
      if (scopeValidation.isErr()) {
        return err(scopeValidation.error);
      }

      try {
        await this.couponRepository.update({
          tenantId: input.tenantId,
          guildId: input.guildId,
          couponId: input.couponId,
          code: parsed.data.code,
          discountMinor: parsed.data.discountMinor,
          active: parsed.data.active,
          allowedCategories: parsed.data.allowedCategories,
          allowedProductIds: parsed.data.allowedProductIds,
          allowedVariantIds: parsed.data.allowedVariantIds,
        });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'ER_DUP_ENTRY'
        ) {
          return err(new AppError('COUPON_ALREADY_EXISTS', 'Coupon code already exists for this server', 409));
        }

        throw error;
      }

      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async deleteCoupon(
    actor: SessionPayload,
    input: { tenantId: string; guildId: string; couponId: string },
  ): Promise<Result<void, AppError>> {
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

      const featureCheck = await this.guildFeatureService.ensureFeatureEnabled({
        tenantId: input.tenantId,
        guildId: input.guildId,
        feature: 'coupons',
      });
      if (featureCheck.isErr()) {
        return err(featureCheck.error);
      }

      await this.couponRepository.delete(input);
      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  private async validateCouponScopes(input: {
    tenantId: string;
    guildId: string;
    allowedCategories: string[];
    allowedProductIds: string[];
    allowedVariantIds: string[];
  }): Promise<Result<void, AppError>> {
    if (
      input.allowedCategories.length === 0 &&
      input.allowedProductIds.length === 0 &&
      input.allowedVariantIds.length === 0
    ) {
      return ok(undefined);
    }

    const products = await this.productRepository.listByGuild({
      tenantId: input.tenantId,
      guildId: input.guildId,
    });
    const validCategoryKeys = new Set(products.map((product) => product.category.trim().toLowerCase()).filter(Boolean));
    const validProductIds = new Set(products.map((product) => product.id));
    const validVariantIds = new Set(
      products.flatMap((product) => product.variants.map((variant) => variant.id)),
    );

    const invalidCategories = input.allowedCategories.filter(
      (category) => !validCategoryKeys.has(category.trim().toLowerCase()),
    );
    const invalidProductIds = input.allowedProductIds.filter((productId) => !validProductIds.has(productId));
    const invalidVariantIds = input.allowedVariantIds.filter((variantId) => !validVariantIds.has(variantId));

    if (invalidCategories.length > 0 || invalidProductIds.length > 0 || invalidVariantIds.length > 0) {
      const details = [
        invalidCategories.length > 0
          ? `unknown categories: ${invalidCategories.slice(0, 5).join(', ')}`
          : null,
        invalidProductIds.length > 0
          ? `unknown product IDs: ${invalidProductIds.slice(0, 5).join(', ')}`
          : null,
        invalidVariantIds.length > 0
          ? `unknown variation IDs: ${invalidVariantIds.slice(0, 5).join(', ')}`
          : null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join('; ');
      return err(new AppError('COUPON_SCOPE_INVALID', `Coupon scope is invalid (${details}).`, 400));
    }

    return ok(undefined);
  }
}

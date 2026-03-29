import { err, ok, type Result } from 'neverthrow';
import crypto from 'node:crypto';
import { ulid } from 'ulid';
import { z } from 'zod';

import { getEnv } from '../config/env.js';
import { AppError, fromUnknownError, validationError } from '../domain/errors.js';
import { decryptSecret, encryptSecret } from '../security/encryption.js';
import type { SessionPayload } from '../security/session-token.js';
import { IntegrationRepository } from '../repositories/integration-repository.js';
import { AuthorizationService } from './authorization-service.js';

export const DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN = 'checkout.voodoo-pay.uk';

const integrationInputSchema = z.object({
  wpBaseUrl: z.string().url(),
  webhookSecret: z.string().min(8).max(255),
  consumerKey: z.string().min(8).max(255),
  consumerSecret: z.string().min(8).max(255),
});

const voodooIntegrationInputSchema = z.object({
  merchantWalletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'merchantWalletAddress must be a valid Polygon wallet address'),
  checkoutDomain: z.string().max(255).optional().default(DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN),
  callbackSecret: z.string().min(16).max(255).optional(),
  cryptoGatewayEnabled: z.boolean().default(false),
  cryptoAddFees: z.boolean().default(false),
  cryptoWallets: z
    .object({
      evm: z.string().max(191).optional(),
      btc: z.string().max(191).optional(),
      bitcoincash: z.string().max(191).optional(),
      ltc: z.string().max(191).optional(),
      doge: z.string().max(191).optional(),
      trc20: z.string().max(191).optional(),
      solana: z.string().max(191).optional(),
    })
    .default({}),
});

export function normalizeCheckoutDomain(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).host;
    } catch {
      candidate = candidate.replace(/^https?:\/\//i, '');
    }
  }

  candidate = candidate.replace(/^https?:\/\//i, '');
  const pathSeparatorIndex = candidate.indexOf('/');
  if (pathSeparatorIndex >= 0) {
    candidate = candidate.slice(0, pathSeparatorIndex);
  }

  return candidate.replace(/\/+$/, '').trim().toLowerCase();
}

function normalizeCryptoWallets(input: {
  evm?: string;
  btc?: string;
  bitcoincash?: string;
  ltc?: string;
  doge?: string;
  trc20?: string;
  solana?: string;
}): {
  evm: string | null;
  btc: string | null;
  bitcoincash: string | null;
  ltc: string | null;
  doge: string | null;
  trc20: string | null;
  solana: string | null;
} {
  const normalize = (value?: string): string | null => {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    evm: normalize(input.evm),
    btc: normalize(input.btc),
    bitcoincash: normalize(input.bitcoincash),
    ltc: normalize(input.ltc),
    doge: normalize(input.doge),
    trc20: normalize(input.trc20),
    solana: normalize(input.solana),
  };
}

export function hasAnyCryptoWallet(input: {
  evm: string | null;
  btc: string | null;
  bitcoincash: string | null;
  ltc: string | null;
  doge: string | null;
  trc20: string | null;
  solana: string | null;
}): boolean {
  return Object.values(input).some((value) => typeof value === 'string' && value.trim().length > 0);
}

export type WooIntegrationResolved = {
  tenantId: string;
  guildId: string;
  wpBaseUrl: string;
  tenantWebhookKey: string;
  webhookSecret: string;
  consumerKey: string;
  consumerSecret: string;
};

export type VoodooPayIntegrationResolved = {
  tenantId: string;
  guildId: string;
  merchantWalletAddress: string;
  cryptoGatewayEnabled: boolean;
  cryptoAddFees: boolean;
  cryptoWallets: {
    evm: string | null;
    btc: string | null;
    bitcoincash: string | null;
    ltc: string | null;
    doge: string | null;
    trc20: string | null;
    solana: string | null;
  };
  checkoutDomain: string;
  tenantWebhookKey: string;
  callbackSecret: string;
};

export class IntegrationService {
  private readonly env = getEnv();
  private readonly integrationRepository = new IntegrationRepository();
  private readonly authorizationService = new AuthorizationService();

  public async upsertWooConfig(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      payload: unknown;
    },
  ): Promise<Result<{ webhookUrl: string; tenantWebhookKey: string }, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const parsed = integrationInputSchema.safeParse(input.payload);
      if (!parsed.success) {
        return err(validationError(parsed.error.issues));
      }

      const webhookKey = ulid().toLowerCase();
      const config = parsed.data;

      await this.integrationRepository.upsertWooIntegration({
        tenantId: input.tenantId,
        guildId: input.guildId,
        wpBaseUrl: config.wpBaseUrl,
        tenantWebhookKey: webhookKey,
        webhookSecretEncrypted: encryptSecret(config.webhookSecret, this.env.ENCRYPTION_KEY),
        consumerKeyEncrypted: encryptSecret(config.consumerKey, this.env.ENCRYPTION_KEY),
        consumerSecretEncrypted: encryptSecret(config.consumerSecret, this.env.ENCRYPTION_KEY),
      });

      return ok({
        webhookUrl: `${this.env.BOT_PUBLIC_URL}/api/webhooks/woocommerce/${webhookKey}`,
        tenantWebhookKey: webhookKey,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async upsertVoodooPayConfig(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      payload: unknown;
    },
  ): Promise<
    Result<
      { webhookUrl: string; tenantWebhookKey: string; callbackSecretGenerated: string | null },
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

      const parsed = voodooIntegrationInputSchema.safeParse(input.payload);
      if (!parsed.success) {
        return err(validationError(parsed.error.issues));
      }

      const config = parsed.data;
      const checkoutDomain = DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN;
      const cryptoWallets = normalizeCryptoWallets(config.cryptoWallets);
      if (config.cryptoGatewayEnabled && !hasAnyCryptoWallet(cryptoWallets)) {
        return err(
          new AppError(
            'VOODOO_PAY_CRYPTO_WALLET_REQUIRED',
            'At least one crypto wallet is required when crypto gateway is enabled.',
            422,
          ),
        );
      }
      const existing = await this.integrationRepository.getVoodooPayIntegrationByGuild({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      const webhookKey = existing?.tenantWebhookKey ?? ulid().toLowerCase();
      const providedCallbackSecret = config.callbackSecret?.trim();

      let callbackSecretEncrypted = existing?.callbackSecretEncrypted ?? '';
      let callbackSecretGenerated: string | null = null;

      if (providedCallbackSecret) {
        callbackSecretEncrypted = encryptSecret(providedCallbackSecret, this.env.ENCRYPTION_KEY);
      } else if (!existing) {
        callbackSecretGenerated = crypto.randomBytes(32).toString('hex');
        callbackSecretEncrypted = encryptSecret(callbackSecretGenerated, this.env.ENCRYPTION_KEY);
      }

      await this.integrationRepository.upsertVoodooPayIntegration({
        tenantId: input.tenantId,
        guildId: input.guildId,
        merchantWalletAddress: config.merchantWalletAddress,
        cryptoGatewayEnabled: config.cryptoGatewayEnabled,
        cryptoAddFees: config.cryptoAddFees,
        cryptoWallets,
        checkoutDomain,
        tenantWebhookKey: webhookKey,
        callbackSecretEncrypted,
      });

      return ok({
        webhookUrl: `${this.env.BOT_PUBLIC_URL}/api/webhooks/voodoopay/${webhookKey}`,
        tenantWebhookKey: webhookKey,
        callbackSecretGenerated,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async getResolvedWooIntegrationByGuild(input: {
    tenantId: string;
    guildId: string;
  }): Promise<Result<WooIntegrationResolved, AppError>> {
    try {
      const row = await this.integrationRepository.getWooIntegrationByGuild(input);
      if (!row) {
        return err(new AppError('WOO_INTEGRATION_NOT_CONFIGURED', 'Woo integration is not configured', 404));
      }

      return ok({
        tenantId: row.tenantId,
        guildId: row.guildId,
        wpBaseUrl: row.wpBaseUrl,
        tenantWebhookKey: row.tenantWebhookKey,
        webhookSecret: decryptSecret(row.webhookSecretEncrypted, this.env.ENCRYPTION_KEY),
        consumerKey: decryptSecret(row.consumerKeyEncrypted, this.env.ENCRYPTION_KEY),
        consumerSecret: decryptSecret(row.consumerSecretEncrypted, this.env.ENCRYPTION_KEY),
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async getResolvedVoodooPayIntegrationByGuild(input: {
    tenantId: string;
    guildId: string;
  }): Promise<Result<VoodooPayIntegrationResolved, AppError>> {
    try {
      const row = await this.integrationRepository.getVoodooPayIntegrationByGuild(input);
      if (!row) {
        return err(
          new AppError('VOODOO_PAY_INTEGRATION_NOT_CONFIGURED', 'Voodoo Pay integration is not configured', 404),
        );
      }

      return ok({
        tenantId: row.tenantId,
        guildId: row.guildId,
        merchantWalletAddress: row.merchantWalletAddress,
        cryptoGatewayEnabled: row.cryptoGatewayEnabled,
        cryptoAddFees: row.cryptoAddFees,
        cryptoWallets: row.cryptoWallets,
        checkoutDomain: DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN,
        tenantWebhookKey: row.tenantWebhookKey,
        callbackSecret: decryptSecret(row.callbackSecretEncrypted, this.env.ENCRYPTION_KEY),
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async getResolvedWooIntegrationByWebhookKey(
    tenantWebhookKey: string,
  ): Promise<Result<WooIntegrationResolved, AppError>> {
    try {
      const row = await this.integrationRepository.getWooIntegrationByWebhookKey(tenantWebhookKey);
      if (!row) {
        return err(new AppError('WOO_INTEGRATION_NOT_FOUND', 'Woo integration not found', 404));
      }

      return ok({
        tenantId: row.tenantId,
        guildId: row.guildId,
        wpBaseUrl: row.wpBaseUrl,
        tenantWebhookKey: row.tenantWebhookKey,
        webhookSecret: decryptSecret(row.webhookSecretEncrypted, this.env.ENCRYPTION_KEY),
        consumerKey: decryptSecret(row.consumerKeyEncrypted, this.env.ENCRYPTION_KEY),
        consumerSecret: decryptSecret(row.consumerSecretEncrypted, this.env.ENCRYPTION_KEY),
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async getResolvedVoodooPayIntegrationByWebhookKey(
    tenantWebhookKey: string,
  ): Promise<Result<VoodooPayIntegrationResolved, AppError>> {
    try {
      const row = await this.integrationRepository.getVoodooPayIntegrationByWebhookKey(tenantWebhookKey);
      if (!row) {
        return err(new AppError('VOODOO_PAY_INTEGRATION_NOT_FOUND', 'Voodoo Pay integration not found', 404));
      }

      return ok({
        tenantId: row.tenantId,
        guildId: row.guildId,
        merchantWalletAddress: row.merchantWalletAddress,
        cryptoGatewayEnabled: row.cryptoGatewayEnabled,
        cryptoAddFees: row.cryptoAddFees,
        cryptoWallets: row.cryptoWallets,
        checkoutDomain: DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN,
        tenantWebhookKey: row.tenantWebhookKey,
        callbackSecret: decryptSecret(row.callbackSecretEncrypted, this.env.ENCRYPTION_KEY),
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }
}

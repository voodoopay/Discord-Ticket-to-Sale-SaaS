import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from 'neverthrow';

import { getEnv, resetEnvForTests } from '../src/config/env.js';
import type { VoodooPayIntegrationRecord } from '../src/repositories/integration-repository.js';
import { encryptSecret } from '../src/security/encryption.js';
import type { SessionPayload } from '../src/security/session-token.js';
import {
  DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN,
  IntegrationService,
} from '../src/services/integration-service.js';

function makeSession(): SessionPayload {
  return {
    userId: 'user-1',
    discordUserId: 'discord-user-1',
    isSuperAdmin: false,
    tenantIds: ['tenant-1'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

function makeIntegrationRecord(
  overrides: Partial<VoodooPayIntegrationRecord> = {},
): VoodooPayIntegrationRecord {
  return {
    id: 'integration-1',
    tenantId: 'tenant-1',
    guildId: 'guild-1',
    merchantWalletAddress: '0x1234567890123456789012345678901234567890',
    cryptoGatewayEnabled: false,
    cryptoAddFees: false,
    cryptoWallets: {
      evm: null,
      btc: null,
      bitcoincash: null,
      ltc: null,
      doge: null,
      trc20: null,
      solana: null,
    },
    checkoutDomain: DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN,
    tenantWebhookKey: 'tenant-webhook-key',
    callbackSecretEncrypted: encryptSecret(
      'callback-secret-1234567890abcdef',
      getEnv().ENCRYPTION_KEY,
    ),
    ...overrides,
  };
}

describe('voodoo pay integration service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTests();
  });

  it('persists the fixed checkout domain for first-time saves', async () => {
    const service = new IntegrationService();

    vi.spyOn((service as any).authorizationService, 'ensureTenantRole').mockResolvedValue(ok(undefined));
    vi.spyOn((service as any).integrationRepository, 'getVoodooPayIntegrationByGuild').mockResolvedValue(null);
    const upsertSpy = vi
      .spyOn((service as any).integrationRepository, 'upsertVoodooPayIntegration')
      .mockResolvedValue(makeIntegrationRecord());

    const result = await service.upsertVoodooPayConfig(makeSession(), {
      tenantId: 'tenant-1',
      guildId: 'guild-1',
      payload: {
        merchantWalletAddress: '0x1234567890123456789012345678901234567890',
        checkoutDomain: 'merchant.example.com',
        cryptoGatewayEnabled: false,
        cryptoAddFees: false,
        cryptoWallets: {},
      },
    });

    expect(result.isOk()).toBe(true);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutDomain: DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN,
      }),
    );
  });

  it('resolves the fixed checkout domain even if an older record stored another host', async () => {
    const service = new IntegrationService();

    vi.spyOn((service as any).integrationRepository, 'getVoodooPayIntegrationByGuild').mockResolvedValue(
      makeIntegrationRecord({
        checkoutDomain: 'merchant.example.com',
      }),
    );

    const result = await service.getResolvedVoodooPayIntegrationByGuild({
      tenantId: 'tenant-1',
      guildId: 'guild-1',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.checkoutDomain).toBe(DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN);
  });
});

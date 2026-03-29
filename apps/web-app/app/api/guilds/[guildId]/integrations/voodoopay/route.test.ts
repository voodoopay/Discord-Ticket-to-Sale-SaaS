import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getResolvedVoodooPayIntegrationByGuild, upsertVoodooPayConfig } = vi.hoisted(() => ({
  getResolvedVoodooPayIntegrationByGuild: vi.fn(),
  upsertVoodooPayConfig: vi.fn(),
}));

const requireSession = vi.hoisted(() => vi.fn());

vi.mock('@voodoo/core', () => ({
  DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN: 'checkout.voodoo-pay.uk',
  IntegrationService: class {
    public getResolvedVoodooPayIntegrationByGuild = getResolvedVoodooPayIntegrationByGuild;
    public upsertVoodooPayConfig = upsertVoodooPayConfig;
  },
  getEnv: () => ({
    BOT_PUBLIC_URL: 'https://voodoopaybot.online',
  }),
}));

vi.mock('@/lib/http', () => ({
  requireSession,
  jsonError: vi.fn((error: unknown) => {
    throw error;
  }),
  readJson: vi.fn(async (request: NextRequest) => await request.json()),
}));

import { PUT } from './route';

describe('voodoo pay integration route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSession.mockResolvedValue({
      ok: true,
      session: {
        userId: 'user-1',
        discordUserId: 'discord-user-1',
        isSuperAdmin: false,
        tenantIds: ['tenant-1'],
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    getResolvedVoodooPayIntegrationByGuild.mockResolvedValue({
      isErr: () => true,
      isOk: () => false,
      error: {
        statusCode: 404,
        message: 'Voodoo Pay integration is not configured',
      },
    });
    upsertVoodooPayConfig.mockResolvedValue({
      isErr: () => false,
      isOk: () => true,
      value: {
        webhookUrl: 'https://voodoopaybot.online/api/webhooks/voodoopay/tenant-webhook-key',
        tenantWebhookKey: 'tenant-webhook-key',
        callbackSecretGenerated: 'generated-secret',
      },
    });
  });

  it('forces the fixed checkout domain during saves', async () => {
    const response = await PUT(
      new NextRequest('https://voodoopaybot.online/api/guilds/guild-1/integrations/voodoopay', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId: 'tenant-1',
          merchantWalletAddress: '0x1234567890123456789012345678901234567890',
          checkoutDomain: 'merchant.example.com',
          cryptoGatewayEnabled: false,
          cryptoAddFees: false,
          cryptoWallets: {},
        }),
      }),
      {
        params: Promise.resolve({
          guildId: 'guild-1',
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(upsertVoodooPayConfig).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        payload: expect.objectContaining({
          checkoutDomain: 'checkout.voodoo-pay.uk',
        }),
      }),
    );
  });
});

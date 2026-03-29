import { DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN, IntegrationService, getEnv } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, readJson, requireSession } from '@/lib/http';

const integrationService = new IntegrationService();
const env = getEnv();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId query parameter' }, { status: 400 });
    }

    const { guildId } = await context.params;
    const result = await integrationService.getResolvedVoodooPayIntegrationByGuild({
      tenantId,
      guildId,
    });

    if (result.isErr()) {
      if (result.error.statusCode === 404) {
        return NextResponse.json({ integration: null });
      }

      return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode });
    }

    return NextResponse.json({
      integration: {
        merchantWalletAddress: result.value.merchantWalletAddress,
        cryptoGatewayEnabled: result.value.cryptoGatewayEnabled,
        cryptoAddFees: result.value.cryptoAddFees,
        cryptoWallets: result.value.cryptoWallets,
        checkoutDomain: result.value.checkoutDomain,
        tenantWebhookKey: result.value.tenantWebhookKey,
        webhookUrl: `${env.BOT_PUBLIC_URL}/api/webhooks/voodoopay/${result.value.tenantWebhookKey}`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ guildId: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const { guildId } = await context.params;
    const body = await readJson<{
      tenantId: string;
      merchantWalletAddress: string;
      checkoutDomain?: string;
      callbackSecret?: string;
      cryptoGatewayEnabled?: boolean;
      cryptoAddFees?: boolean;
      cryptoWallets?: {
        evm?: string;
        btc?: string;
        bitcoincash?: string;
        ltc?: string;
        doge?: string;
        trc20?: string;
        solana?: string;
      };
    }>(request);

    const existing = await integrationService.getResolvedVoodooPayIntegrationByGuild({
      tenantId: body.tenantId,
      guildId,
    });
    if (existing.isErr() && existing.error.statusCode !== 404) {
      return NextResponse.json({ error: existing.error.message }, { status: existing.error.statusCode });
    }

    const existingWallets = existing.isOk()
      ? {
          evm: existing.value.cryptoWallets.evm ?? undefined,
          btc: existing.value.cryptoWallets.btc ?? undefined,
          bitcoincash: existing.value.cryptoWallets.bitcoincash ?? undefined,
          ltc: existing.value.cryptoWallets.ltc ?? undefined,
          doge: existing.value.cryptoWallets.doge ?? undefined,
          trc20: existing.value.cryptoWallets.trc20 ?? undefined,
          solana: existing.value.cryptoWallets.solana ?? undefined,
        }
      : {};

    const result = await integrationService.upsertVoodooPayConfig(auth.session, {
      tenantId: body.tenantId,
      guildId,
      payload: {
        merchantWalletAddress: body.merchantWalletAddress,
        checkoutDomain: DEFAULT_VOODOO_PAY_CHECKOUT_DOMAIN,
        callbackSecret: body.callbackSecret,
        cryptoGatewayEnabled: body.cryptoGatewayEnabled ?? (existing.isOk() ? existing.value.cryptoGatewayEnabled : false),
        cryptoAddFees: body.cryptoAddFees ?? (existing.isOk() ? existing.value.cryptoAddFees : false),
        cryptoWallets: body.cryptoWallets ?? existingWallets,
      },
    });

    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode });
    }

    return NextResponse.json(result.value);
  } catch (error) {
    return jsonError(error);
  }
}

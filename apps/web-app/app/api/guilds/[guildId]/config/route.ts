import { TenantService } from '@voodoo/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { jsonError, readJson, requireSession } from '@/lib/http';

const tenantService = new TenantService();
const DEFAULT_REFERRAL_THANK_YOU_TEMPLATE =
  'Thanks for your referral. You earned {points} point(s) ({amount_gbp} GBP) after {referred_email} paid.';
const DEFAULT_REFERRAL_SUBMISSION_TEMPLATE =
  'Referral submitted successfully. We will reward points automatically after the first paid order.';

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
    const result = await tenantService.getGuildConfig(auth.session, {
      tenantId,
      guildId,
    });

    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode });
    }

    return NextResponse.json({ config: result.value });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
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
      paidLogChannelId: string | null;
      staffRoleIds: string[];
      defaultCurrency: string;
      couponsEnabled?: boolean;
      pointsEnabled?: boolean;
      referralsEnabled?: boolean;
      telegramEnabled?: boolean;
      tipEnabled?: boolean;
      pointsEarnCategoryKeys?: string[];
      pointsRedeemCategoryKeys?: string[];
      pointValueMinor?: number;
      referralRewardMinor?: number;
      referralRewardCategoryKeys?: string[];
      referralLogChannelId?: string | null;
      referralThankYouTemplate?: string;
      referralSubmissionTemplate?: string;
      ticketMetadataKey?: string;
      joinGateEnabled?: boolean;
      joinGateFallbackChannelId?: string | null;
      joinGateVerifiedRoleId?: string | null;
      joinGateTicketCategoryId?: string | null;
      joinGateCurrentLookupChannelId?: string | null;
      joinGateNewLookupChannelId?: string | null;
    }>(request);

    const result = await tenantService.updateGuildConfig(auth.session, {
      tenantId: body.tenantId,
      guildId,
      paidLogChannelId: body.paidLogChannelId,
      staffRoleIds: body.staffRoleIds,
      defaultCurrency: body.defaultCurrency,
      couponsEnabled: body.couponsEnabled ?? true,
      pointsEnabled: body.pointsEnabled ?? true,
      referralsEnabled: body.referralsEnabled ?? true,
      telegramEnabled: body.telegramEnabled ?? false,
      tipEnabled: body.tipEnabled ?? false,
      pointsEarnCategoryKeys: body.pointsEarnCategoryKeys ?? [],
      pointsRedeemCategoryKeys: body.pointsRedeemCategoryKeys ?? [],
      pointValueMinor: Math.max(1, body.pointValueMinor ?? 1),
      referralRewardMinor: Math.max(0, body.referralRewardMinor ?? 0),
      referralRewardCategoryKeys: body.referralRewardCategoryKeys ?? [],
      referralLogChannelId: body.referralLogChannelId ?? null,
      referralThankYouTemplate:
        typeof body.referralThankYouTemplate === 'string' && body.referralThankYouTemplate.trim().length > 0
          ? body.referralThankYouTemplate.trim()
          : DEFAULT_REFERRAL_THANK_YOU_TEMPLATE,
      referralSubmissionTemplate:
        typeof body.referralSubmissionTemplate === 'string' && body.referralSubmissionTemplate.trim().length > 0
          ? body.referralSubmissionTemplate.trim()
          : DEFAULT_REFERRAL_SUBMISSION_TEMPLATE,
      ticketMetadataKey: body.ticketMetadataKey ?? 'isTicket',
      joinGateEnabled: body.joinGateEnabled ?? false,
      joinGateFallbackChannelId: body.joinGateFallbackChannelId ?? null,
      joinGateVerifiedRoleId: body.joinGateVerifiedRoleId ?? null,
      joinGateTicketCategoryId: body.joinGateTicketCategoryId ?? null,
      joinGateCurrentLookupChannelId: body.joinGateCurrentLookupChannelId ?? null,
      joinGateNewLookupChannelId: body.joinGateNewLookupChannelId ?? null,
    });

    if (result.isErr()) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode });
    }

    return NextResponse.json({ config: result.value });
  } catch (error) {
    return jsonError(error);
  }
}

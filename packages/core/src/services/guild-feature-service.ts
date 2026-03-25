import { err, ok, type Result } from 'neverthrow';

import { AppError, fromUnknownError } from '../domain/errors.js';
import { TenantRepository, type GuildConfigRecord } from '../repositories/tenant-repository.js';

export type GuildFeatureKey = 'coupons' | 'points' | 'referrals' | 'telegram';

function featureCode(feature: GuildFeatureKey): string {
  switch (feature) {
    case 'coupons':
      return 'COUPONS_DISABLED';
    case 'points':
      return 'POINTS_DISABLED';
    case 'referrals':
      return 'REFERRALS_DISABLED';
    case 'telegram':
      return 'TELEGRAM_DISABLED';
  }
}

function featureMessage(feature: GuildFeatureKey): string {
  switch (feature) {
    case 'coupons':
      return 'Coupons are currently disabled for this server.';
    case 'points':
      return 'Points are currently disabled for this server.';
    case 'referrals':
      return 'Referrals are currently disabled for this server.';
    case 'telegram':
      return 'Telegram is currently disabled for this server.';
  }
}

export function isGuildFeatureEnabled(
  config: Pick<GuildConfigRecord, 'couponsEnabled' | 'pointsEnabled' | 'referralsEnabled' | 'telegramEnabled'>,
  feature: GuildFeatureKey,
): boolean {
  switch (feature) {
    case 'coupons':
      return config.couponsEnabled;
    case 'points':
      return config.pointsEnabled;
    case 'referrals':
      return config.referralsEnabled;
    case 'telegram':
      return config.telegramEnabled;
  }
}

export class GuildFeatureService {
  private readonly tenantRepository = new TenantRepository();

  public async getGuildConfig(input: {
    tenantId: string;
    guildId: string;
  }): Promise<Result<GuildConfigRecord, AppError>> {
    try {
      const config = await this.tenantRepository.getGuildConfig(input);
      if (!config) {
        return err(new AppError('GUILD_CONFIG_NOT_FOUND', 'Guild config not found', 404));
      }

      return ok(config);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async ensureFeatureEnabled(input: {
    tenantId: string;
    guildId: string;
    feature: GuildFeatureKey;
  }): Promise<Result<GuildConfigRecord, AppError>> {
    const config = await this.getGuildConfig(input);
    if (config.isErr()) {
      return err(config.error);
    }

    if (!isGuildFeatureEnabled(config.value, input.feature)) {
      return err(new AppError(featureCode(input.feature), featureMessage(input.feature), 409));
    }

    return ok(config.value);
  }
}

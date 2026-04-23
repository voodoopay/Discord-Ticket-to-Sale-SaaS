import { err, ok, type Result } from 'neverthrow';

import { AppError } from '../domain/errors.js';
import {
  AiConfigRepository,
  type AiGuildSettingsSnapshot,
  type SaveAiGuildSettingsInput,
} from '../repositories/ai-config-repository.js';

export type AiConfigRepositoryLike = Pick<
  AiConfigRepository,
  'getGuildSettingsSnapshot' | 'saveGuildSettings'
>;

export class AiConfigService {
  constructor(
    private readonly repository: AiConfigRepositoryLike = new AiConfigRepository(),
  ) {}

  public async getGuildSettingsSnapshot(input: {
    guildId: string;
  }): Promise<Result<AiGuildSettingsSnapshot, AppError>> {
    try {
      return ok(await this.repository.getGuildSettingsSnapshot({ guildId: input.guildId }));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_CONFIG_READ_FAILED',
              'AI settings check failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async saveGuildSettings(
    input: SaveAiGuildSettingsInput,
  ): Promise<Result<AiGuildSettingsSnapshot, AppError>> {
    try {
      await this.repository.saveGuildSettings(input);
      return ok(await this.repository.getGuildSettingsSnapshot({ guildId: input.guildId }));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_CONFIG_WRITE_FAILED',
              'AI settings update failed due to an internal error.',
              500,
            ),
      );
    }
  }
}

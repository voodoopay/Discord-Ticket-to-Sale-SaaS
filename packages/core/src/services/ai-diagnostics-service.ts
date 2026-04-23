import { err, ok, type Result } from 'neverthrow';

import { AppError } from '../domain/errors.js';
import {
  AiKnowledgeRepository,
  type AiGuildDiagnosticsSnapshot,
} from '../repositories/ai-knowledge-repository.js';

export type AiDiagnosticsRepositoryLike = Pick<AiKnowledgeRepository, 'getGuildDiagnostics'>;

export class AiDiagnosticsService {
  constructor(
    private readonly repository: AiDiagnosticsRepositoryLike = new AiKnowledgeRepository(),
  ) {}

  public async getGuildDiagnostics(input: {
    guildId: string;
  }): Promise<Result<AiGuildDiagnosticsSnapshot, AppError>> {
    try {
      return ok(await this.repository.getGuildDiagnostics({ guildId: input.guildId }));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'AI_DIAGNOSTICS_READ_FAILED',
              'AI diagnostics could not be loaded due to an internal error.',
              500,
            ),
      );
    }
  }
}

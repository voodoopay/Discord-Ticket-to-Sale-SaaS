import { err, ok, type Result } from 'neverthrow';

import { AppError } from '../domain/errors.js';
import {
  JoinGateAccessRepository,
  type JoinGateAuthorizedUserRecord,
} from '../repositories/join-gate-access-repository.js';

export type JoinGateAuthorizedUserSummary = {
  authorizationId: string;
  discordUserId: string;
  grantedByDiscordUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JoinGateCommandAccessState = {
  locked: boolean;
  allowed: boolean;
  activated: boolean;
  authorizedUserCount: number;
};

export type JoinGateGuildActivationState = {
  activated: boolean;
  authorizedUserCount: number;
};

function mapAuthorizedUserSummary(
  authorizedUser: JoinGateAuthorizedUserRecord,
): JoinGateAuthorizedUserSummary {
  return {
    authorizationId: authorizedUser.id,
    discordUserId: authorizedUser.discordUserId,
    grantedByDiscordUserId: authorizedUser.grantedByDiscordUserId,
    createdAt: authorizedUser.createdAt.toISOString(),
    updatedAt: authorizedUser.updatedAt.toISOString(),
  };
}

export class JoinGateAccessService {
  private readonly joinGateAccessRepository = new JoinGateAccessRepository();

  public async getCommandAccessState(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<Result<JoinGateCommandAccessState, AppError>> {
    try {
      const authorizedUsers = await this.joinGateAccessRepository.listAuthorizedUsers({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      const authorizedUserCount = authorizedUsers.length;

      return ok({
        locked: true,
        allowed: authorizedUsers.some((user) => user.discordUserId === input.discordUserId),
        activated: authorizedUserCount > 0,
        authorizedUserCount,
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'JOIN_GATE_ACCESS_READ_FAILED',
              'Join-gate access check failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async getGuildActivationState(input: {
    tenantId: string;
    guildId: string;
  }): Promise<Result<JoinGateGuildActivationState, AppError>> {
    try {
      const authorizedUsers = await this.joinGateAccessRepository.listAuthorizedUsers({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      return ok({
        activated: authorizedUsers.length > 0,
        authorizedUserCount: authorizedUsers.length,
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'JOIN_GATE_ACCESS_READ_FAILED',
              'Join-gate access check failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async listAuthorizedUsers(input: {
    tenantId: string;
    guildId: string;
  }): Promise<Result<JoinGateAuthorizedUserSummary[], AppError>> {
    try {
      const authorizedUsers = await this.joinGateAccessRepository.listAuthorizedUsers({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      return ok(authorizedUsers.map(mapAuthorizedUserSummary));
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'JOIN_GATE_ACCESS_READ_FAILED',
              'Join-gate access check failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async grantUserAccess(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
    grantedByDiscordUserId: string;
  }): Promise<
    Result<
      {
        authorizationId: string;
        discordUserId: string;
        created: boolean;
      },
      AppError
    >
  > {
    try {
      const granted = await this.joinGateAccessRepository.upsertAuthorizedUser({
        tenantId: input.tenantId,
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        grantedByDiscordUserId: input.grantedByDiscordUserId,
      });

      return ok({
        authorizationId: granted.record.id,
        discordUserId: granted.record.discordUserId,
        created: granted.created,
      });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'JOIN_GATE_ACCESS_WRITE_FAILED',
              'Join-gate access update failed due to an internal error.',
              500,
            ),
      );
    }
  }

  public async revokeUserAccess(input: {
    tenantId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<Result<{ revoked: boolean }, AppError>> {
    try {
      const revoked = await this.joinGateAccessRepository.revokeAuthorizedUser({
        tenantId: input.tenantId,
        guildId: input.guildId,
        discordUserId: input.discordUserId,
      });

      return ok({ revoked });
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              'JOIN_GATE_ACCESS_WRITE_FAILED',
              'Join-gate access update failed due to an internal error.',
              500,
            ),
      );
    }
  }
}

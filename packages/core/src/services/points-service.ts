import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { AppError, fromUnknownError, validationError } from '../domain/errors.js';
import type { OrderSessionRecord } from '../repositories/order-repository.js';
import { OrderRepository } from '../repositories/order-repository.js';
import { PointsRepository } from '../repositories/points-repository.js';
import type { SessionPayload } from '../security/session-token.js';
import { resolveOrderSessionCustomerEmail } from '../utils/customer-email.js';
import { AuthorizationService } from './authorization-service.js';
import { GuildFeatureService } from './guild-feature-service.js';

const emailSchema = z.string().trim().min(3).max(320).email();
const manualAdjustSchema = z.object({
  action: z.enum(['add', 'remove', 'set', 'clear']),
  points: z.number().int().nonnegative(),
}).superRefine((value, context) => {
  if ((value.action === 'add' || value.action === 'remove') && value.points <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['points'],
      message: 'Add and remove actions require a positive whole number of points.',
    });
  }

  if (value.action === 'set' && value.points < 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['points'],
      message: 'Set balance must be zero or a positive whole number.',
    });
  }
});

export type PointsBalanceView = {
  emailNormalized: string;
  emailDisplay: string;
  balancePoints: number;
  reservedPoints: number;
  availablePoints: number;
};

type NormalizedEmail = {
  emailNormalized: string;
  emailDisplay: string;
};

function toPointsBalanceView(account: {
  emailNormalized: string;
  emailDisplay: string;
  balancePoints: number;
  reservedPoints: number;
}): PointsBalanceView {
  return {
    emailNormalized: account.emailNormalized,
    emailDisplay: account.emailDisplay,
    balancePoints: account.balancePoints,
    reservedPoints: account.reservedPoints,
    availablePoints: Math.max(0, account.balancePoints - account.reservedPoints),
  };
}

export class PointsService {
  private readonly pointsRepository = new PointsRepository();
  private readonly orderRepository = new OrderRepository();
  private readonly authorizationService = new AuthorizationService();
  private readonly guildFeatureService = new GuildFeatureService();

  public normalizeEmail(email: string): Result<NormalizedEmail, AppError> {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      return err(validationError(parsed.error.issues));
    }

    const emailDisplay = parsed.data;
    return ok({
      emailNormalized: emailDisplay.toLowerCase(),
      emailDisplay,
    });
  }

  public async getBalanceByEmail(input: {
    tenantId: string;
    guildId: string;
    email: string;
  }): Promise<Result<PointsBalanceView, AppError>> {
    try {
      const featureCheck = await this.guildFeatureService.ensureFeatureEnabled({
        tenantId: input.tenantId,
        guildId: input.guildId,
        feature: 'points',
      });
      if (featureCheck.isErr()) {
        return err(featureCheck.error);
      }

      const normalized = this.normalizeEmail(input.email);
      if (normalized.isErr()) {
        return err(normalized.error);
      }

      return this.getBalanceByNormalizedEmail({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: normalized.value.emailNormalized,
        emailDisplay: normalized.value.emailDisplay,
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async getBalanceByNormalizedEmail(input: {
    tenantId: string;
    guildId: string;
    emailNormalized: string;
    emailDisplay: string;
    releaseExpiredReservations?: boolean;
  }): Promise<Result<PointsBalanceView, AppError>> {
    try {
      if (input.releaseExpiredReservations ?? true) {
        const release = await this.releaseExpiredReservations({
          tenantId: input.tenantId,
          guildId: input.guildId,
        });
        if (release.isErr()) {
          return err(release.error);
        }
      }

      const account = await this.pointsRepository.getAccount({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: input.emailNormalized,
      });

      return ok(this.toBalanceView(input.emailNormalized, input.emailDisplay, account));
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async getBalanceForActor(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      email: string;
    },
  ): Promise<Result<PointsBalanceView, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'member',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      return this.getBalanceByEmail(input);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async listCustomers(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      search: string | null;
      limit?: number;
    },
  ): Promise<Result<PointsBalanceView[], AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'member',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      const featureCheck = await this.guildFeatureService.ensureFeatureEnabled({
        tenantId: input.tenantId,
        guildId: input.guildId,
        feature: 'points',
      });
      if (featureCheck.isErr()) {
        return err(featureCheck.error);
      }

      const released = await this.releaseExpiredReservations({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (released.isErr()) {
        return err(released.error);
      }

      const rows = await this.pointsRepository.listAccounts({
        tenantId: input.tenantId,
        guildId: input.guildId,
        search: input.search,
        limit: Math.min(500, Math.max(1, input.limit ?? 200)),
      });

      return ok(
        rows.map((row) => ({
          emailNormalized: row.emailNormalized,
          emailDisplay: row.emailDisplay,
          balancePoints: row.balancePoints,
          reservedPoints: row.reservedPoints,
          availablePoints: Math.max(0, row.balancePoints - row.reservedPoints),
        })),
      );
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async manualAdjust(
    actor: SessionPayload,
    input: {
      tenantId: string;
      guildId: string;
      email: string;
      action: 'add' | 'remove' | 'set' | 'clear';
      points: number;
    },
  ): Promise<Result<PointsBalanceView, AppError>> {
    try {
      const roleCheck = await this.authorizationService.ensureTenantRole(actor, {
        tenantId: input.tenantId,
        minimumRole: 'admin',
      });
      if (roleCheck.isErr()) {
        return err(roleCheck.error);
      }

      const guildCheck = await this.authorizationService.ensureGuildBoundToTenant({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });
      if (guildCheck.isErr()) {
        return err(guildCheck.error);
      }

      const featureCheck = await this.guildFeatureService.ensureFeatureEnabled({
        tenantId: input.tenantId,
        guildId: input.guildId,
        feature: 'points',
      });
      if (featureCheck.isErr()) {
        return err(featureCheck.error);
      }

      const normalized = this.normalizeEmail(input.email);
      if (normalized.isErr()) {
        return err(normalized.error);
      }

      const parsedAdjust = manualAdjustSchema.safeParse({
        action: input.action,
        points: input.points,
      });
      if (!parsedAdjust.success) {
        return err(validationError(parsedAdjust.error.issues));
      }

      const existingAccount = await this.pointsRepository.getAccount({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: normalized.value.emailNormalized,
      });
      const currentBalance = existingAccount?.balancePoints ?? 0;

      if (parsedAdjust.data.action === 'add') {
        const account = await this.pointsRepository.addPoints({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: normalized.value.emailNormalized,
          emailDisplay: normalized.value.emailDisplay,
          points: parsedAdjust.data.points,
        });
        await this.pointsRepository.insertLedgerEvent({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: normalized.value.emailNormalized,
          deltaPoints: parsedAdjust.data.points,
          eventType: 'manual_add',
          actorUserId: actor.userId,
          metadata: {
            source: 'dashboard',
          },
        });

        return ok(toPointsBalanceView(account));
      }

      if (parsedAdjust.data.action === 'remove') {
        const removed = await this.pointsRepository.removePointsClampToZero({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: normalized.value.emailNormalized,
          emailDisplay: normalized.value.emailDisplay,
          points: parsedAdjust.data.points,
        });
        await this.pointsRepository.insertLedgerEvent({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: normalized.value.emailNormalized,
          deltaPoints: -removed.removedPoints,
          eventType: 'manual_remove',
          actorUserId: actor.userId,
          metadata: {
            source: 'dashboard',
            requestedPoints: parsedAdjust.data.points,
            removedPoints: removed.removedPoints,
          },
        });

        return ok(toPointsBalanceView(removed.account));
      }

      if (parsedAdjust.data.action === 'clear') {
        const removed = await this.pointsRepository.removePointsClampToZero({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: normalized.value.emailNormalized,
          emailDisplay: normalized.value.emailDisplay,
          points: currentBalance,
        });

        await this.pointsRepository.insertLedgerEvent({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: normalized.value.emailNormalized,
          deltaPoints: -removed.removedPoints,
          eventType: 'manual_clear',
          actorUserId: actor.userId,
          metadata: {
            source: 'dashboard',
            previousBalance: currentBalance,
            removedPoints: removed.removedPoints,
          },
        });

        return ok(toPointsBalanceView(removed.account));
      }

      const targetBalance = parsedAdjust.data.points;
      if (targetBalance === currentBalance) {
        const ensuredAccount =
          existingAccount ??
          (
            await this.pointsRepository.removePointsClampToZero({
              tenantId: input.tenantId,
              guildId: input.guildId,
              emailNormalized: normalized.value.emailNormalized,
              emailDisplay: normalized.value.emailDisplay,
              points: 0,
            })
          ).account;

        await this.pointsRepository.insertLedgerEvent({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: normalized.value.emailNormalized,
          deltaPoints: 0,
          eventType: 'manual_set',
          actorUserId: actor.userId,
          metadata: {
            source: 'dashboard',
            previousBalance: currentBalance,
            targetBalance,
            changed: false,
          },
        });

        return ok(toPointsBalanceView(ensuredAccount));
      }

      if (targetBalance > currentBalance) {
        const delta = targetBalance - currentBalance;
        const account = await this.pointsRepository.addPoints({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: normalized.value.emailNormalized,
          emailDisplay: normalized.value.emailDisplay,
          points: delta,
        });

        await this.pointsRepository.insertLedgerEvent({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: normalized.value.emailNormalized,
          deltaPoints: delta,
          eventType: 'manual_set',
          actorUserId: actor.userId,
          metadata: {
            source: 'dashboard',
            previousBalance: currentBalance,
            targetBalance,
          },
        });

        return ok(toPointsBalanceView(account));
      }

      const removed = await this.pointsRepository.removePointsClampToZero({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: normalized.value.emailNormalized,
        emailDisplay: normalized.value.emailDisplay,
        points: currentBalance - targetBalance,
      });
      await this.pointsRepository.insertLedgerEvent({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: normalized.value.emailNormalized,
        deltaPoints: -removed.removedPoints,
        eventType: 'manual_set',
        actorUserId: actor.userId,
        metadata: {
          source: 'dashboard',
          previousBalance: currentBalance,
          targetBalance,
          removedPoints: removed.removedPoints,
        },
      });

      return ok(toPointsBalanceView(removed.account));
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async reservePointsForOrder(input: {
    tenantId: string;
    guildId: string;
    emailNormalized: string;
    emailDisplay: string;
    points: number;
    orderSessionId: string;
  }): Promise<Result<PointsBalanceView, AppError>> {
    try {
      const points = Math.max(0, input.points);
      if (points <= 0) {
        return this.getBalanceByNormalizedEmail({
          tenantId: input.tenantId,
          guildId: input.guildId,
          emailNormalized: input.emailNormalized,
          emailDisplay: input.emailDisplay,
          releaseExpiredReservations: false,
        });
      }

      const reserved = await this.pointsRepository.reservePoints({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: input.emailNormalized,
        emailDisplay: input.emailDisplay,
        points,
      });

      if (!reserved.ok) {
        return err(
          new AppError(
            'POINTS_INSUFFICIENT',
            'Points balance changed before checkout could be created. Please try again.',
            409,
          ),
        );
      }

      await this.pointsRepository.insertLedgerEvent({
        tenantId: input.tenantId,
        guildId: input.guildId,
        emailNormalized: input.emailNormalized,
        deltaPoints: 0,
        eventType: 'reservation_created',
        orderSessionId: input.orderSessionId,
        metadata: {
          points,
        },
      });

      return ok({
        emailNormalized: reserved.account.emailNormalized,
        emailDisplay: reserved.account.emailDisplay,
        balancePoints: reserved.account.balancePoints,
        reservedPoints: reserved.account.reservedPoints,
        availablePoints: Math.max(0, reserved.account.balancePoints - reserved.account.reservedPoints),
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async releaseReservationForOrderSession(input: {
    orderSession: OrderSessionRecord;
    reason: 'expired' | 'cancelled';
  }): Promise<Result<void, AppError>> {
    try {
      const customerEmail = resolveOrderSessionCustomerEmail(input.orderSession);
      if (
        input.orderSession.pointsReservationState !== 'reserved' ||
        input.orderSession.pointsReserved <= 0 ||
        !customerEmail
      ) {
        if (input.orderSession.pointsReservationState === 'reserved') {
          await this.orderRepository.setOrderSessionPointsReservationState({
            tenantId: input.orderSession.tenantId,
            orderSessionId: input.orderSession.id,
            state: input.reason === 'expired' ? 'released_expired' : 'released_cancelled',
          });
        }

        return ok(undefined);
      }

      await this.pointsRepository.releaseReservedPoints({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        emailNormalized: customerEmail,
        points: input.orderSession.pointsReserved,
      });

      await this.pointsRepository.insertLedgerEvent({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        emailNormalized: customerEmail,
        deltaPoints: 0,
        eventType: input.reason === 'expired' ? 'reservation_released_expired' : 'reservation_released_cancelled',
        orderSessionId: input.orderSession.id,
        metadata: {
          points: input.orderSession.pointsReserved,
        },
      });

      await this.orderRepository.setOrderSessionPointsReservationState({
        tenantId: input.orderSession.tenantId,
        orderSessionId: input.orderSession.id,
        state: input.reason === 'expired' ? 'released_expired' : 'released_cancelled',
      });

      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async consumeReservationForPaidOrder(input: {
    orderSession: OrderSessionRecord;
  }): Promise<Result<void, AppError>> {
    try {
      const reservationState = input.orderSession.pointsReservationState;
      const pointsReserved = Math.max(0, input.orderSession.pointsReserved);
      const emailNormalized = resolveOrderSessionCustomerEmail(input.orderSession);

      if (reservationState !== 'reserved' || pointsReserved <= 0 || !emailNormalized) {
        if (reservationState === 'reserved') {
          await this.orderRepository.setOrderSessionPointsReservationState({
            tenantId: input.orderSession.tenantId,
            orderSessionId: input.orderSession.id,
            state: 'consumed',
          });
        }

        return ok(undefined);
      }

      const existingConsumption = await this.pointsRepository.findLedgerEventByOrderSessionAndType({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        orderSessionId: input.orderSession.id,
        eventType: 'reservation_consumed',
      });
      if (existingConsumption) {
        await this.orderRepository.setOrderSessionPointsReservationState({
          tenantId: input.orderSession.tenantId,
          orderSessionId: input.orderSession.id,
          state: 'consumed',
        });
        return ok(undefined);
      }

      await this.pointsRepository.consumeReservedPoints({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        emailNormalized,
        points: pointsReserved,
      });

      await this.pointsRepository.insertLedgerEvent({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        emailNormalized,
        deltaPoints: -pointsReserved,
        eventType: 'reservation_consumed',
        orderSessionId: input.orderSession.id,
        metadata: {
          points: pointsReserved,
        },
      });

      await this.orderRepository.setOrderSessionPointsReservationState({
        tenantId: input.orderSession.tenantId,
        orderSessionId: input.orderSession.id,
        state: 'consumed',
      });

      return ok(undefined);
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async addEarnedPointsForPaidOrder(input: {
    orderSession: OrderSessionRecord;
    points: number;
  }): Promise<Result<PointsBalanceView | null, AppError>> {
    try {
      const points = Math.max(0, Math.floor(input.points));
      const customerEmail = resolveOrderSessionCustomerEmail(input.orderSession);
      if (!customerEmail || points <= 0) {
        return ok(null);
      }

      const existingEarn = await this.pointsRepository.findLedgerEventByOrderSessionAndType({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        orderSessionId: input.orderSession.id,
        eventType: 'earned_from_paid_order',
      });
      if (existingEarn) {
        const account = await this.pointsRepository.getAccount({
          tenantId: input.orderSession.tenantId,
          guildId: input.orderSession.guildId,
          emailNormalized: customerEmail,
        });

        if (!account) {
          return ok(this.toBalanceView(customerEmail, customerEmail, null));
        }

        return ok(this.toBalanceView(customerEmail, customerEmail, account));
      }

      const account = await this.pointsRepository.addPoints({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        emailNormalized: customerEmail,
        emailDisplay: customerEmail,
        points,
      });

      await this.pointsRepository.insertLedgerEvent({
        tenantId: input.orderSession.tenantId,
        guildId: input.orderSession.guildId,
        emailNormalized: customerEmail,
        deltaPoints: points,
        eventType: 'earned_from_paid_order',
        orderSessionId: input.orderSession.id,
        metadata: {
          points,
        },
      });

      return ok({
        emailNormalized: account.emailNormalized,
        emailDisplay: account.emailDisplay,
        balancePoints: account.balancePoints,
        reservedPoints: account.reservedPoints,
        availablePoints: Math.max(0, account.balancePoints - account.reservedPoints),
      });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  public async releaseExpiredReservations(input: {
    tenantId: string;
    guildId: string;
  }): Promise<Result<{ releasedCount: number }, AppError>> {
    try {
      const expired = await this.orderRepository.listExpiredReservedSessions({
        tenantId: input.tenantId,
        guildId: input.guildId,
      });

      let releasedCount = 0;
      for (const orderSession of expired) {
        const released = await this.releaseReservationForOrderSession({
          orderSession,
          reason: 'expired',
        });
        if (released.isErr()) {
          return err(released.error);
        }
        releasedCount += 1;
      }

      return ok({ releasedCount });
    } catch (error) {
      return err(fromUnknownError(error));
    }
  }

  private toBalanceView(
    emailNormalized: string,
    emailDisplay: string,
    account: Awaited<ReturnType<PointsRepository['getAccount']>>,
  ): PointsBalanceView {
    const balancePoints = account?.balancePoints ?? 0;
    const reservedPoints = account?.reservedPoints ?? 0;

    return {
      emailNormalized,
      emailDisplay: account?.emailDisplay ?? emailDisplay,
      balancePoints,
      reservedPoints,
      availablePoints: Math.max(0, balancePoints - reservedPoints),
    };
  }
}

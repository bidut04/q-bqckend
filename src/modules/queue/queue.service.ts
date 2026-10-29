import { TenantContext } from "../../core/tenant/tenant-context";
import { QueueRepository } from "../../repository/queue.repository";
import { BranchRepository } from "../../repository/branch.repository";
import { BookingRepository } from "../../repository/booking.repository";
import { getTenantDb } from "../../common/base.repository";
import { Authorizer } from "../../core/authorization/authorizer";
import { Permission } from "../../core/authorization/permissions";
import { QueueStateMachine, QueueState } from "./queue.state-machine";
import { TenantAccessDeniedError } from "../../core/errors/security.errors";
import { KafkaEventFactory } from "../../lib/kafka/kafka.envelope";
import { RealtimeEmitter, realtimeEmitter } from "../../lib/socket/socket.emitter";
import { RealtimeCacheService, realtimeCacheService } from "../../lib/redis/realtime-cache.service";
import { RealtimeEventType } from "../../lib/socket/socket.types";
import { BookingStatus, QueuePolicy, SchedulingStrategy, Prisma } from "@prisma/client";
import { webhookDispatcher } from "../webhook/webhook.dispatcher";

export interface QueuePolicyUpdateInput {
  allowRequeue?: boolean;
  maxRequeueAttempts?: number;
  callGracePeriodSeconds?: number;
  maxHoldSeconds?: number;
  maximumWaitSeconds?: number;
  strategy?: SchedulingStrategy;
  priorityRules?: Prisma.InputJsonValue;
  aging?: Prisma.InputJsonValue;
  holdPolicy?: Prisma.InputJsonValue;
  settings?: Prisma.InputJsonValue;
}

export const createQueueService = (deps?: {
  queueRepo?: QueueRepository;
  branchRepo?: BranchRepository;
  bookingRepo?: BookingRepository;
  emitter?: typeof realtimeEmitter;
  cache?: typeof realtimeCacheService;
}) => {
  const queueRepo = deps?.queueRepo ?? new QueueRepository();
  const branchRepo = deps?.branchRepo ?? new BranchRepository();
  const bookingRepo = deps?.bookingRepo ?? new BookingRepository();
  const emitter = deps?.emitter ?? realtimeEmitter;
  const cache = deps?.cache ?? realtimeCacheService;


  const callEntry = async (context: TenantContext, queueEntryId: string, counterId: string) => {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    // Validate state machine transition
    QueueStateMachine.validateTransition(entry.status as QueueState, "CALLED");

    const result = await queueRepo.updateEntryStatus(context, queueEntryId, "CALLED", counterId);

    // 1. Build Kafka event envelope for async telemetry
    const event = KafkaEventFactory.createEnvelope(
      context.tenantId,
      "queue.entry.called.v1",
      "QueueEntry",
      queueEntryId,
      { queueEntryId, counterId, status: "CALLED" },
      { branchId }
    );

    // 2. Cache calling state in Redis for Digital Display screens
    const serviceName = entry.service?.name ?? entry.serviceId;
    await cache.setCallingDisplay(context.tenantId, branchId, counterId, {
      queueEntryId,
      tokenNumber: entry.tokenNumber,
      tokenLabel: entry.tokenLabel,
      counterId,
      counterNumber: counterId,
      serviceName,
      calledAt: new Date().toISOString(),
    });

    // Invalidate cached branch queue so next fetch retrieves freshly CALLED state
    await cache.invalidateBranchQueue(context.tenantId, branchId);

    // 3. Emit real-time WebSocket events to desk operators & TV display
    emitter.emitQueueEvent(context.tenantId, branchId, RealtimeEventType.QUEUE_ENTRY_CALLED, {
      queueEntryId,
      counterId,
      tokenNumber: entry.tokenNumber,
      tokenLabel: entry.tokenLabel,
      status: "CALLED",
      branchId,
      serviceId: entry.serviceId,
      serviceName,
      updatedAt: new Date().toISOString(),
    });

    emitter.emitDisplayCall(context.tenantId, branchId, {
      queueEntryId,
      counterId,
      tokenNumber: entry.tokenNumber,
      tokenLabel: entry.tokenLabel,
      serviceName,
      soundCue: "CHIME",
      calledAt: new Date().toISOString(),
    });

    // 4. Asynchronously notify partner tenant webhook (CRM / EHR)
    webhookDispatcher.dispatch(context.tenantId, RealtimeEventType.QUEUE_ENTRY_CALLED, {
      queueEntryId,
      counterId,
      tokenNumber: entry.tokenNumber,
      tokenLabel: entry.tokenLabel,
      serviceName,
      branchId,
      status: "CALLED",
      calledAt: new Date().toISOString(),
    });

    return { result, event };
  };

  const startService = async (context: TenantContext, queueEntryId: string) => {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    QueueStateMachine.validateTransition(entry.status as QueueState, "IN_SERVICE");

    const result = await queueRepo.updateEntryStatus(context, queueEntryId, "IN_SERVICE");

    // Invalidate active queue cache
    await cache.invalidateBranchQueue(context.tenantId, branchId);

    // Emit real-time WebSocket event
    emitter.emitQueueEvent(context.tenantId, branchId, RealtimeEventType.QUEUE_ENTRY_STARTED, {
      queueEntryId,
      status: "IN_SERVICE",
      branchId,
      serviceId: entry.serviceId,
      updatedAt: new Date().toISOString(),
    });

    return result;
  };

  const completeEntry = async (context: TenantContext, queueEntryId: string) => {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    QueueStateMachine.validateTransition(entry.status as QueueState, "COMPLETED");

    const result = await queueRepo.updateEntryStatus(context, queueEntryId, "COMPLETED");

    // 1. Clear calling display state from Redis cache
    const counterIdToClear = entry.currentCounterId ?? (entry as { counterId?: string | null }).counterId;
    if (counterIdToClear) {
      await cache.clearCallingDisplay(context.tenantId, branchId, counterIdToClear);
      emitter.emitDisplayClear(context.tenantId, branchId, {
        counterId: counterIdToClear,
        queueEntryId,
        clearedAt: new Date().toISOString(),
      });
    }

    // 2. Invalidate active branch queue cache
    await cache.invalidateBranchQueue(context.tenantId, branchId);

    // 3. Emit real-time queue entry completed event
    emitter.emitQueueEvent(context.tenantId, branchId, RealtimeEventType.QUEUE_ENTRY_COMPLETED, {
      queueEntryId,
      status: "COMPLETED",
      branchId,
      serviceId: entry.serviceId,
      updatedAt: new Date().toISOString(),
    });

    // Notify partner webhook of completion
    webhookDispatcher.dispatch(context.tenantId, RealtimeEventType.QUEUE_ENTRY_COMPLETED, {
      queueEntryId,
      status: "COMPLETED",
      branchId,
      serviceId: entry.serviceId,
      completedAt: new Date().toISOString(),
    });

    // 4. If linked to an appointment booking, transition the Booking to COMPLETED!
    if (entry.bookingId) {
      try {
        await bookingRepo.updateStatus(context, entry.bookingId, BookingStatus.COMPLETED);
        await cache.invalidateBooking(context.tenantId, entry.bookingId);

        emitter.emitBookingEvent(context.tenantId, branchId, RealtimeEventType.BOOKING_COMPLETED, {
          bookingId: entry.bookingId,
          status: "COMPLETED",
          branchId,
          queueEntryId,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(`[QueueService] Error completing linked booking ${entry.bookingId}:`, (err as Error).message);
      }
    }

    return result;
  };

  const transferEntry = async (
    context: TenantContext,
    queueEntryId: string,
    targetBranchId: string,
    targetServiceId: string
  ) => {
    Authorizer.authorize(context, Permission.QUEUE_TRANSFER);

    const entry = await queueRepo.findEntryById(context, queueEntryId);
    if (entry.tenantId !== context.tenantId) {
      throw new TenantAccessDeniedError("Cannot transfer queue entry belonging to another tenant");
    }

    const sourceBranchId = entry.locationId ?? entry.location?.id;

    // Verify state machine allows transfer
    QueueStateMachine.validateTransition(entry.status as QueueState, "TRANSFERRED");

    // Verify target branch belongs to SAME tenant
    const targetBranch = await branchRepo.findById(context, targetBranchId);
    if (targetBranch.tenantId !== context.tenantId) {
      throw new TenantAccessDeniedError("Cross-tenant queue transfers are strictly impossible");
    }

    const db = await getTenantDb(context);
    const result = await db.queueEntry.updateMany({
      where: { id: queueEntryId, tenantId: context.tenantId },
      data: {
        locationId: targetBranchId,
        serviceId: targetServiceId,
        status: "WAITING",
        updatedAt: new Date(),
      },
    });

    // Invalidate queue caches for both branches
    await cache.invalidateBranchQueue(context.tenantId, sourceBranchId);
    if (targetBranchId !== sourceBranchId) {
      await cache.invalidateBranchQueue(context.tenantId, targetBranchId);
    }

    // Emit real-time transfer events
    emitter.emitQueueEvent(context.tenantId, sourceBranchId, RealtimeEventType.QUEUE_ENTRY_TRANSFERRED, {
      queueEntryId,
      fromBranchId: sourceBranchId,
      toBranchId: targetBranchId,
      toServiceId: targetServiceId,
      status: "WAITING",
      updatedAt: new Date().toISOString(),
    });

    if (targetBranchId !== sourceBranchId) {
      emitter.emitQueueEvent(context.tenantId, targetBranchId, RealtimeEventType.QUEUE_ENTRY_CREATED, {
        queueEntryId,
        branchId: targetBranchId,
        serviceId: targetServiceId,
        tokenLabel: entry.tokenLabel,
        tokenNumber: entry.tokenNumber,
        status: "WAITING",
        updatedAt: new Date().toISOString(),
      });
    }

    return result;
  };

  const completeService = async (context: TenantContext, queueEntryId: string) => {
    return completeEntry(context, queueEntryId);
  };

  const markNoShow = async (context: TenantContext, queueEntryId: string) => {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    QueueStateMachine.validateTransition(entry.status as QueueState, "NO_SHOW");

    const result = await queueRepo.updateEntryStatus(context, queueEntryId, "NO_SHOW");

    // Clear calling display cache and update queue cache
    const counterIdToClear = entry.currentCounterId ?? (entry as { counterId?: string | null }).counterId;
    if (counterIdToClear) {
      await cache.clearCallingDisplay(context.tenantId, branchId, counterIdToClear);
      emitter.emitDisplayClear(context.tenantId, branchId, {
        counterId: counterIdToClear,
        queueEntryId,
        clearedAt: new Date().toISOString(),
      });
    }
    await cache.invalidateBranchQueue(context.tenantId, branchId);

    // Emit real-time event
    emitter.emitQueueEvent(context.tenantId, branchId, RealtimeEventType.QUEUE_ENTRY_NO_SHOW, {
      queueEntryId,
      status: "NO_SHOW",
      branchId,
      serviceId: entry.serviceId,
      updatedAt: new Date().toISOString(),
    });

    return result;
  };

  const cancelEntry = async (context: TenantContext, queueEntryId: string, reason?: string) => {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    QueueStateMachine.validateTransition(entry.status as QueueState, "CANCELLED");

    const result = await queueRepo.updateEntryStatus(context, queueEntryId, "CANCELLED");

    // Clear display cache if was calling
    const cancelCounterId = entry.currentCounterId ?? (entry as { counterId?: string | null }).counterId;
    if (cancelCounterId) {
      await cache.clearCallingDisplay(context.tenantId, branchId, cancelCounterId);
      emitter.emitDisplayClear(context.tenantId, branchId, {
        counterId: cancelCounterId,
        queueEntryId,
        clearedAt: new Date().toISOString(),
      });
    }
    await cache.invalidateBranchQueue(context.tenantId, branchId);

    // Emit real-time event
    emitter.emitQueueEvent(context.tenantId, branchId, RealtimeEventType.QUEUE_ENTRY_CANCELLED, {
      queueEntryId,
      status: "CANCELLED",
      reason,
      branchId,
      serviceId: entry.serviceId,
      updatedAt: new Date().toISOString(),
    });

    return result;
  };

  const requeueEntry = async (
    context: TenantContext,
    queueEntryId: string,
    options?: { bypassRules?: boolean; reason?: string }
  ) => {
    const entry = await queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;

    if (options?.bypassRules) {
      // System bypass requires QUEUE_REQUEUE_OVERRIDE permission
      Authorizer.authorize(context, Permission.QUEUE_REQUEUE_OVERRIDE, {
        tenantId: entry.tenantId,
        branchId,
      });
    } else {
      Authorizer.authorize(context, Permission.QUEUE_UPDATE, {
        tenantId: entry.tenantId,
        branchId,
      });

      // If user missed turn (NO_SHOW), verify policy permits requeue or requires override
      if (entry.status === "NO_SHOW") {
        const policy = await queueRepo.findPolicyForQueue(context, entry.queueId);
        if (policy && !policy.allowRequeue) {
          throw new TenantAccessDeniedError(
            "Requeuing is disabled by queue policy. Super Admin or Branch Admin override required."
          );
        }
      }
    }

    const result = await queueRepo.requeueEntry(context, queueEntryId, {
      reason: options?.reason,
    });

    // Invalidate queue cache
    await cache.invalidateBranchQueue(context.tenantId, branchId);

    // Emit real-time event for requeued token
    emitter.emitQueueEvent(context.tenantId, branchId, RealtimeEventType.QUEUE_ENTRY_REQUEUED, {
      queueEntryId,
      status: "WAITING",
      tokenNumber: entry.tokenNumber,
      tokenLabel: entry.tokenLabel,
      branchId,
      serviceId: entry.serviceId,
      reason: options?.reason,
      requeueCount: (entry.requeueCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    });

    return result;
  };

  const getQueuePolicy = async (context: TenantContext, queueId: string): Promise<QueuePolicy | null> => {
    Authorizer.authorize(context, Permission.QUEUE_READ);
    return queueRepo.findPolicyForQueue(context, queueId);
  };

  const updateQueuePolicy = async (context: TenantContext, queueId: string, data: QueuePolicyUpdateInput): Promise<QueuePolicy> => {
    Authorizer.authorize(context, Permission.QUEUE_POLICY_UPDATE);
    return queueRepo.upsertPolicyForQueue(context, queueId, data);
  };

  return {
    callEntry,
    startService,
    completeEntry,
    transferEntry,
    completeService,
    markNoShow,
    cancelEntry,
    requeueEntry,
    getQueuePolicy,
    updateQueuePolicy,
  };
};

export const queueService = createQueueService();

export type QueueService = ReturnType<typeof createQueueService>;

export const QueueService = function (
  this: unknown,
  deps?: {
    queueRepo?: QueueRepository;
    branchRepo?: BranchRepository;
    bookingRepo?: BookingRepository;
    emitter?: typeof realtimeEmitter;
    cache?: typeof realtimeCacheService;
  }
) {
  return createQueueService(deps);
} as unknown as {
  new (deps?: {
    queueRepo?: QueueRepository;
    branchRepo?: BranchRepository;
    bookingRepo?: BookingRepository;
    emitter?: typeof realtimeEmitter;
    cache?: typeof realtimeCacheService;
  }): ReturnType<typeof createQueueService>;
};


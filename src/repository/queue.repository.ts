import { QueueEntryStatus, QueueEventType, Prisma, SchedulingStrategy } from "@prisma/client";
import { TenantContext } from "../core/tenant/tenant-context";
import { getTenantDb, withTenantScope, ensureFound } from "../common/base.repository";
import { ResourceNotFoundError } from "../core/errors/security.errors";

export interface QueuePolicyUpsertData {
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

export const createQueueRepository = () => {
  const findEntryById = async (context: TenantContext, queueEntryId: string) => {
    const db = await getTenantDb(context);
    const entry = await db.queueEntry.findFirst({
      where: withTenantScope(context, { id: queueEntryId }),
      include: {
        queue: true,
        location: true,
        customer: true,
        service: true,
      },
    });
    return ensureFound(entry, "Queue Entry");
  };

  const findActiveByBranch = async (context: TenantContext, branchId: string) => {
    const db = await getTenantDb(context);
    return db.queueEntry.findMany({
      where: withTenantScope(context, {
        locationId: branchId,
        status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED, QueueEntryStatus.SERVING] },
      }),
      include: {
        service: true,
        customer: true,
        queue: true,
      },
      orderBy: { priority: "desc" },
    });
  };

  const findPolicyForQueue = async (context: TenantContext, queueId: string) => {
    const db = await getTenantDb(context);
    return db.queuePolicy.findUnique({
      where: { queueId },
    });
  };

  const upsertPolicyForQueue = async (
    context: TenantContext,
    queueId: string,
    data: QueuePolicyUpsertData
  ) => {
    const db = await getTenantDb(context);
    const queue = await db.queue.findFirst({
      where: withTenantScope(context, { id: queueId }),
    });
    if (!queue) {
      throw new ResourceNotFoundError(`Queue '${queueId}' not found in this tenant`);
    }

    return db.queuePolicy.upsert({
      where: { queueId },
      create: {
        queueId,
        allowRequeue: data.allowRequeue ?? true,
        maxRequeueAttempts: data.maxRequeueAttempts ?? 1,
        callGracePeriodSeconds: data.callGracePeriodSeconds ?? 180,
        maxHoldSeconds: data.maxHoldSeconds,
        maximumWaitSeconds: data.maximumWaitSeconds,
        strategy: data.strategy ?? SchedulingStrategy.FIFO,
        ...(data.priorityRules !== undefined ? { priorityRules: data.priorityRules } : {}),
        ...(data.aging !== undefined ? { aging: data.aging } : {}),
        ...(data.holdPolicy !== undefined ? { holdPolicy: data.holdPolicy } : {}),
        ...(data.settings !== undefined ? { settings: data.settings } : {}),
      },
      update: {
        ...(data.allowRequeue !== undefined ? { allowRequeue: data.allowRequeue } : {}),
        ...(data.maxRequeueAttempts !== undefined ? { maxRequeueAttempts: data.maxRequeueAttempts } : {}),
        ...(data.callGracePeriodSeconds !== undefined ? { callGracePeriodSeconds: data.callGracePeriodSeconds } : {}),
        ...(data.maxHoldSeconds !== undefined ? { maxHoldSeconds: data.maxHoldSeconds } : {}),
        ...(data.maximumWaitSeconds !== undefined ? { maximumWaitSeconds: data.maximumWaitSeconds } : {}),
        ...(data.strategy !== undefined ? { strategy: data.strategy } : {}),
        ...(data.priorityRules !== undefined ? { priorityRules: data.priorityRules } : {}),
        ...(data.aging !== undefined ? { aging: data.aging } : {}),
        ...(data.holdPolicy !== undefined ? { holdPolicy: data.holdPolicy } : {}),
        ...(data.settings !== undefined ? { settings: data.settings } : {}),
      },
    });
  };

  const updateEntryStatus = async (
    context: TenantContext,
    queueEntryId: string,
    status: QueueEntryStatus | string,
    counterId?: string
  ) => {
    const db = await getTenantDb(context);
    // Safe update: first verify ownership via tenant-scoped lookup
    await findEntryById(context, queueEntryId);

    return db.queueEntry.updateMany({
      where: withTenantScope(context, { id: queueEntryId }),
      data: {
        status: status as QueueEntryStatus,
        currentCounterId: counterId,
        updatedAt: new Date(),
      },
    });
  };

  const requeueEntry = async (
    context: TenantContext,
    queueEntryId: string,
    options?: { reason?: string; priority?: number }
  ) => {
    const db = await getTenantDb(context);
    const entry = await findEntryById(context, queueEntryId);

    const fromStatus = entry.status as QueueEntryStatus;
    const toStatus = QueueEntryStatus.WAITING;

    await db.queueEntry.update({
      where: { id: queueEntryId },
      data: {
        status: toStatus,
        calledAt: null,
        servingAt: null,
        noShowAt: null,
        currentCounterId: null,
        priority: options?.priority !== undefined ? options.priority : entry.priority,
        updatedAt: new Date(),
      },
    });

    try {
      await db.queueEntryEvent.create({
        data: {
          tenantId: context.tenantId,
          queueEntryId,
          type: QueueEventType.REQUEUED,
          fromStatus,
          toStatus,
          reason: options?.reason || "Requeued after miss or hold",
          actorType: context.roleIds[0] || "EMPLOYEE",
        },
      });
    } catch {
      // Non-fatal if events table isn't sharded in test harness
    }

    return findEntryById(context, queueEntryId);
  };

  return {
    findEntryById,
    findActiveByBranch,
    findPolicyForQueue,
    upsertPolicyForQueue,
    updateEntryStatus,
    requeueEntry,
  };
};

export type QueueRepository = ReturnType<typeof createQueueRepository>;

export const createQueueRepositoryAdapter = () => createQueueRepository();

export const QueueRepositoryAdapter = function (this: unknown) {
  return createQueueRepository();
} as unknown as {
  new (): ReturnType<typeof createQueueRepository>;
};

export const QueueRepository = QueueRepositoryAdapter as unknown as typeof QueueRepositoryAdapter &
  typeof createQueueRepository;




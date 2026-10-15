import { QueueEntryStatus } from "@prisma/client";
import { TenantContext } from "../core/tenant/tenant-context";
import { getTenantDb, withTenantScope, ensureFound } from "../common/base.repository";

export const createQueueRepository = () => {
  const findEntryById = async (context: TenantContext, queueEntryId: string) => {
    const db = await getTenantDb(context);
    const entry = await db.queueEntry.findFirst({
      where: withTenantScope(context, { id: queueEntryId }),
      include: {
        queue: true,
        location: true,
        customer: true,
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
      orderBy: { priority: "desc" },
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

  return {
    findEntryById,
    findActiveByBranch,
    updateEntryStatus,
  };
};

export type QueueRepository = ReturnType<typeof createQueueRepository>;

export class QueueRepositoryAdapter {
  private repo = createQueueRepository();
  findEntryById = this.repo.findEntryById;
  findActiveByBranch = this.repo.findActiveByBranch;
  updateEntryStatus = this.repo.updateEntryStatus;
}

export const QueueRepository = QueueRepositoryAdapter as unknown as typeof QueueRepositoryAdapter &
  typeof createQueueRepository;

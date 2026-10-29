import { KafkaEventEnvelope } from "../lib/kafka/kafka.envelope";
import { TenantContext } from "../core/tenant/tenant-context";
import { runWithTenantContext } from "../core/tenant/tenant-context.store";
import { QueueRepository } from "../repository/queue.repository";
import { Role } from "../core/authorization/roles";
import { Permission } from "../core/authorization/permissions";

export interface NoShowJobPayload {
  queueEntryId: string;
}

const queueRepository = new QueueRepository();

export const processNoShowEvent = async (
  envelope: KafkaEventEnvelope<NoShowJobPayload>
): Promise<void> => {
  // 1. Resolve trusted tenantId strictly from event envelope header, NOT payload
  const trustedTenantId = envelope.tenantId;

  // 2. Construct worker TenantContext
  const workerContext: TenantContext = Object.freeze({
    userId: `worker_noshow_${envelope.eventId}`,
    tenantId: trustedTenantId,
    roleIds: Object.freeze([Role.PLATFORM_ADMIN]),
    permissions: Object.freeze([Permission.QUEUE_UPDATE]),
    branchIds: envelope.branchId ? Object.freeze([envelope.branchId]) : Object.freeze([]),
    sessionId: `worker_sess_${envelope.correlationId}`,
    securityVersion: 0,
  });

  // 3. Execute inside AsyncLocalStorage context scope
  await runWithTenantContext(workerContext, async () => {
    const { queueEntryId } = envelope.payload;

    // 4. Verify queue entry exists on tenant's assigned shard database and belongs to tenantId
    const queueEntry = await queueRepository.findEntryById(workerContext, queueEntryId);

    // Verify branch scope matches if envelope defined branchId
    const entryBranchId = queueEntry.locationId ?? (queueEntry as any).branchId;
    if (envelope.branchId && entryBranchId !== envelope.branchId) {
      throw new Error(`Worker tenant/branch mismatch: Entry branch '${entryBranchId}' does not match event branch '${envelope.branchId}'`);
    }

    if (queueEntry.status === "CALLED") {
      await queueRepository.updateEntryStatus(workerContext, queueEntryId, "NO_SHOW");
      console.log(`[NoShowWorker] Queue entry ${queueEntryId} marked as NO_SHOW for tenant ${trustedTenantId}`);
    }
  });
};

export const noShowWorker = {
  processEvent: processNoShowEvent,
};

export const NoShowWorker = function (this: unknown) {
  return noShowWorker;
} as unknown as {
  new (): typeof noShowWorker;
  processEvent: typeof processNoShowEvent;
};


import { TenantContext } from "../../core/tenant/tenant-context";
import { QueueRepository } from "../../repository/queue.repository";
import { BranchRepository } from "../../repository/branch.repository";
import { getTenantDb } from "../../common/base.repository";
import { Authorizer } from "../../core/authorization/authorizer";
import { Permission } from "../../core/authorization/permissions";
import { QueueStateMachine, QueueState } from "./queue.state-machine";
import { TenantAccessDeniedError } from "../../core/errors/security.errors";
import { KafkaEventFactory } from "../../lib/kafka/kafka.envelope";

export class QueueService {
  private queueRepo = new QueueRepository();
  private branchRepo = new BranchRepository();

  public async callEntry(context: TenantContext, queueEntryId: string, counterId: string) {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await this.queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    // Validate state machine transition
    QueueStateMachine.validateTransition(entry.status as QueueState, "CALLED");

    const result = await this.queueRepo.updateEntryStatus(context, queueEntryId, "CALLED", counterId);

    // Build event envelope for async workers / realtime dispatch
    const event = KafkaEventFactory.createEnvelope(
      context.tenantId,
      "queue.entry.called.v1",
      "QueueEntry",
      queueEntryId,
      { queueEntryId, counterId, status: "CALLED" },
      { branchId }
    );

    return { result, event };
  }

  public async startService(context: TenantContext, queueEntryId: string) {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await this.queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    QueueStateMachine.validateTransition(entry.status as QueueState, "IN_SERVICE");

    return this.queueRepo.updateEntryStatus(context, queueEntryId, "IN_SERVICE");
  }

  public async completeEntry(context: TenantContext, queueEntryId: string) {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await this.queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    QueueStateMachine.validateTransition(entry.status as QueueState, "COMPLETED");

    return this.queueRepo.updateEntryStatus(context, queueEntryId, "COMPLETED");
  }

  public async transferEntry(
    context: TenantContext,
    queueEntryId: string,
    targetBranchId: string,
    targetServiceId: string
  ) {
    Authorizer.authorize(context, Permission.QUEUE_TRANSFER);

    const entry = await this.queueRepo.findEntryById(context, queueEntryId);
    if (entry.tenantId !== context.tenantId) {
      throw new TenantAccessDeniedError("Cannot transfer queue entry belonging to another tenant");
    }

    // Verify state machine allows transfer
    QueueStateMachine.validateTransition(entry.status as QueueState, "TRANSFERRED");

    // Verify target branch belongs to SAME tenant
    const targetBranch = await this.branchRepo.findById(context, targetBranchId);
    if (targetBranch.tenantId !== context.tenantId) {
      throw new TenantAccessDeniedError("Cross-tenant queue transfers are strictly impossible");
    }

    const db = await getTenantDb(context);
    return db.queueEntry.updateMany({
      where: { id: queueEntryId, tenantId: context.tenantId },
      data: {
        locationId: targetBranchId,
        serviceId: targetServiceId,
        status: "WAITING",
        updatedAt: new Date(),
      },
    });
  }

  public async completeService(context: TenantContext, queueEntryId: string) {
    return this.completeEntry(context, queueEntryId);
  }

  public async markNoShow(context: TenantContext, queueEntryId: string) {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await this.queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    QueueStateMachine.validateTransition(entry.status as QueueState, "NO_SHOW");

    return this.queueRepo.updateEntryStatus(context, queueEntryId, "NO_SHOW");
  }

  public async cancelEntry(context: TenantContext, queueEntryId: string, reason?: string) {
    Authorizer.authorize(context, Permission.QUEUE_UPDATE);
    const entry = await this.queueRepo.findEntryById(context, queueEntryId);
    const branchId = entry.locationId ?? entry.location?.id;
    Authorizer.authorize(context, Permission.QUEUE_UPDATE, { tenantId: entry.tenantId, branchId });

    QueueStateMachine.validateTransition(entry.status as QueueState, "CANCELLED");

    return this.queueRepo.updateEntryStatus(context, queueEntryId, "CANCELLED");
  }
}

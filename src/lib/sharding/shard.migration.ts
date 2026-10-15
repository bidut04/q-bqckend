import { catalogDb } from "../prisma/catalog.prisma";
import { TenantStatus } from "@prisma/client";
import { assertShardWritable } from "./shard.manager";
import { shardCatalog } from "./shard.catalog";

export type TenantMigrationStatus =
  | "REQUESTED"
  | "VALIDATING"
  | "COPYING"
  | "CATCHING_UP"
  | "VERIFYING"
  | "CUTOVER"
  | "COMPLETED"
  | "FAILED";

export class TenantMigrationStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<TenantMigrationStatus, readonly TenantMigrationStatus[]> = {
    REQUESTED: ["VALIDATING", "FAILED"],
    VALIDATING: ["COPYING", "FAILED"],
    COPYING: ["CATCHING_UP", "FAILED"],
    CATCHING_UP: ["VERIFYING", "FAILED"],
    VERIFYING: ["CUTOVER", "FAILED"],
    CUTOVER: ["COMPLETED", "FAILED"],
    COMPLETED: [],
    FAILED: ["REQUESTED"], // Retriable reset
  };

  public static validateTransition(from: TenantMigrationStatus, to: TenantMigrationStatus): void {
    if (from === to) return;
    const allowed = this.ALLOWED_TRANSITIONS[from] || [];
    if (!allowed.includes(to)) {
      throw new Error(`Invalid tenant migration state transition from '${from}' to '${to}'`);
    }
  }
}

export interface CreateMigrationJobRequest {
  tenantId: string;
  targetShard: string;
}

export class TenantMigrationEngine {
  /**
   * 1. Creates a new background tenant migration job in REQUESTED state.
   * Enforces single active migration constraint per tenant and validates target shard.
   * Returns instantly to API client without blocking HTTP request.
   */
  public static async createMigrationJob(req: CreateMigrationJobRequest) {
    const { tenantId, targetShard } = req;

    // Check tenant existence
    const tenant = await catalogDb.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new Error(`Tenant '${tenantId}' not found`);
    }

    if (tenant.shardId === targetShard) {
      throw new Error(`Tenant '${tenantId}' is already on target shard '${targetShard}'`);
    }

    assertShardWritable(targetShard);

    // Enforce single active migration constraint per tenant
    const existingActiveMigration = await catalogDb.tenantMigration.findFirst({
      where: {
        tenantId,
        status: {
          notIn: ["COMPLETED", "FAILED"],
        },
      },
    });

    if (existingActiveMigration) {
      throw new Error(
        `An active migration job (${existingActiveMigration.id}) is already in progress for tenant '${tenantId}' [Status: ${existingActiveMigration.status}]`
      );
    }

    // Create migration job in REQUESTED state
    const migration = await catalogDb.tenantMigration.create({
      data: {
        tenantId,
        sourceShard: tenant.shardId,
        targetShard,
        status: "REQUESTED",
        progressPercent: 0,
        rowsCopied: 0n,
        rowsVerified: 0n,
        retryCount: 0,
      },
    });

    // Mark tenant status as MIGRATING (Writes continue on source; cutover lock applied later)
    await catalogDb.tenant.update({
      where: { id: tenantId },
      data: { status: TenantStatus.MIGRATING },
    });

    return migration;
  }

  /**
   * 2. Acquires an exclusive background worker lease for a migration job.
   */
  public static async acquireWorkerLease(migrationId: string, workerId: string, leaseDurationMs = 60000) {
    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);

    const updated = await catalogDb.tenantMigration.updateMany({
      where: {
        id: migrationId,
        OR: [
          { workerId: null },
          { workerId },
          { leaseExpiresAt: { lt: new Date() } },
        ],
      },
      data: {
        workerId,
        leaseExpiresAt,
        updatedAt: new Date(),
      },
    });

    return updated.count > 0;
  }

  /**
   * 3. Updates state transition with checkpoint data (lastProcessedId, rowsCopied, progressPercent).
   */
  public static async updateCheckpoint(
    migrationId: string,
    status: TenantMigrationStatus,
    checkpoint: { lastProcessedId?: string; rowsCopied?: bigint; rowsVerified?: bigint; progressPercent?: number }
  ) {
    const current = await catalogDb.tenantMigration.findUnique({ where: { id: migrationId } });
    if (!current) throw new Error(`Migration '${migrationId}' not found`);

    TenantMigrationStateMachine.validateTransition(current.status as TenantMigrationStatus, status);

    return catalogDb.tenantMigration.update({
      where: { id: migrationId },
      data: {
        status,
        ...(checkpoint.lastProcessedId ? { lastProcessedId: checkpoint.lastProcessedId } : {}),
        ...(checkpoint.rowsCopied !== undefined ? { rowsCopied: checkpoint.rowsCopied } : {}),
        ...(checkpoint.rowsVerified !== undefined ? { rowsVerified: checkpoint.rowsVerified } : {}),
        ...(checkpoint.progressPercent !== undefined ? { progressPercent: checkpoint.progressPercent } : {}),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 4. Executes atomic CUTOVER: switches Catalog DB tenant.shardId, status = ACTIVE, and purges caches.
   */
  public static async executeCutover(migrationId: string) {
    const migration = await catalogDb.tenantMigration.findUnique({ where: { id: migrationId } });
    if (!migration) throw new Error(`Migration '${migrationId}' not found`);

    TenantMigrationStateMachine.validateTransition(migration.status as TenantMigrationStatus, "CUTOVER");

    // Mark cutover started
    await catalogDb.tenantMigration.update({
      where: { id: migrationId },
      data: { status: "CUTOVER", cutoverStartedAt: new Date() },
    });

    // Atomic Catalog DB update: switch shardId to targetShard and reactivate tenant
    await shardCatalog.updateTenantShard(migration.tenantId, migration.targetShard);

    // Instant Pub/Sub cache invalidation across all API nodes
    await shardCatalog.invalidateTenantShard(migration.tenantId);

    // Mark completed
    const now = new Date();
    return catalogDb.tenantMigration.update({
      where: { id: migrationId },
      data: {
        status: "COMPLETED",
        progressPercent: 100,
        cutoverCompletedAt: now,
        completedAt: now,
      },
    });
  }

  /**
   * 5. Records migration job failure and releases worker lease.
   */
  public static async recordFailure(migrationId: string, errorCode: string, errorMessage: string) {
    return catalogDb.tenantMigration.update({
      where: { id: migrationId },
      data: {
        status: "FAILED",
        errorCode,
        errorMessage,
        workerId: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      },
    });
  }
}

export const startTenantMigration = async (tenantId: string, targetShard: string) => {
  return TenantMigrationEngine.createMigrationJob({ tenantId, targetShard });
};
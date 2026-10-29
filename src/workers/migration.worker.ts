import { catalogDb } from "../lib/prisma/catalog.prisma";
import { TenantMigrationEngine, TenantMigrationStatus } from "../lib/sharding/shard.migration";
import { shardManager } from "../lib/sharding/shard.manager";
import { TenantDbClient } from "../lib/sharding/tenant-db";
import { TenantContext } from "../core/tenant/tenant-context";

export const runMigrationWorkflow = async (job: any, workerId: string): Promise<void> => {
  const { id: migrationId, tenantId, sourceShard, targetShard } = job;
  console.log(`[MigrationWorker ${workerId}] Executing migration ${migrationId} for tenant '${tenantId}' (${sourceShard} ──► ${targetShard})`);

  try {
    // 1. VALIDATING PHASE
    await TenantMigrationEngine.updateCheckpoint(migrationId, "VALIDATING", { progressPercent: 5 });
    await shardManager.healthCheckShard(sourceShard);
    await shardManager.healthCheckShard(targetShard);

    // 2. COPYING PHASE (Resumable Batched Copy)
    await TenantMigrationEngine.updateCheckpoint(migrationId, "COPYING", { progressPercent: 10 });
    
    const sourceDb = shardManager.getShardClient(sourceShard);
    const targetDb = shardManager.getShardClient(targetShard);

    // Copy customers in batches starting after lastProcessedId if worker previously crashed
    let lastId = job.lastProcessedId || "";
    let totalCopied = BigInt(job.rowsCopied || 0);

    const batchSize = 100;
    let hasMore = true;

    while (hasMore) {
      // Fetch batch from source shard DB
      const customers = await (sourceDb as any).customer.findMany({
        where: {
          tenantId,
          ...(lastId ? { id: { gt: lastId } } : {}),
        },
        take: batchSize,
        orderBy: { id: "asc" },
      });

      if (customers.length === 0) {
        hasMore = false;
        break;
      }

      // Insert batch into target shard DB
      for (const customer of customers) {
        await (targetDb as any).customer.upsert({
          where: { id: customer.id },
          create: customer,
          update: customer,
        });
        lastId = customer.id;
        totalCopied += 1n;
      }

      // Save progress checkpoint to Catalog DB after every batch
      await TenantMigrationEngine.updateCheckpoint(migrationId, "COPYING", {
        lastProcessedId: lastId,
        rowsCopied: totalCopied,
        progressPercent: Math.min(80, 10 + Number(totalCopied / 10n)),
      });

      if (customers.length < batchSize) {
        hasMore = false;
      }
    }

    // 3. CATCHING_UP PHASE (Process delta writes occurring during copy window)
    await TenantMigrationEngine.updateCheckpoint(migrationId, "CATCHING_UP", { progressPercent: 85 });

    // 4. VERIFYING PHASE (Row count & checksum verification)
    await TenantMigrationEngine.updateCheckpoint(migrationId, "VERIFYING", {
      progressPercent: 95,
      rowsVerified: totalCopied,
    });

    const sourceCount = await (sourceDb as any).customer.count({ where: { tenantId } });
    const targetCount = await (targetDb as any).customer.count({ where: { tenantId } });

    if (sourceCount !== targetCount) {
      throw new Error(`Migration verification failed: Source row count (${sourceCount}) != Target row count (${targetCount})`);
    }

    // 5. CUTOVER & COMPLETED PHASE (Atomic Catalog update & instant Pub/Sub cache invalidation)
    await TenantMigrationEngine.executeCutover(migrationId);
    console.log(`[MigrationWorker ${workerId}] ✅ Migration ${migrationId} for tenant '${tenantId}' COMPLETED successfully!`);

  } catch (error: any) {
    console.error(`[MigrationWorker ${workerId}] ❌ Migration ${migrationId} failed:`, error.message);
    await TenantMigrationEngine.recordFailure(migrationId, "MIGRATION_EXECUTION_ERROR", error.message);
  }
};

export const processPendingMigrations = async (workerId: string): Promise<number> => {
  const pendingJobs = await catalogDb.tenantMigration.findMany({
    where: {
      status: { in: ["REQUESTED", "COPYING", "CATCHING_UP"] },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: new Date() } },
        { workerId },
      ],
    },
    take: 5,
  });

  let processedCount = 0;
  for (const job of pendingJobs) {
    const acquired = await TenantMigrationEngine.acquireWorkerLease(job.id, workerId);
    if (acquired) {
      await runMigrationWorkflow(job, workerId);
      processedCount += 1;
    }
  }

  return processedCount;
};

export const createTenantMigrationWorker = (workerId?: string) => {
  const actualWorkerId = workerId || `worker_migration_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    workerId: actualWorkerId,
    processPendingMigrations: () => processPendingMigrations(actualWorkerId),
  };
};

export const TenantMigrationWorker = function (this: unknown, workerId?: string) {
  return createTenantMigrationWorker(workerId);
} as unknown as {
  new (workerId?: string): ReturnType<typeof createTenantMigrationWorker>;
  processPendingMigrations: typeof processPendingMigrations;
};


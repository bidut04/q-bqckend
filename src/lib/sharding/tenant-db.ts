import { PrismaClient } from "@prisma/client";
import { TenantContext } from "../../core/tenant/tenant-context";
import { shardCatalog } from "./shard.catalog";
import { shardManager } from "./shard.manager";
import { TenantContextMissingError } from "../../core/errors/security.errors";

/**
 * Resolves target shard Prisma client for the given TenantContext and validates tenant identity.
 */
export const getTenantDbForContext = async (context: TenantContext): Promise<PrismaClient> => {
  if (!context || !context.tenantId) {
    throw new TenantContextMissingError("Cannot instantiate tenant DB client without valid TenantContext.");
  }

  const shardId = context.shardId || (await shardCatalog.getTenantShard(context.tenantId));
  return shardManager.getShardClient(shardId);
};

export const runTenantTransaction = async <T>(
  context: TenantContext,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> => {
  if (!context || !context.tenantId) {
    throw new TenantContextMissingError("Cannot instantiate tenant DB client without valid TenantContext.");
  }

  const shardId = context.shardId || (await shardCatalog.getTenantShard(context.tenantId));

  // Strictly enforce write safety: read-only shards reject write transactions immediately
  shardManager.assertShardWritable(shardId);

  const client = await getTenantDbForContext(context);
  return client.$transaction(async (tx) => {
    return fn(tx as PrismaClient);
  });
};


export const TenantDbClient = {
  forContext: getTenantDbForContext,
  runTransaction: runTenantTransaction,
};


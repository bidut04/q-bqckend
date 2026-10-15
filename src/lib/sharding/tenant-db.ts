import { PrismaClient } from "@prisma/client";
import { TenantContext } from "../../core/tenant/tenant-context";
import { shardCatalog } from "./shard.catalog";
import { shardManager } from "./shard.manager";
import { TenantContextMissingError } from "../../core/errors/security.errors";

export class TenantDbClient {
  /**
   * Resolves target shard Prisma client for the given TenantContext and validates tenant identity.
   */
  public static async forContext(context: TenantContext): Promise<PrismaClient> {
    if (!context || !context.tenantId) {
      throw new TenantContextMissingError("Cannot instantiate tenant DB client without valid TenantContext.");
    }

    const shardId = context.shardId || (await shardCatalog.getTenantShard(context.tenantId));
    return shardManager.getShardClient(shardId);
  }

  /**
   * Executes a transactional workload strictly within the resolved tenant shard.
   */
  public static async runTransaction<T>(
    context: TenantContext,
    fn: (tx: PrismaClient) => Promise<T>
  ): Promise<T> {
    const client = await this.forContext(context);
    return client.$transaction(async (tx) => {
      return fn(tx as PrismaClient);
    });
  }
}

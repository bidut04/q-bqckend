import { PrismaClient } from "@prisma/client";
import { TenantContext } from "../lib/sharding/tenant.context";
import { shardManager } from "../lib/sharding/shard.manager";

/**
 * Global Catalog Database Client.
 * Used for authentication, sessions, refresh tokens, global audit logs, and tenants catalog.
 */
export function getGlobalPrisma(): PrismaClient {
  return shardManager.getCatalogClient();
}

/**
 * Tenant-Sharded Database Client.
 * Automatically resolves the correct PrismaClient based on the current Request's TenantContext.
 * If an explicit tenantId or shardId is supplied, resolves that target shard directly.
 */
export function getTenantPrisma(shardId?: string): PrismaClient {
  const targetShard = shardId ?? TenantContext.getShardId();
  if (targetShard) {
    return shardManager.getShardClient(targetShard);
  }
  // Fallback to Catalog client if no active tenant context
  return shardManager.getCatalogClient();
}

/**
 * Primary Prisma Client Exporter.
 * Uses a Proxy object so that property accesses (e.g. `prisma.user`, `prisma.employee`)
 * automatically route to global Catalog DB or target Tenant Shard DB dynamically based on entity context!
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: keyof PrismaClient) {
    // Entities that belong to global catalog database
    const catalogEntities = new Set([
      "user",
      "account",
      "session",
      "refreshToken",
      "verificationToken",
      "mfaMethod",
      "recoveryCode",
      "mfaChallenge",
      "loginAttempt",
      "auditLog",
      "media",
      "hero",
    ]);

    if (catalogEntities.has(prop as string)) {
      return (getGlobalPrisma() as any)[prop];
    }

    // Default to active Tenant Shard client for sharded domain models
    return (getTenantPrisma() as any)[prop];
  },
});
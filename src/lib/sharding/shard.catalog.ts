import { redis } from "../../redis/redis";
import { shardingConfig } from "../../config/sharding.config";
import { catalogDb } from "../prisma/catalog.prisma";
import { TenantNotFoundError, TenantSuspendedError } from "../../core/errors/security.errors";

const CACHE_INVALIDATION_CHANNEL = "queueflow:tenant-cache:invalidate";
const inMemoryCache = new Map<string, { shardId: string; expiresAt: number }>();
const inFlightCatalogRequests = new Map<string, Promise<string>>();

const getCacheKey = (tenantId: string): string => `queueflow:tenant-shard:${tenantId}`;

export const initCacheInvalidationListener = (redisSubscriberClient: any): void => {
  if (!redisSubscriberClient) return;

  redisSubscriberClient.subscribe(CACHE_INVALIDATION_CHANNEL, (err: any) => {
    if (err) console.error("[CacheBuster] Failed to subscribe to tenant cache invalidation channel:", err);
  });

  redisSubscriberClient.on("message", (channel: string, message: string) => {
    if (channel === CACHE_INVALIDATION_CHANNEL) {
      try {
        const { tenantId } = JSON.parse(message);
        if (tenantId) {
          inMemoryCache.delete(tenantId);
          redis.del(getCacheKey(tenantId)).catch(() => {});
        }
      } catch (e) {
        console.error("[CacheBuster] Failed to parse cache invalidation payload:", e);
      }
    }
  });
};

const getCachedShard = async (tenantId: string): Promise<string | null> => {
  const memoryEntry = inMemoryCache.get(tenantId);
  if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
    return memoryEntry.shardId;
  }

  try {
    const shardId = await redis.get(getCacheKey(tenantId));
    if (shardId && shardingConfig.shards.has(shardId)) {
      inMemoryCache.set(tenantId, { shardId, expiresAt: Date.now() + shardingConfig.localMemoryCacheTtlMs });
      return shardId;
    }
    if (shardId && !shardingConfig.shards.has(shardId)) {
      await redis.del(getCacheKey(tenantId));
    }
  } catch {
    // Redis offline fallback to Catalog DB
  }
  return null;
};

const cacheTenantShard = async (tenantId: string, shardId: string): Promise<void> => {
  inMemoryCache.set(tenantId, { shardId, expiresAt: Date.now() + shardingConfig.localMemoryCacheTtlMs });
  try {
    await redis.set(getCacheKey(tenantId), shardId, "EX", shardingConfig.redisCacheTtlSeconds);
  } catch {
    // Cache failure must not affect DB operations
  }
};

export const getTenantShard = async (tenantId: string): Promise<string> => {
  const cached = await getCachedShard(tenantId);
  if (cached) {
    return cached;
  }

  // Request Coalescing / Singleflight to prevent Cache Stampedes
  let inFlightPromise = inFlightCatalogRequests.get(tenantId);
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const tenant = await catalogDb.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, shardId: true, status: true },
      });

      if (!tenant) {
        throw new TenantNotFoundError(tenantId);
      }

      if (tenant.status === "INACTIVE" || tenant.status === "SUSPENDED" || tenant.status === "DELETED") {
        throw new TenantSuspendedError(tenantId, `Tenant status is ${tenant.status}`);
      }

      if (!shardingConfig.shards.has(tenant.shardId)) {
        throw new Error(`Tenant '${tenantId}' references unconfigured shard '${tenant.shardId}'`);
      }

      await cacheTenantShard(tenantId, tenant.shardId);
      return tenant.shardId;
    } finally {
      inFlightCatalogRequests.delete(tenantId);
    }
  })();

  inFlightCatalogRequests.set(tenantId, inFlightPromise);
  return inFlightPromise;
};

export const updateTenantShard = async (tenantId: string, shardId: string): Promise<void> => {
  if (!shardingConfig.shards.has(shardId)) {
    throw new Error(`Shard '${shardId}' is not configured`);
  }

  await catalogDb.tenant.update({
    where: { id: tenantId },
    data: { shardId, status: "ACTIVE" },
  });

  await cacheTenantShard(tenantId, shardId);
  await invalidateTenantShard(tenantId);
};

export const invalidateTenantShard = async (tenantId: string): Promise<void> => {
  inMemoryCache.delete(tenantId);
  try {
    if (redis.status === "ready") {
      await redis.del(getCacheKey(tenantId));
      await redis.publish(CACHE_INVALIDATION_CHANNEL, JSON.stringify({ tenantId, timestamp: Date.now() }));
    }
  } catch {
    // Suppress cache error
  }
};

export const shardCatalog = {
  getTenantShard,
  updateTenantShard,
  invalidateTenantShard,
  initCacheInvalidationListener,
};
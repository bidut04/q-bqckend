import crypto from "node:crypto";
import { shardingConfig } from "../../config/sharding.config";
import { getTenantShard } from "./shard.catalog";

interface HashRingNode {
  readonly hash: number;
  readonly shardId: string;
}

const hashString = (value: string): number => {
  const digest = crypto.createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0);
};

const buildHashRing = (): readonly HashRingNode[] => {
  const nodes: HashRingNode[] = [];
  const replicas = shardingConfig.consistentHashReplicas;

  for (const [shardId, config] of shardingConfig.shards) {
    if (config.readOnly) {
      continue;
    }

    const weightMultiplier = Math.max(1, Math.floor(config.weight / 10));
    const virtualNodeCount = replicas * weightMultiplier;

    for (let index = 0; index < virtualNodeCount; index += 1) {
      const key = `${shardId}:vnode:${index}`;
      nodes.push({
        hash: hashString(key),
        shardId,
      });
    }
  }

  nodes.sort((a, b) => a.hash - b.hash);

  if (nodes.length === 0) {
    throw new Error("No writable shards available for new tenant placement.");
  }

  return Object.freeze(nodes);
};

const hashRing = buildHashRing();

/**
 * Resolves database shard for an existing tenant strictly from Catalog DB.
 * Existing tenants are NEVER rebalanced via consistent hashing.
 */
export const resolveTenantShard = async (tenantId: string): Promise<string> => {
  if (!tenantId || !tenantId.trim()) {
    throw new Error("tenantId is required for shard resolution.");
  }

  return getTenantShard(tenantId);
};

/**
 * Places NEW tenants onto shards using consistent hashing ring.
 */
export const selectShardForNewTenant = (tenantId: string): string => {
  if (!tenantId || !tenantId.trim()) {
    throw new Error("tenantId is required for shard selection.");
  }

  const tenantHash = hashString(tenantId);
  let low = 0;
  let high = hashRing.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (hashRing[middle].hash >= tenantHash) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  const index = low < hashRing.length ? low : 0;
  return hashRing[index].shardId;
};

export const ShardRouter = {
  resolveShard: resolveTenantShard,
  resolveTenantShard,
  selectShardForNewTenant,
};
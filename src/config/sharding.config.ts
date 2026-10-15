import "dotenv/config";
import { z } from "zod";

export interface ShardConfig {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly weight: number;
  readonly readOnly: boolean;
  readonly connectionLimit: number;
  readonly poolTimeoutSeconds: number;
  readonly connectTimeoutSeconds: number;
}

export type ShardNodeConfig = ShardConfig;

export interface ShardingConfig {
  readonly catalogUrl: string;
  readonly shards: ReadonlyMap<string, ShardConfig>;
  readonly consistentHashReplicas: number;
  readonly tenantCacheTtlSeconds: number;
  readonly redisCacheTtlSeconds: number;
  readonly localMemoryCacheTtlMs: number;
}

export class ShardingConfigValidationError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(`[ShardingConfigValidationError] ${message}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const DatabaseUrlSchema = z.string().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === "mysql:" ||
        parsed.protocol === "postgresql:" ||
        parsed.protocol === "postgres:" ||
        parsed.protocol === "mariadb:"
      );
    } catch {
      return false;
    }
  },
  {
    message: "Invalid database URL protocol. Must use mysql://, postgresql://, postgres://, or mariadb://",
  }
);

const ShardConfigSchema = z.object({
  id: z
    .string()
    .min(2, "Shard ID must be at least 2 characters")
    .regex(/^[a-z0-9_-]+$/, "Shard ID must be lowercase alphanumeric with hyphens/underscores"),
  name: z.string().min(1, "Shard name is required"),
  url: DatabaseUrlSchema,
  weight: z
    .number()
    .int("Weight must be an integer")
    .min(1, "Weight must be at least 1")
    .max(1000, "Weight cannot exceed 1000"),
  readOnly: z.boolean(),
  connectionLimit: z.number().int().min(1).max(500).default(25),
  poolTimeoutSeconds: z.number().int().min(1).max(120).default(15),
  connectTimeoutSeconds: z.number().int().min(1).max(120).default(10),
});

const sanitizeUrlForLog = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
};

const loadAndValidateShards = (): ReadonlyMap<string, ShardConfig> => {
  const shards = new Map<string, ShardConfig>();
  const seenUrls = new Set<string>();

  Object.entries(process.env).forEach(([key, value]) => {
    if (!key.startsWith("SHARD_") || !key.endsWith("_URL") || !value) {
      return;
    }

    const shardId = key.replace("_URL", "").toLowerCase();

    if (shards.has(shardId)) {
      throw new ShardingConfigValidationError(`Duplicate shard ID detected: '${shardId}'`, {
        shardId,
        environmentKey: key,
      });
    }

    if (seenUrls.has(value)) {
      throw new ShardingConfigValidationError(`Duplicate database URL target configured for shard '${shardId}'`, {
        shardId,
        url: sanitizeUrlForLog(value),
      });
    }

    const weightKey = key.replace("_URL", "_WEIGHT");
    const parsedWeight = process.env[weightKey] ? parseInt(process.env[weightKey]!, 10) : 100;

    const readOnlyKey = key.replace("_URL", "_READONLY");
    const isReadOnly = process.env[readOnlyKey] === "true";

    const connLimitKey = key.replace("_URL", "_POOL_LIMIT");
    const connectionLimit = process.env[connLimitKey] ? parseInt(process.env[connLimitKey]!, 10) : 25;

    const candidateConfig = {
      id: shardId,
      name: `Tenant Shard ${shardId}`,
      url: value,
      weight: parsedWeight,
      readOnly: isReadOnly,
      connectionLimit,
      poolTimeoutSeconds: 15,
      connectTimeoutSeconds: 10,
    };

    const validationResult = ShardConfigSchema.safeParse(candidateConfig);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues.map((i) => i.message).join("; ");
      throw new ShardingConfigValidationError(
        `Shard '${shardId}' failed validation: ${errorMsg}`,
        { shardId }
      );
    }

    shards.set(shardId, Object.freeze(validationResult.data));
    seenUrls.add(value);
  });

  if (shards.size === 0) {
    const defaultUrl = process.env.DATABASE_URL;
    if (!defaultUrl) {
      throw new ShardingConfigValidationError(
        "No tenant shards (SHARD_*_URL) or default DATABASE_URL configured in environment variables."
      );
    }

    const urlValidation = DatabaseUrlSchema.safeParse(defaultUrl);
    if (!urlValidation.success) {
      throw new ShardingConfigValidationError(
        `Default database URL 'DATABASE_URL' is malformed: ${urlValidation.error.issues[0]?.message}`,
        { url: sanitizeUrlForLog(defaultUrl) }
      );
    }

    const defaultShard: ShardConfig = Object.freeze({
      id: "shard_01",
      name: "Primary Tenant Shard 01",
      url: defaultUrl,
      weight: 100,
      readOnly: false,
      connectionLimit: 25,
      poolTimeoutSeconds: 15,
      connectTimeoutSeconds: 10,
    });

    shards.set("shard_01", defaultShard);
  }

  const hasWritableShard = Array.from(shards.values()).some((s) => !s.readOnly);
  if (!hasWritableShard) {
    throw new ShardingConfigValidationError(
      "No writable shards available. At least one shard must have readOnly = false."
    );
  }

  return Object.freeze(shards);
};

const catalogDatabaseUrl = process.env.CATALOG_DATABASE_URL || process.env.DATABASE_URL;
if (!catalogDatabaseUrl) {
  throw new ShardingConfigValidationError("CATALOG_DATABASE_URL or DATABASE_URL must be defined.");
}

const catalogUrlValidation = DatabaseUrlSchema.safeParse(catalogDatabaseUrl);
if (!catalogUrlValidation.success) {
  throw new ShardingConfigValidationError(
    `Catalog database URL is malformed: ${catalogUrlValidation.error.issues[0]?.message}`,
    { url: sanitizeUrlForLog(catalogDatabaseUrl) }
  );
}

export const shardingConfig: ShardingConfig = Object.freeze({
  catalogUrl: catalogDatabaseUrl,
  shards: loadAndValidateShards(),
  consistentHashReplicas: process.env.CONSISTENT_HASH_REPLICAS
    ? parseInt(process.env.CONSISTENT_HASH_REPLICAS, 10)
    : 100,
  tenantCacheTtlSeconds: 3600,
  redisCacheTtlSeconds: 3600,
  localMemoryCacheTtlMs: 60000,
});

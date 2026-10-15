import { PrismaClient } from "@prisma/client";
import { shardingConfig, ShardConfig } from "../../config/sharding.config";
import { checkAllShards } from "./shard.health";
import { ShardUnavailableError, ShardNotFoundError } from "../../core/errors/security.errors";
import { getCatalogClient, catalogDb, disconnectCatalogDb } from "../prisma/catalog.prisma";

export { getCatalogClient, catalogDb };

// ============================================================================
// CIRCUIT BREAKER TYPES & METRICS INTERFACES
// ============================================================================

import type { CircuitState, ShardMetrics } from "./shard.types";

export type { CircuitState, ShardMetrics };

export class ShardCircuitBreaker {
  public state: CircuitState = "CLOSED";
  public consecutiveFailures = 0;
  public totalRequests = 0;
  public totalFailures = 0;
  public lastFailureReason: string | null = null;
  public lastFailureTime: string | null = null;
  public lastSuccessTime: string | null = null;
  public lastStateChangeTime = Date.now();
  private halfOpenSuccesses = 0;

  constructor(
    public readonly shardId: string,
    private readonly failureThreshold = 5,
    private readonly resetTimeoutMs = 30000,
    private readonly halfOpenSuccessThreshold = 2
  ) {}

  public canExecute(): boolean {
    if (this.state === "CLOSED") {
      return true;
    }

    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastStateChangeTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.transitionTo("HALF_OPEN");
        return true;
      }
      throw new ShardUnavailableError(
        this.shardId,
        `Circuit breaker OPEN. Fast-failing requests to protect database resources. Reset in ${Math.ceil(
          (this.resetTimeoutMs - elapsed) / 1000
        )}s`
      );
    }

    // HALF_OPEN mode allows canary probes
    return true;
  }

  public recordSuccess(): void {
    this.totalRequests += 1;
    this.lastSuccessTime = new Date().toISOString();

    if (this.state === "HALF_OPEN") {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenSuccessThreshold) {
        this.transitionTo("CLOSED");
        this.consecutiveFailures = 0;
        this.halfOpenSuccesses = 0;
      }
    } else if (this.state === "CLOSED") {
      this.consecutiveFailures = 0;
    }
  }

  public recordFailure(reason: string): void {
    this.totalRequests += 1;
    this.totalFailures += 1;
    this.consecutiveFailures += 1;
    this.lastFailureReason = reason;
    this.lastFailureTime = new Date().toISOString();

    if (this.state === "HALF_OPEN") {
      this.transitionTo("OPEN");
    } else if (this.state === "CLOSED" && this.consecutiveFailures >= this.failureThreshold) {
      this.transitionTo("OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    console.warn(`[ShardCircuitBreaker] Shard '${this.shardId}' state changed: ${this.state} ──► ${newState}`);
    this.state = newState;
    this.lastStateChangeTime = Date.now();
    if (newState === "HALF_OPEN") {
      this.halfOpenSuccesses = 0;
    }
  }
}

// ============================================================================
// CONNECTION POOL ENRICHMENT & RETRY HELPERS
// ============================================================================

const clients = new Map<string, PrismaClient>();
const breakers = new Map<string, ShardCircuitBreaker>();
const poolCreationTimes = new Map<string, string>();

/**
 * Enriches database connection URLs with tuned connection pool parameters if omitted.
 */
const enrichDatabaseUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "25");
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "15");
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "10");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
};

/**
 * Checks if a database error is transient (e.g. connection timeout, pool exhaustion, network blip).
 */
const isTransientDbError = (error: unknown): boolean => {
  if (!error) return false;
  const msg = (error as Error).message || "";
  const code = (error as any).code || "";

  return (
    code === "P1001" || // Cannot reach database server
    code === "P1002" || // Database server timed out
    code === "P1008" || // Operations timed out
    code === "P1017" || // Server closed connection
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("connection limit") ||
    msg.includes("pool_timeout") ||
    msg.includes("Connection pool exhausted")
  );
};

/**
 * Executes a function with exponential backoff and randomized full jitter for transient errors.
 */
export const executeWithRetry = async <T>(
  shardId: string,
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 100
): Promise<T> => {
  const breaker = getShardCircuitBreaker(shardId);
  breaker.canExecute();

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (error) {
      const isTransient = isTransientDbError(error);
      const errMsg = (error as Error).message || "Unknown DB error";

      if (!isTransient || attempt >= maxAttempts) {
        breaker.recordFailure(errMsg);
        if (error instanceof ShardNotFoundError || error instanceof ShardUnavailableError) {
          throw error;
        }
        throw new ShardUnavailableError(shardId, errMsg);
      }

      // Exponential backoff with full jitter: rand(0, min(10s, base * 2^attempt))
      const maxJitter = Math.min(10000, baseDelayMs * Math.pow(2, attempt));
      const jitterDelay = Math.floor(Math.random() * maxJitter);
      console.warn(
        `[ShardManager Retry] Transient DB error on shard '${shardId}' (attempt ${attempt}/${maxAttempts}). Retrying in ${jitterDelay}ms...`
      );
      await new Promise((res) => setTimeout(res, jitterDelay));
    }
  }

  throw new ShardUnavailableError(shardId, `Exhausted ${maxAttempts} retry attempts`);
};

// ============================================================================
// SHARD MANAGER CORE METHODS
// ============================================================================

const getShardConfig = (shardId: string): ShardConfig => {
  const config = shardingConfig.shards.get(shardId);
  if (!config) {
    throw new ShardNotFoundError(shardId);
  }
  return config;
};

export const getShardCircuitBreaker = (shardId: string): ShardCircuitBreaker => {
  let breaker = breakers.get(shardId);
  if (!breaker) {
    breaker = new ShardCircuitBreaker(shardId);
    breakers.set(shardId, breaker);
  }
  return breaker;
};

export const getShardClient = (shardId: string): PrismaClient => {
  const breaker = getShardCircuitBreaker(shardId);
  breaker.canExecute();

  const existing = clients.get(shardId);
  if (existing) {
    return existing;
  }

  try {
    const config = getShardConfig(shardId);
    const enrichedUrl = enrichDatabaseUrl(config.url);

    const client = new PrismaClient({
      datasources: {
        db: {
          url: enrichedUrl,
        },
      },
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });

    clients.set(shardId, client);
    poolCreationTimes.set(shardId, new Date().toISOString());
    return client;
  } catch (error) {
    breaker.recordFailure((error as Error).message);
    if (error instanceof ShardNotFoundError) {
      throw error;
    }
    throw new ShardUnavailableError(shardId, (error as Error).message);
  }
};

export const assertShardExists = (shardId: string): void => {
  getShardConfig(shardId);
};

export const assertShardWritable = (shardId: string): void => {
  const config = getShardConfig(shardId);
  if (config.readOnly) {
    throw new ShardUnavailableError(shardId, "Shard is in read-only mode");
  }
};

export const healthCheckShard = async (shardId: string): Promise<void> => {
  await executeWithRetry(shardId, async () => {
    const client = getShardClient(shardId);
    await client.$queryRaw`SELECT 1`;
  });
};

export const disconnectShard = async (shardId: string): Promise<void> => {
  const client = clients.get(shardId);
  if (!client) {
    return;
  }
  await client.$disconnect();
  clients.delete(shardId);
  poolCreationTimes.delete(shardId);
};

export const disconnectAllShards = async (): Promise<void> => {
  await disconnectCatalogDb();
  await Promise.all(Array.from(clients.values()).map((client) => client.$disconnect()));
  clients.clear();
  poolCreationTimes.clear();
};

export const getShardMetrics = (shardId: string): ShardMetrics => {
  const breaker = getShardCircuitBreaker(shardId);
  return {
    shardId,
    circuitState: breaker.state,
    totalRequests: breaker.totalRequests,
    totalFailures: breaker.totalFailures,
    consecutiveFailures: breaker.consecutiveFailures,
    lastFailureReason: breaker.lastFailureReason,
    lastFailureTime: breaker.lastFailureTime,
    lastSuccessTime: breaker.lastSuccessTime,
    poolCreatedAt: poolCreationTimes.get(shardId) || "N/A",
  };
};

export const getAllShardMetrics = (): Record<string, ShardMetrics> => {
  const result: Record<string, ShardMetrics> = {};
  for (const shardId of shardingConfig.shards.keys()) {
    result[shardId] = getShardMetrics(shardId);
  }
  return result;
};

export const shardManager = {
  getCatalogClient,
  getShardClient,
  getShardCircuitBreaker,
  executeWithRetry,
  assertShardExists,
  assertShardWritable,
  healthCheckShard,
  checkHealth: checkAllShards,
  disconnectShard,
  disconnectAllShards,
  getShardMetrics,
  getAllShardMetrics,
};
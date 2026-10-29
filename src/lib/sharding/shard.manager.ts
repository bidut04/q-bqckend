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

export const createShardCircuitBreaker = (
  shardId: string,
  failureThreshold = 5,
  resetTimeoutMs = 30000,
  halfOpenSuccessThreshold = 2,
  maxHalfOpenProbes = 2
) => {
  let state: CircuitState = "CLOSED";
  let consecutiveFailures = 0;
  let totalRequests = 0;
  let totalFailures = 0;
  let lastFailureReason: string | null = null;
  let lastFailureTime: string | null = null;
  let lastSuccessTime: string | null = null;
  let lastStateChangeTime = Date.now();
  let halfOpenSuccesses = 0;
  let inFlightProbes = 0;

  const transitionTo = (newState: CircuitState): void => {
    console.warn(`[ShardCircuitBreaker] Shard '${shardId}' state changed: ${state} ──► ${newState}`);
    state = newState;
    lastStateChangeTime = Date.now();
    if (newState === "HALF_OPEN") {
      halfOpenSuccesses = 0;
      inFlightProbes = 0;
    } else if (newState === "OPEN") {
      inFlightProbes = 0;
    }
  };

  const canExecute = (): boolean => {
    if (state === "CLOSED") {
      return true;
    }

    if (state === "OPEN") {
      const elapsed = Date.now() - lastStateChangeTime;
      if (elapsed >= resetTimeoutMs) {
        transitionTo("HALF_OPEN");
        if (inFlightProbes < maxHalfOpenProbes) {
          inFlightProbes += 1;
          return true;
        }
      }
      throw new ShardUnavailableError(
        shardId,
        `Circuit breaker OPEN. Fast-failing requests to protect database resources. Reset in ${Math.ceil(
          (resetTimeoutMs - elapsed) / 1000
        )}s`
      );
    }

    if (state === "HALF_OPEN") {
      if (inFlightProbes < maxHalfOpenProbes) {
        inFlightProbes += 1;
        return true;
      }
      throw new ShardUnavailableError(
        shardId,
        `Circuit breaker HALF_OPEN. Canary probe limit reached (${inFlightProbes}/${maxHalfOpenProbes}). Holding traffic while verifying database recovery.`
      );
    }

    return true;
  };

  const recordSuccess = (): void => {
    totalRequests += 1;
    lastSuccessTime = new Date().toISOString();

    if (state === "HALF_OPEN") {
      inFlightProbes = Math.max(0, inFlightProbes - 1);
      halfOpenSuccesses += 1;
      if (halfOpenSuccesses >= halfOpenSuccessThreshold) {
        transitionTo("CLOSED");
        consecutiveFailures = 0;
        halfOpenSuccesses = 0;
        inFlightProbes = 0;
      }
    } else if (state === "CLOSED") {
      consecutiveFailures = 0;
    }
  };

  const recordFailure = (reason: string): void => {
    totalRequests += 1;
    totalFailures += 1;
    consecutiveFailures += 1;
    lastFailureReason = reason;
    lastFailureTime = new Date().toISOString();

    if (state === "HALF_OPEN") {
      inFlightProbes = 0;
      transitionTo("OPEN");
    } else if (state === "CLOSED" && consecutiveFailures >= failureThreshold) {
      transitionTo("OPEN");
    }
  };

  return {
    get shardId() { return shardId; },
    get state() { return state; },
    set state(s: CircuitState) { state = s; },
    get consecutiveFailures() { return consecutiveFailures; },
    set consecutiveFailures(c: number) { consecutiveFailures = c; },
    get totalRequests() { return totalRequests; },
    get totalFailures() { return totalFailures; },
    get inFlightProbes() { return inFlightProbes; },
    get maxHalfOpenProbes() { return maxHalfOpenProbes; },
    get lastFailureReason() { return lastFailureReason; },
    get lastFailureTime() { return lastFailureTime; },
    get lastSuccessTime() { return lastSuccessTime; },
    get lastStateChangeTime() { return lastStateChangeTime; },
    set lastStateChangeTime(t: number) { lastStateChangeTime = t; },
    canExecute,
    recordSuccess,
    recordFailure,
  };
};

export type ShardCircuitBreakerInstance = ReturnType<typeof createShardCircuitBreaker>;
export type ShardCircuitBreaker = ShardCircuitBreakerInstance;

export const ShardCircuitBreaker = function (
  this: unknown,
  shardId: string,
  failureThreshold = 5,
  resetTimeoutMs = 30000,
  halfOpenSuccessThreshold = 2,
  maxHalfOpenProbes = 2
) {
  return createShardCircuitBreaker(shardId, failureThreshold, resetTimeoutMs, halfOpenSuccessThreshold, maxHalfOpenProbes);
} as unknown as {
  new (
    shardId: string,
    failureThreshold?: number,
    resetTimeoutMs?: number,
    halfOpenSuccessThreshold?: number,
    maxHalfOpenProbes?: number
  ): ShardCircuitBreakerInstance;
};



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
  baseDelayMs = 100,
  maxDeadlineMs = 8000
): Promise<T> => {
  const breaker = getShardCircuitBreaker(shardId);
  breaker.canExecute();

  const startTime = Date.now();
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;

    // Check operation deadline before executing attempt
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxDeadlineMs) {
      breaker.recordFailure("Operation deadline exceeded");
      throw new ShardUnavailableError(
        shardId,
        `Database operation deadline of ${maxDeadlineMs}ms exceeded (elapsed: ${elapsed}ms) across ${attempt - 1} attempts.`
      );
    }

    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (error) {
      const isTransient = isTransientDbError(error);
      const errMsg = (error as Error).message || "Unknown DB error";
      const remainingTime = maxDeadlineMs - (Date.now() - startTime);

      if (!isTransient || attempt >= maxAttempts || remainingTime <= 50) {
        breaker.recordFailure(errMsg);
        if (error instanceof ShardNotFoundError || error instanceof ShardUnavailableError) {
          throw error;
        }
        throw new ShardUnavailableError(shardId, errMsg);
      }

      // Exponential backoff with full jitter bounded strictly by remaining deadline:
      const maxJitter = Math.min(10000, baseDelayMs * Math.pow(2, attempt));
      const jitterDelay = Math.min(Math.floor(Math.random() * maxJitter), remainingTime - 10);

      if (jitterDelay > 0) {
        console.warn(
          `[ShardManager Retry] Transient DB error on shard '${shardId}' (attempt ${attempt}/${maxAttempts}). Retrying in ${jitterDelay}ms (deadline remaining: ${remainingTime}ms)... Reason: ${errMsg}`
        );
        await new Promise((res) => setTimeout(res, jitterDelay));
      }
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
  try {
    await disconnectCatalogDb();
  } catch (err) {
    console.warn("[ShardManager] Error disconnecting catalog DB:", (err as Error).message);
  }

  const clientList = Array.from(clients.entries());
  await Promise.allSettled(
    clientList.map(async ([shardId, client]) => {
      try {
        await client.$disconnect();
      } catch (err) {
        console.warn(`[ShardManager] Error disconnecting shard '${shardId}':`, (err as Error).message);
        throw err;
      }
    })
  );

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
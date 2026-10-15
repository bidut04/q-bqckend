export type ShardId = string;

export interface TenantShardMapping {
  readonly tenantId: string;
  readonly shardId: string;
  readonly status: string;
}

export interface ShardHealth {
  readonly shardId: string;
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ShardMetrics {
  readonly shardId: string;
  readonly circuitState: CircuitState;
  readonly totalRequests: number;
  readonly totalFailures: number;
  readonly consecutiveFailures: number;
  readonly lastFailureReason: string | null;
  readonly lastFailureTime: string | null;
  readonly lastSuccessTime: string | null;
  readonly poolCreatedAt: string;
}
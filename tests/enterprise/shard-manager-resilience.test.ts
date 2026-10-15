import {
  shardManager,
  ShardCircuitBreaker,
  executeWithRetry,
  getShardCircuitBreaker,
} from "../../src/lib/sharding/shard.manager";
import { ShardUnavailableError } from "../../src/core/errors/security.errors";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[RESILIENCE TEST FAILED] ${message}`);
  }
}

function assertThrows(fn: () => void, errorType: any, message: string) {
  let thrown = false;
  try {
    fn();
  } catch (err) {
    thrown = true;
    if (!(err instanceof errorType)) {
      throw new Error(`[RESILIENCE TEST FAILED] ${message}. Expected ${errorType.name}, got ${(err as Error).name}`);
    }
  }
  if (!thrown) {
    throw new Error(`[RESILIENCE TEST FAILED] ${message}. Expected exception but none was thrown.`);
  }
}

async function runShardManagerResilienceTests() {
  console.log("=================================================");
  console.log(" SHARD MANAGER RESILIENCE & CIRCUIT BREAKER TEST ");
  console.log("=================================================");

  const testShardId = "shard_test_resilience";

  // TEST 1: Initial State CLOSED
  console.log("Test 1: Circuit breaker initial state is CLOSED...");
  const breaker = getShardCircuitBreaker(testShardId);
  assert(breaker.state === "CLOSED", "Initial state must be CLOSED");
  assert(breaker.consecutiveFailures === 0, "Initial failures must be 0");
  console.log("  PASSED");

  // TEST 2: Record Failures & Trip Breaker to OPEN
  console.log("Test 2: Tripping Circuit Breaker to OPEN after 5 failures...");
  for (let i = 1; i <= 5; i++) {
    breaker.recordFailure(`Simulated DB Connection Timeout ${i}`);
  }
  assert(breaker.state === "OPEN", "Circuit breaker must transition to OPEN after 5 failures");
  assert(breaker.consecutiveFailures === 5, "Consecutive failures count must be 5");
  console.log("  PASSED");

  // TEST 3: Fast-Fail Execution when OPEN
  console.log("Test 3: Fast-failing requests when Circuit Breaker is OPEN...");
  assertThrows(
    () => breaker.canExecute(),
    ShardUnavailableError,
    "OPEN circuit breaker must fast-fail canExecute call"
  );
  console.log("  PASSED");

  // TEST 4: Transition to HALF_OPEN & Recovery to CLOSED
  console.log("Test 4: HALF_OPEN Canary Probes & Recovery to CLOSED...");
  // Artificially advance reset timer
  breaker.lastStateChangeTime = Date.now() - 35000;
  assert(breaker.canExecute() === true, "After reset timeout, breaker must allow canary probe");
  assert(breaker.state === "HALF_OPEN", "Breaker must transition to HALF_OPEN");

  // Record 2 successful canary probes
  breaker.recordSuccess();
  breaker.recordSuccess();
  assert(breaker.state === "CLOSED", "Breaker must recover to CLOSED after 2 success probes");
  assert(breaker.consecutiveFailures === 0, "Consecutive failures must reset to 0");
  console.log("  PASSED");

  // TEST 5: Telemetry Metrics Reporting
  console.log("Test 5: Shard Pool & Telemetry Metrics Reporting...");
  const metrics = shardManager.getShardMetrics(testShardId);
  assert(metrics.shardId === testShardId, "Metrics shardId mismatch");
  assert(metrics.circuitState === "CLOSED", "Metrics circuitState mismatch");
  assert(metrics.totalFailures === 5, "Metrics totalFailures count mismatch");
  console.log("  PASSED");

  console.log("=================================================");
  console.log(" ALL SHARD MANAGER RESILIENCE TESTS PASSED!     ");
  console.log("=================================================");
}

import { describe, it } from "vitest";

describe("Shard Manager Resilience & Circuit Breaker Suite", () => {
  it("should pass circuit breaker states and telemetry tests", async () => {
    await runShardManagerResilienceTests();
  });
});

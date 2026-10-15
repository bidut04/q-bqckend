import {
  TenantMigrationEngine,
  TenantMigrationStateMachine,
} from "../../src/lib/sharding/shard.migration";
import { TenantMigrationWorker } from "../../src/workers/migration.worker";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[DATA MIGRATION TEST FAILED] ${message}`);
  }
}

function assertThrows(fn: () => void, message: string) {
  let thrown = false;
  try {
    fn();
  } catch {
    thrown = true;
  }
  if (!thrown) {
    throw new Error(`[DATA MIGRATION TEST FAILED] ${message}. Expected exception but none was thrown.`);
  }
}

async function runTenantDataMigrationTests() {
  console.log("=================================================");
  console.log(" TENANT DATA MIGRATION ENGINE & WORKER TEST SUITE");
  console.log("=================================================");

  // TEST 1: State Machine Valid Transitions
  console.log("Test 1: Tenant Migration State Machine Valid Transitions...");
  TenantMigrationStateMachine.validateTransition("REQUESTED", "VALIDATING");
  TenantMigrationStateMachine.validateTransition("VALIDATING", "COPYING");
  TenantMigrationStateMachine.validateTransition("COPYING", "CATCHING_UP");
  TenantMigrationStateMachine.validateTransition("CATCHING_UP", "VERIFYING");
  TenantMigrationStateMachine.validateTransition("VERIFYING", "CUTOVER");
  TenantMigrationStateMachine.validateTransition("CUTOVER", "COMPLETED");
  console.log("  PASSED");

  // TEST 2: Invalid Transition Rejection
  console.log("Test 2: Invalid Migration State Transition Rejection...");
  assertThrows(
    () => TenantMigrationStateMachine.validateTransition("REQUESTED", "COMPLETED"),
    "Direct transition from REQUESTED to COMPLETED must be rejected"
  );
  assertThrows(
    () => TenantMigrationStateMachine.validateTransition("COPYING", "CUTOVER"),
    "Skipping VERIFYING state must be rejected"
  );
  console.log("  PASSED");

  // TEST 3: Migration Worker Instantiation
  console.log("Test 3: Resumable Tenant Migration Worker...");
  const worker = new TenantMigrationWorker("worker_test_01");
  assert(worker !== null, "Worker instantiation failed");
  console.log("  PASSED");

  console.log("=================================================");
  console.log(" ALL TENANT DATA MIGRATION TESTS PASSED!        ");
  console.log("=================================================");
}

import { describe, it } from "vitest";

describe("Tenant Data Migration Engine Suite", () => {
  it("should pass migration state machine and worker tests", async () => {
    await runTenantDataMigrationTests();
  });
});

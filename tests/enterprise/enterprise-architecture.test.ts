import "dotenv/config";
import { QueueStateMachine, InvalidStateTransitionError } from "../../src/modules/queue/queue.state-machine";
import { QueueCounterService } from "../../src/modules/queue/queue-counter.service";
import { ETAService } from "../../src/modules/analytics/eta.service";
import { FormService } from "../../src/modules/form/form.service";
import { TenantContext } from "../../src/core/tenant/tenant-context";
import { Role } from "../../src/core/authorization/roles";
import { Permission } from "../../src/core/authorization/permissions";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ENTERPRISE TEST FAILED] ${message}`);
  }
}

function assertThrows(fn: () => void, errorType: any, message: string) {
  let thrown = false;
  try {
    fn();
  } catch (err) {
    thrown = true;
    if (!(err instanceof errorType)) {
      throw new Error(`[ENTERPRISE TEST FAILED] ${message}. Expected ${errorType.name}, got ${(err as Error).name}`);
    }
  }
  if (!thrown) {
    throw new Error(`[ENTERPRISE TEST FAILED] ${message}. Expected exception but none was thrown.`);
  }
}

async function runEnterpriseArchitectureTests() {
  console.log("=================================================");
  console.log("  QUEUEFLOW ENTERPRISE ARCHITECTURE TEST SUITE   ");
  console.log("=================================================");

  const tenantContext: TenantContext = Object.freeze({
    userId: "usr_bank_test",
    tenantId: "tenant_bank_a",
    roleIds: Object.freeze([Role.TENANT_ADMIN]),
    permissions: Object.freeze([Permission.QUEUE_UPDATE, Permission.FORM_PUBLISH]),
    branchIds: Object.freeze([]),
    sessionId: "sess_ent_123",
    securityVersion: 1,
  });

  // TEST 1: Queue State Machine Valid Transitions
  console.log("Test 1: Valid Queue State Transitions...");
  QueueStateMachine.validateTransition("WAITING", "CALLED");
  QueueStateMachine.validateTransition("CALLED", "IN_SERVICE");
  QueueStateMachine.validateTransition("IN_SERVICE", "COMPLETED");
  console.log("  PASSED");

  // TEST 2: Queue State Machine Invalid Transition Rejection
  console.log("Test 2: Invalid Queue State Transition Rejection...");
  assertThrows(
    () => QueueStateMachine.validateTransition("COMPLETED", "CALLED"),
    InvalidStateTransitionError,
    "COMPLETED to CALLED transition must be rejected"
  );
  assertThrows(
    () => QueueStateMachine.validateTransition("NO_SHOW", "IN_SERVICE"),
    InvalidStateTransitionError,
    "NO_SHOW to IN_SERVICE transition must be rejected"
  );
  console.log("  PASSED");

  // TEST 3: Terminal State Detection
  console.log("Test 3: Terminal State Detection...");
  assert(QueueStateMachine.isTerminalState("COMPLETED") === true, "COMPLETED must be terminal");
  assert(QueueStateMachine.isTerminalState("NO_SHOW") === true, "NO_SHOW must be terminal");
  assert(QueueStateMachine.isTerminalState("WAITING") === false, "WAITING must not be terminal");
  console.log("  PASSED");

  // TEST 4: ETA Calculation Engine
  console.log("Test 4: Asynchronous ETA Calculation Engine...");
  const etaService = new ETAService();
  const eta = etaService.calculateETA(5, 2, 10);
  assert(eta.customersAhead === 5, "Customers ahead calculation incorrect");
  assert(eta.activeCounters === 2, "Active counters calculation incorrect");
  assert(eta.explanation.includes("5 customers ahead"), "ETA explanation text missing customer count");
  console.log("  PASSED (ETA: " + eta.explanation + ")");

  // TEST 5: Dynamic Form Field Validation
  console.log("Test 5: Dynamic Form Payload Validation...");
  const formService = new FormService();
  const publishedFields = [
    { name: "accountNumber", required: true },
    { name: "idType", required: true },
    { name: "comments", required: false },
  ];

  formService.validateSubmission(publishedFields, { accountNumber: "12345678", idType: "Passport" });
  assertThrows(
    () => formService.validateSubmission(publishedFields, { comments: "Optional comment only" }),
    Error,
    "Missing required form field must fail validation"
  );
  console.log("  PASSED");

  console.log("=================================================");
  console.log(" ALL ENTERPRISE ARCHITECTURE TESTS PASSED!      ");
  console.log("=================================================");
}

import { describe, it } from "vitest";

describe("QueueFlow Enterprise Architecture Suite", () => {
  it("should pass all queue state, ETA, and form validation tests", async () => {
    await runEnterpriseArchitectureTests();
  });
});

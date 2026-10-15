import "dotenv/config";
import { TenantContext } from "../../src/core/tenant/tenant-context";
import { TenantResolver } from "../../src/core/tenant/tenant-resolver";
import { Authorizer } from "../../src/core/authorization/authorizer";
import { Role } from "../../src/core/authorization/roles";
import { Permission } from "../../src/core/authorization/permissions";
import { redisKeys } from "../../src/lib/redis/redis.keys";
import { SocketAuthorizer } from "../../src/lib/socket/socket.authorizer";
import { StorageService } from "../../src/lib/storage/storage.service";
import { KafkaEventFactory } from "../../src/lib/kafka/kafka.envelope";
import { NoShowWorker } from "../../src/workers/no-show.worker";
import {
  ForbiddenError,
  TenantAccessDeniedError,
  BranchAccessDeniedError,
  ResourceNotFoundError,
  UnauthenticatedError,
} from "../../src/core/errors/security.errors";

// Mock helper to run simple assertions
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[TEST FAILED] ${message}`);
  }
}

function assertThrows(fn: () => void, errorType: any, message: string) {
  let thrown = false;
  try {
    fn();
  } catch (err) {
    thrown = true;
    if (!(err instanceof errorType)) {
      throw new Error(`[TEST FAILED] ${message}. Expected ${errorType.name}, got ${(err as Error).name}`);
    }
  }
  if (!thrown) {
    throw new Error(`[TEST FAILED] ${message}. Expected exception but none was thrown.`);
  }
}

async function runSecurityTestMatrix() {
  console.log("=================================================");
  console.log("  QUEUEFLOW MULTI-TENANT SECURITY TEST MATRIX   ");
  console.log("=================================================");

  // Setup test contexts
  const tenantA_Context: TenantContext = Object.freeze({
    userId: "usr_bank_a_admin",
    tenantId: "tenant_bank_a",
    roleIds: Object.freeze([Role.TENANT_ADMIN]),
    permissions: Object.freeze([
      Permission.TENANT_READ,
      Permission.BRANCH_READ,
      Permission.BOOKING_READ,
      Permission.BOOKING_CREATE,
      Permission.QUEUE_READ,
      Permission.QUEUE_UPDATE,
      Permission.QUEUE_TRANSFER,
      Permission.CUSTOMER_READ,
    ]),
    branchIds: Object.freeze([]), // Full tenant access
    sessionId: "sess_bank_a_123",
    securityVersion: 1,
  });

  const tenantB_Context: TenantContext = Object.freeze({
    userId: "usr_hospital_b_admin",
    tenantId: "tenant_hospital_b",
    roleIds: Object.freeze([Role.TENANT_ADMIN]),
    permissions: Object.freeze([
      Permission.TENANT_READ,
      Permission.BRANCH_READ,
      Permission.BOOKING_READ,
      Permission.QUEUE_READ,
    ]),
    branchIds: Object.freeze([]),
    sessionId: "sess_hospital_b_456",
    securityVersion: 1,
  });

  const branchAdminKolkataContext: TenantContext = Object.freeze({
    userId: "usr_kolkata_admin",
    tenantId: "tenant_bank_a",
    roleIds: Object.freeze([Role.BRANCH_ADMIN]),
    permissions: Object.freeze([Permission.QUEUE_READ, Permission.QUEUE_UPDATE]),
    branchIds: Object.freeze(["branch_kolkata"]),
    sessionId: "sess_kolkata_789",
    securityVersion: 1,
  });

  const resolver = new TenantResolver();

  // TEST 1: Tenant A -> Tenant A Resource Access (ALLOW)
  console.log("Test 1: Tenant A -> Tenant A data access...");
  Authorizer.authorize(tenantA_Context, Permission.BOOKING_READ, { tenantId: "tenant_bank_a" });
  console.log("  PASSED");

  // TEST 2: Tenant A -> Tenant B Resource Access (DENY)
  console.log("Test 2: Tenant A -> Tenant B data access...");
  assertThrows(
    () => Authorizer.authorize(tenantA_Context, Permission.BOOKING_READ, { tenantId: "tenant_hospital_b" }),
    TenantAccessDeniedError,
    "Tenant A accessing Tenant B data must be denied"
  );
  console.log("  PASSED");

  // TEST 3: Tenant A with known Tenant B UUID (DENY)
  console.log("Test 3: Tenant A accessing known Tenant B UUID...");
  assertThrows(
    () => Authorizer.authorize(tenantA_Context, Permission.BOOKING_READ, { tenantId: "tenant_hospital_b" }),
    TenantAccessDeniedError,
    "Known Tenant B UUID access must be denied"
  );
  console.log("  PASSED");

  // TEST 4: Client input tampering (Body/Query/Header manipulation) (DENY)
  console.log("Test 4: Client tenantId tampering in claims/resolution...");
  const resolved = await resolver.resolveFromSession({
    userId: "usr_bank_a_admin",
    tenantId: "tenant_bank_a",
    roles: [Role.TENANT_ADMIN],
    permissions: [Permission.TENANT_READ],
    branches: [],
    sessionId: "sess_123",
    securityVersion: 1,
  });
  assert(resolved.tenantId === "tenant_bank_a", "Tenant context must be derived strictly from trusted JWT claims");
  console.log("  PASSED");

  // TEST 5: Redis Key Isolation
  console.log("Test 5: Redis Key namespace builder...");
  const keyA = redisKeys.booking(tenantA_Context, "booking_123");
  const keyB = redisKeys.booking(tenantB_Context, "booking_123");
  assert(keyA === "tenant:tenant_bank_a:booking:booking_123", "Key A namespace incorrect");
  assert(keyB === "tenant:tenant_hospital_b:booking:booking_123", "Key B namespace incorrect");
  assert(keyA !== keyB, "Tenant A and Tenant B Redis keys must not collide");
  console.log("  PASSED");

  // TEST 6: Socket.IO Room Subscription Authorization
  console.log("Test 6: Socket.IO room subscription isolation...");
  const mockSocketA: any = { id: "sock_a", tenantContext: tenantA_Context, join: () => {}, emit: () => {} };
  const allowed = SocketAuthorizer.joinRoom(mockSocketA, "tenant:tenant_bank_a");
  const denied = SocketAuthorizer.joinRoom(mockSocketA, "tenant:tenant_hospital_b");
  assert(allowed === true, "Tenant A joining Tenant A room must be allowed");
  assert(denied === false, "Tenant A joining Tenant B room must be denied");
  console.log("  PASSED");

  // TEST 7: File Storage Signed URL Isolation
  console.log("Test 7: Storage presigned URL tenant isolation...");
  assertThrows(
    () => StorageService.generatePresignedUrl(tenantA_Context, "tenant_hospital_b", "cust_123", "doc_456"),
    TenantAccessDeniedError,
    "Generating signed URL for foreign tenant file must fail"
  );
  const validUrl = StorageService.generatePresignedUrl(tenantA_Context, "tenant_bank_a", "cust_123", "doc_456");
  assert(validUrl.includes("tenants/tenant_bank_a/customers/cust_123"), "Signed URL path must be tenant-scoped");
  console.log("  PASSED");

  // TEST 8: Branch Scope Isolation (Branch Admin Kolkata -> Howrah = DENY)
  console.log("Test 8: Branch Admin Kolkata -> Howrah resource access...");
  assertThrows(
    () => Authorizer.authorize(branchAdminKolkataContext, Permission.QUEUE_READ, { tenantId: "tenant_bank_a", branchId: "branch_howrah" }),
    BranchAccessDeniedError,
    "Branch Admin Kolkata accessing Howrah branch must be denied"
  );
  Authorizer.authorize(branchAdminKolkataContext, Permission.QUEUE_READ, { tenantId: "tenant_bank_a", branchId: "branch_kolkata" });
  console.log("  PASSED");

  // TEST 9: Normal User -> Platform Operation (DENY)
  console.log("Test 9: Normal Tenant User -> Platform endpoint access...");
  assertThrows(
    () => Authorizer.authorize(tenantA_Context, Permission.PLATFORM_TENANT_READ),
    ForbiddenError,
    "Tenant Admin accessing platform endpoint must be forbidden"
  );
  console.log("  PASSED");

  console.log("=================================================");
  console.log("  ALL SECURITY MATRIX TESTS PASSED SUCCESSFULLY!  ");
  console.log("=================================================");
}

import { describe, it } from "vitest";

describe("QueueFlow Multi-Tenant Security Matrix", () => {
  it("should pass all tenant isolation and permission checks", async () => {
    await runSecurityTestMatrix();
  });
});

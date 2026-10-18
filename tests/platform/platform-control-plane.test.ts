import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TenantType,
  TenantStatus,
  PlatformRoleType,
  MemberStatus,
  TenantAdminRole,
  HealthState,
  IncidentStatus,
  IncidentComponent,
  Severity,
  ScopeType,
} from "@prisma/client";
import { createPlatformRepository } from "../../src/repository/platform.repository";
import { createPlatformService } from "../../src/modules/platform/platform.service";
import { Permission, PLATFORM_ROLE_PERMISSIONS } from "../../src/core/authorization/permissions";
import { requirePlatformPermission } from "../../src/modules/platform/platform.middleware";

describe("QueueFlow Platform Super Admin / Control Plane Suite", () => {
  // In-memory mock data stores
  const tenantStore = new Map<string, any>();
  const userStore = new Map<string, any>();
  const platformMemberStore = new Map<string, any>();
  const tenantMemberStore = new Map<string, any>();
  const shardStore = new Map<string, any>();
  const migrationStore = new Map<string, any>();
  const incidentStore = new Map<string, any>();
  const featureFlagStore = new Map<string, any>();
  const auditLogsStore: any[] = [];
  const settingsStore = new Map<string, any>();
  const userRoleAssignmentsStore: any[] = [];
  const queuePolicyStore = new Map<string, any>();

  // Mock Prisma client
  const mockPrisma: any = {
    $transaction: vi.fn().mockImplementation(async (cb: any) => cb(mockPrisma)),
    tenant: {
      groupBy: vi.fn().mockImplementation(async () => {
        const counts: Record<string, number> = {};
        for (const t of tenantStore.values()) {
          counts[t.status] = (counts[t.status] || 0) + 1;
        }
        return Object.entries(counts).map(([status, count]) => ({
          status,
          _count: { id: count },
        }));
      }),
      count: vi.fn().mockImplementation(async ({ where }: any = {}) => {
        let count = 0;
        for (const t of tenantStore.values()) {
          if (where?.status && t.status !== where.status) continue;
          if (where?.type && t.type !== where.type) continue;
          if (where?.shardId && t.shardId !== where.shardId) continue;
          count += 1;
        }
        return count;
      }),
      findMany: vi.fn().mockImplementation(async () => {
        return Array.from(tenantStore.values()).map((t) => ({
          ...t,
          _count: { locations: 2, employees: 5 },
          subscriptions: [
            {
              id: "sub_1",
              status: "ACTIVE",
              plan: { name: "Enterprise Plan", code: "enterprise" },
            },
          ],
        }));
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const t = tenantStore.get(where.id);
        if (!t) return null;
        return {
          ...t,
          _count: {
            locations: 3,
            employees: 12,
            services: 8,
            counters: 6,
            queues: 4,
            bookings: 150,
            customers: 200,
          },
          subscriptions: [
            {
              id: "sub_1",
              status: "ACTIVE",
              billingCycle: "MONTHLY",
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(),
              plan: { name: "Enterprise Plan", code: "enterprise", limits: { maxBranches: 10 } },
            },
          ],
        };
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = data.id || `tenant_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const record = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
        tenantStore.set(id, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const t = tenantStore.get(where.id);
        if (!t) throw new Error("Tenant not found");
        const updated = { ...t, ...data, updatedAt: new Date() };
        tenantStore.set(where.id, updated);
        return updated;
      }),
    },
    location: {
      count: vi.fn().mockResolvedValue(15),
    },
    platformMember: {
      count: vi.fn().mockImplementation(async () => platformMemberStore.size),
      findMany: vi.fn().mockImplementation(async () => Array.from(platformMemberStore.values())),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => platformMemberStore.get(where.userId) || null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const record = { id: `pm_${Date.now()}`, ...data };
        platformMemberStore.set(data.userId, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const m = platformMemberStore.get(where.userId);
        if (!m) throw new Error("PlatformMember not found");
        const updated = { ...m, ...data };
        platformMemberStore.set(where.userId, updated);
        return updated;
      }),
    },
    tenantMember: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return Array.from(tenantMemberStore.values()).filter((m) => m.tenantId === where.tenantId);
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `tm_${Date.now()}`;
        const record = { id, ...data };
        tenantMemberStore.set(id, record);
        return record;
      }),
      upsert: vi.fn().mockImplementation(async ({ create, update }: any) => {
        const id = `tm_${Date.now()}`;
        const record = { id, ...(create || update) };
        tenantMemberStore.set(id, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const m = tenantMemberStore.get(where.id);
        const updated = { ...m, ...data };
        tenantMemberStore.set(where.id, updated);
        return updated;
      }),
    },
    userRoleAssignment: {
      upsert: vi.fn().mockImplementation(async ({ create, update }: any) => {
        const assignment = { id: `ura_${Date.now()}`, ...(create || update) };
        userRoleAssignmentsStore.push(assignment);
        return assignment;
      }),
    },
    queuePolicyDefault: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = `${where.tenantId_scopeType_scopeId.tenantId}:${where.tenantId_scopeType_scopeId.scopeType}:${where.tenantId_scopeType_scopeId.scopeId}`;
        return queuePolicyStore.get(key) || null;
      }),
      upsert: vi.fn().mockImplementation(async ({ where, create, update }: any) => {
        const key = `${where.tenantId_scopeType_scopeId.tenantId}:${where.tenantId_scopeType_scopeId.scopeType}:${where.tenantId_scopeType_scopeId.scopeId}`;
        const policy = { id: `qp_${Date.now()}`, ...(create || update), version: 1 };
        queuePolicyStore.set(key, policy);
        return policy;
      }),
    },
    subscription: {
      count: vi.fn().mockResolvedValue(8),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "sub_new" }),
    },
    plan: {
      findMany: vi.fn().mockResolvedValue([
        { id: "p1", code: "standard", name: "Standard", priceMonthly: 4999 },
        { id: "p2", code: "enterprise", name: "Enterprise", priceMonthly: 19999 },
      ]),
      findUnique: vi.fn().mockResolvedValue({ id: "p1", code: "standard", name: "Standard", limits: {} }),
    },
    booking: {
      count: vi.fn().mockResolvedValue(1240),
    },
    shard: {
      findMany: vi.fn().mockImplementation(async () => Array.from(shardStore.values())),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => shardStore.get(where.code) || null),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const s = shardStore.get(where.code);
        const updated = { ...s, ...data };
        shardStore.set(where.code, updated);
        return updated;
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    tenantShardHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
    incident: {
      findMany: vi.fn().mockImplementation(async () => Array.from(incidentStore.values())),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `inc_${Date.now()}`;
        const record = { id, updates: [], ...data };
        incidentStore.set(id, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const inc = incidentStore.get(where.id);
        const updated = { ...inc, ...data };
        incidentStore.set(where.id, updated);
        return updated;
      }),
    },
    incidentUpdate: {
      create: vi.fn().mockResolvedValue({}),
    },
    featureFlag: {
      findMany: vi.fn().mockImplementation(async () => Array.from(featureFlagStore.values())),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `ff_${Date.now()}`;
        const record = { id, rules: [], ...data };
        featureFlagStore.set(id, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const ff = featureFlagStore.get(where.id);
        const updated = { ...ff, ...data };
        featureFlagStore.set(where.id, updated);
        return updated;
      }),
    },
    featureFlagRule: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "ffr_1", ...data })),
    },
    tenantMigration: {
      findMany: vi.fn().mockImplementation(async () => Array.from(migrationStore.values())),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => migrationStore.get(where.id) || null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `mig_${Date.now()}`;
        const record = { id, steps: [], ...data };
        migrationStore.set(id, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const mig = migrationStore.get(where.id);
        const updated = { ...mig, ...data };
        migrationStore.set(where.id, updated);
        return updated;
      }),
    },
    adminAuditLog: {
      findMany: vi.fn().mockImplementation(async () => auditLogsStore),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const entry = { id: `aud_${Date.now()}`, createdAt: new Date(), ...data };
        auditLogsStore.push(entry);
        return entry;
      }),
      count: vi.fn().mockImplementation(async () => auditLogsStore.length),
    },
    outboxEvent: {
      create: vi.fn().mockResolvedValue({ id: "outbox_1" }),
    },
    platformSetting: {
      findMany: vi.fn().mockImplementation(async () => Array.from(settingsStore.values())),
      upsert: vi.fn().mockImplementation(async ({ where, create, update }: any) => {
        const record = { key: where.key, ...(create || update) };
        settingsStore.set(where.key, record);
        return record;
      }),
    },
    supportAccessSession: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `supp_${Date.now()}`, ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ ...data, status: "ENDED" })),
    },
    user: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => userStore.get(where.email) || null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `usr_${Date.now()}`;
        const record = { id, ...data };
        userStore.set(data.email, record);
        return record;
      }),
    },
    usageSnapshot: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  const platformRepo = createPlatformRepository(mockPrisma);
  const platformService = createPlatformService({ platformRepo });

  beforeEach(() => {
    tenantStore.clear();
    userStore.clear();
    platformMemberStore.clear();
    tenantMemberStore.clear();
    shardStore.clear();
    migrationStore.clear();
    incidentStore.clear();
    featureFlagStore.clear();
    auditLogsStore.length = 0;
    settingsStore.clear();
    userRoleAssignmentsStore.length = 0;
    queuePolicyStore.clear();

    // Populate default shard
    shardStore.set("shard_01", {
      id: "sh_1",
      code: "shard_01",
      region: { code: "ap-south-1", name: "Asia South (Mumbai)" },
      weight: 100,
      tenantCapacity: 500,
      tenantCount: 5,
      status: "ACTIVE",
      readOnly: false,
      dbHealth: HealthState.HEALTHY,
      redisHealth: HealthState.HEALTHY,
      kafkaHealth: HealthState.HEALTHY,
    });
  });

  // TEST 1: Dashboard Overview Aggregation
  it("should accurately aggregate platform overview metrics and subsystem health", async () => {
    tenantStore.set("org_1", { id: "org_1", name: "Bank A", status: TenantStatus.ACTIVE });
    tenantStore.set("org_2", { id: "org_2", name: "Hospital B", status: TenantStatus.SUSPENDED });
    tenantStore.set("org_3", { id: "org_3", name: "Gov C", status: TenantStatus.PROVISIONING });

    const dashboard = await platformService.getDashboardOverview();

    expect(dashboard.organizations.total).toBe(3);
    expect(dashboard.organizations.active).toBe(1);
    expect(dashboard.organizations.suspended).toBe(1);
    expect(dashboard.organizations.provisioning).toBe(1);
    expect(dashboard.infrastructure.totalLocations).toBe(15);
    expect(["HEALTHY", "DEGRADED"]).toContain(dashboard.health.overallStatus);
  });

  // TEST 2: Organization Creation with Shard Assignment & Audit Logging
  it("should provision a new organization on an active writable shard with transactional audit", async () => {
    const input = {
      name: "Acme Corporation",
      legalName: "Acme Corp Ltd",
      slug: "acme-corp",
      type: TenantType.CORPORATE,
      contactEmail: "contact@acme.com",
      adminFullName: "Jane Doe",
      adminEmail: "jane@acme.com",
      preferredShardId: "shard_01",
    };

    const org = await platformService.createOrganization(input, "usr_platform_admin");

    expect(org.name).toBe("Acme Corporation");
    expect(org.status).toBe(TenantStatus.ACTIVE);
    expect(org.shardId).toBe("shard_01");

    // Verify audit log creation
    const createdAudit = auditLogsStore.find((a) => a.action === "ORGANIZATION_CREATED");
    expect(createdAudit).toBeDefined();
    expect(createdAudit.resourceType).toBe("ORGANIZATION");
    expect(createdAudit.metadata.organizationName).toBe("Acme Corporation");
  });

  // TEST 3: Organization 360 View
  it("should retrieve Organization 360 data including metrics and infrastructure", async () => {
    tenantStore.set("org_360", {
      id: "org_360",
      name: "Global Clinic",
      status: TenantStatus.ACTIVE,
      type: TenantType.CLINIC,
      shardId: "shard_01",
      createdAt: new Date(),
    });

    const org360 = await platformService.getOrganization360("org_360");

    expect(org360.organization.name).toBe("Global Clinic");
    expect(org360.metrics.branches).toBe(3);
    expect(org360.metrics.employees).toBe(12);
    expect(org360.infrastructure.shardCode).toBe("shard_01");
  });

  // TEST 4: Organization Lifecycle State Transitions
  it("should properly transition organization through ACTIVE -> SUSPENDED -> ACTIVE -> ARCHIVED", async () => {
    tenantStore.set("org_lifecycle", {
      id: "org_lifecycle",
      name: "City Bank",
      status: TenantStatus.ACTIVE,
      shardId: "shard_01",
    });

    // Suspend
    const suspended = await platformService.suspendOrganization("org_lifecycle", "Overdue subscription invoices", "admin_1");
    expect(suspended.status).toBe(TenantStatus.SUSPENDED);
    expect(suspended.statusReason).toBe("Overdue subscription invoices");

    // Reactivate
    const reactivated = await platformService.activateOrganization("org_lifecycle", "Invoice paid in full", "admin_1");
    expect(reactivated.status).toBe(TenantStatus.ACTIVE);

    // Archive
    const archived = await platformService.archiveOrganization("org_lifecycle", "Contract terminated per client request", "admin_1");
    expect(archived.status).toBe(TenantStatus.ARCHIVED);
    expect(archived.writeFenced).toBe(true);
  });

  // TEST 5: Tenant Admins & Hybrid RBAC
  it("should create tenant admins and assign scoped hybrid permissions to employees", async () => {
    const admin = await platformService.createTenantAdmin("org_1", {
      name: "Branch Lead",
      email: "lead@branch.com",
      adminRole: TenantAdminRole.TENANT_ADMIN,
    });

    expect(admin.adminRole).toBe(TenantAdminRole.TENANT_ADMIN);

    // Assign scoped role
    const scopedRole = await platformService.assignHybridRole("org_1", {
      userId: "usr_emp_42",
      roleId: "role_counter_manager",
      scopeType: ScopeType.LOCATION,
      scopeId: "branch_mumbai_01",
    });

    expect(scopedRole.scopeType).toBe(ScopeType.LOCATION);
    expect(scopedRole.scopeId).toBe("branch_mumbai_01");
  });

  // TEST 6: Queue Policy Defaults & Requeue Overrides
  it("should configure queue policy rules including grace period, requeue attempts, and aging rules", async () => {
    const policy = await platformService.updateQueuePolicy(
      "org_1",
      ScopeType.LOCATION,
      "loc_central",
      {
        strategy: "PRIORITY",
        callGracePeriodSeconds: 120,
        allowRequeue: true,
        maxRequeueAttempts: 2,
        priorityRules: [{ class: "VIP", weight: 10 }],
        aging: { intervalSec: 180, boostPerInterval: 1, cap: 5 },
      },
      "admin_1"
    );

    expect(policy.callGracePeriodSeconds).toBe(120);
    expect(policy.allowRequeue).toBe(true);
    expect(policy.maxRequeueAttempts).toBe(2);

    const fetched = await platformService.getQueuePolicy("org_1", ScopeType.LOCATION, "loc_central");
    expect(fetched?.callGracePeriodSeconds).toBe(120);
  });

  // TEST 7: Platform User Least-Privilege RBAC
  it("should enforce read-only role constraints for PLATFORM_SUPPORT vs PLATFORM_ADMIN", () => {
    const supportPermissions = PLATFORM_ROLE_PERMISSIONS.PLATFORM_SUPPORT;
    const adminPermissions = PLATFORM_ROLE_PERMISSIONS.PLATFORM_ADMIN;

    expect(supportPermissions).toContain(Permission.PLATFORM_DASHBOARD_VIEW);
    expect(supportPermissions).toContain(Permission.PLATFORM_ORGANIZATION_READ);
    expect(supportPermissions).toContain(Permission.PLATFORM_SHARD_READ);

    // PLATFORM_SUPPORT cannot suspend organizations or update shards
    expect(supportPermissions).not.toContain(Permission.PLATFORM_ORGANIZATION_SUSPEND);
    expect(supportPermissions).not.toContain(Permission.PLATFORM_SHARD_UPDATE);

    // PLATFORM_ADMIN can suspend organizations
    expect(adminPermissions).toContain(Permission.PLATFORM_ORGANIZATION_SUSPEND);
  });

  // TEST 8: Platform Permission Middleware Guard
  it("should reject requests when required platform permission is missing", () => {
    const middleware = requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_SUSPEND);

    let nextCalled = false;
    let receivedError: any = null;

    const mockReq: any = {
      platformUser: {
        userId: "usr_supp_1",
        role: PlatformRoleType.PLATFORM_SUPPORT,
        permissions: PLATFORM_ROLE_PERMISSIONS.PLATFORM_SUPPORT,
      },
    };

    const mockRes: any = {};
    const mockNext = (err?: any) => {
      nextCalled = true;
      receivedError = err;
    };

    middleware(mockReq, mockRes, mockNext);

    expect(nextCalled).toBe(true);
    expect(receivedError).toBeDefined();
    expect(receivedError.statusCode).toBe(403);
  });

  // TEST 9: Incidents & Feature Flags
  it("should create platform incidents and manage scoped feature flags", async () => {
    const incident = await platformService.createIncident(
      {
        title: "Redis latency elevated in shard_01",
        component: IncidentComponent.REDIS,
        severity: Severity.HIGH,
        summary: "Latency spike observed on Redis cache cluster",
        shardCode: "shard_01",
      },
      "usr_admin"
    );

    expect(incident.status).toBe(IncidentStatus.OPEN);

    // Feature flag
    const flag = await platformService.createFeatureFlag(
      {
        key: "realtime_v2",
        description: "Enables WebSocket V2 channels",
        defaultEnabled: false,
      },
      "usr_admin"
    );

    expect(flag.key).toBe("realtime_v2");
    expect(flag.defaultEnabled).toBe(false);
  });

  // TEST 10: Shard Inventory & Setting Read-Only
  it("should list shards and allow toggling read-only mode to prevent new tenant placement", async () => {
    const shards = await platformService.listShards();
    expect(shards.length).toBe(1);
    expect(shards[0].code).toBe("shard_01");

    await platformService.updateShard("shard_01", { readOnly: true }, "usr_admin");
    const updated = shardStore.get("shard_01");
    expect(updated.readOnly).toBe(true);
  });

  // TEST 11: Audited Support Access Session (Impersonation)
  it("should initiate a time-bound support session with MFA challenge validation and audit record", async () => {
    tenantStore.set("org_support", {
      id: "org_support",
      name: "Partner Clinic",
      status: TenantStatus.ACTIVE,
      shardId: "shard_01",
    });

    const session = await platformService.createSupportSession(
      {
        targetTenantId: "org_support",
        reason: "Investigating booking queue dropoff issue reported by clinic manager",
        mfaToken: "847291",
        durationMinutes: 20,
      },
      {
        userId: "usr_support_1",
        role: "PLATFORM_SUPPORT",
        permissions: PLATFORM_ROLE_PERMISSIONS.PLATFORM_SUPPORT,
      }
    );

    expect(session.sessionId).toBeDefined();
    expect(session.targetTenantId).toBe("org_support");
    expect(session.token).toBeDefined();
    expect(session.reason).toContain("Investigating booking queue dropoff");

    // Verify audit log entry
    const auditLog = auditLogsStore.find((a) => a.action === "SUPPORT_SESSION_STARTED");
    expect(auditLog).toBeDefined();
    expect(auditLog.tenantId).toBe("org_support");
  });

  // TEST 12: Platform Settings with Masked Secrets
  it("should return settings with secret references masked and allow category updates", async () => {
    settingsStore.set("security.mfa_enforced", {
      key: "security.mfa_enforced",
      category: "SECURITY",
      value: true,
      isSecretRef: false,
    });
    settingsStore.set("infra.api_key_ref", {
      key: "infra.api_key_ref",
      category: "INFRA",
      value: "vault://secret/kafka-key",
      isSecretRef: true,
    });

    const settings = await platformService.getPlatformSettings();

    expect(settings.SECURITY["security.mfa_enforced"]).toBe(true);
    expect(settings.INFRA["infra.api_key_ref"]).toBe("[REDACTED_SECRET]");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmployeeStatus, ScopeType, QueueEntryStatus, QueueEventType } from "@prisma/client";

// Hoisted stores and mockDb so Vitest hoisting works seamlessly
const {
  employeeStore,
  locationStore,
  serviceStore,
  locationServiceStore,
  employeeLocationStore,
  employeeRoleStore,
  employeeServiceStore,
  tenantRoleStore,
  permissionStore,
  rolePermissionStore,
  userRoleAssignmentStore,
  queueEntryStore,
  queuePolicyStore,
  queueEntryEventStore,
  mockDb,
} = vi.hoisted(() => {
  const employeeStore = new Map<string, any>();
  const locationStore = new Map<string, any>();
  const serviceStore = new Map<string, any>();
  const locationServiceStore = new Map<string, any>();
  const employeeLocationStore = new Map<string, any>();
  const employeeRoleStore = new Map<string, any>();
  const employeeServiceStore = new Map<string, any>();
  const tenantRoleStore = new Map<string, any>();
  const permissionStore = new Map<string, any>();
  const rolePermissionStore = new Map<string, any>();
  const userRoleAssignmentStore = new Map<string, any>();
  const queueEntryStore = new Map<string, any>();
  const queuePolicyStore = new Map<string, any>();
  const queueEntryEventStore: any[] = [];

  const mockDb: any = {
    employee: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const e of employeeStore.values()) {
          if (where.tenantId && e.tenantId !== where.tenantId) continue;
          if (where.id && e.id !== where.id) continue;
          if (where.employeeCode && e.employeeCode !== where.employeeCode) continue;
          if (where.userId && e.userId !== where.userId) continue;
          if (where.deletedAt === null && e.deletedAt !== null) continue;
          return {
            ...e,
            roles: Array.from(employeeRoleStore.values())
              .filter((er) => er.employeeId === e.id)
              .map((er) => ({
                ...er,
                role: {
                  ...tenantRoleStore.get(er.roleId),
                  permissions: Array.from(rolePermissionStore.values())
                    .filter((rp) => rp.roleId === er.roleId)
                    .map((rp) => ({
                      ...rp,
                      permission: permissionStore.get(rp.permissionId),
                    })),
                },
              })),
            locations: Array.from(employeeLocationStore.values())
              .filter((el) => el.employeeId === e.id)
              .map((el) => ({
                ...el,
                location: locationStore.get(el.locationId),
              })),
            services: Array.from(employeeServiceStore.values())
              .filter((es) => es.employeeId === e.id)
              .map((es) => ({
                ...es,
                locationService: {
                  ...locationServiceStore.get(`${es.locationId}_${es.serviceId}`),
                  service: serviceStore.get(es.serviceId),
                  location: locationStore.get(es.locationId),
                },
              })),
            counters: [],
          };
        }
        return null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
        const matches: any[] = [];
        for (const e of employeeStore.values()) {
          if (where.tenantId && e.tenantId !== where.tenantId) continue;
          if (where.deletedAt === null && e.deletedAt !== null) continue;
          if (where.status && e.status !== where.status) continue;
          if (where.department && e.department !== where.department) continue;
          matches.push(e);
        }
        return matches.slice(skip, skip + take).map((e) => ({
          ...e,
          roles: [],
          locations: [],
          services: [],
        }));
      }),
      count: vi.fn().mockImplementation(async ({ where }: any) => {
        let count = 0;
        for (const e of employeeStore.values()) {
          if (where.tenantId && e.tenantId !== where.tenantId) continue;
          if (where.deletedAt === null && e.deletedAt !== null) continue;
          count++;
        }
        return count;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `emp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const record = {
          id,
          ...data,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        employeeStore.set(id, record);

        if (data.locations?.create) {
          employeeLocationStore.set(`${id}_${data.locations.create.locationId}`, {
            employeeId: id,
            locationId: data.locations.create.locationId,
            isPrimary: data.locations.create.isPrimary || false,
          });
        }
        if (data.roles?.create) {
          employeeRoleStore.set(`${id}_${data.roles.create.roleId}`, {
            employeeId: id,
            roleId: data.roles.create.roleId,
          });
        }
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const existing = employeeStore.get(where.id);
        if (!existing) throw new Error("Employee not found");
        const updated = { ...existing, ...data, updatedAt: new Date() };
        employeeStore.set(where.id, updated);
        return updated;
      }),
    },
    location: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const loc of locationStore.values()) {
          if (where.tenantId && loc.tenantId !== where.tenantId) continue;
          if (where.id && loc.id !== where.id) continue;
          return loc;
        }
        return null;
      }),
    },
    locationService: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = `${where.locationId_serviceId.locationId}_${where.locationId_serviceId.serviceId}`;
        return locationServiceStore.get(key) || null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const key = `${data.locationId}_${data.serviceId}`;
        locationServiceStore.set(key, data);
        return data;
      }),
    },
    employeeLocation: {
      upsert: vi.fn().mockImplementation(async ({ where, create, update }: any) => {
        const key = `${where.employeeId_locationId.employeeId}_${where.employeeId_locationId.locationId}`;
        const existing = employeeLocationStore.get(key);
        const record = existing ? { ...existing, ...update } : { ...create };
        employeeLocationStore.set(key, record);
        return {
          ...record,
          location: locationStore.get(record.locationId),
        };
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
        let count = 0;
        for (const [k, v] of employeeLocationStore.entries()) {
          if (v.employeeId === where.employeeId) {
            employeeLocationStore.set(k, { ...v, ...data });
            count++;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = `${where.employeeId}_${where.locationId}`;
        const deleted = employeeLocationStore.delete(key);
        return { count: deleted ? 1 : 0 };
      }),
    },
    employeeService: {
      upsert: vi.fn().mockImplementation(async ({ where, create }: any) => {
        const key = `${where.employeeId_locationId_serviceId.employeeId}_${where.employeeId_locationId_serviceId.locationId}_${where.employeeId_locationId_serviceId.serviceId}`;
        const record = { ...create };
        employeeServiceStore.set(key, record);
        return record;
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = `${where.employeeId}_${where.locationId}_${where.serviceId}`;
        const deleted = employeeServiceStore.delete(key);
        return { count: deleted ? 1 : 0 };
      }),
    },
    employeeRole: {
      upsert: vi.fn().mockImplementation(async ({ where, create }: any) => {
        const key = `${where.employeeId_roleId.employeeId}_${where.employeeId_roleId.roleId}`;
        const record = { ...create };
        employeeRoleStore.set(key, record);
        return {
          ...record,
          role: tenantRoleStore.get(record.roleId),
        };
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = `${where.employeeId}_${where.roleId}`;
        const deleted = employeeRoleStore.delete(key);
        return { count: deleted ? 1 : 0 };
      }),
    },
    tenantRole: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const r of tenantRoleStore.values()) {
          if (where.tenantId && r.tenantId !== where.tenantId) continue;
          if (where.id && r.id !== where.id) continue;
          if (where.name && r.name !== where.name) continue;
          return {
            ...r,
            permissions: Array.from(rolePermissionStore.values())
              .filter((rp) => rp.roleId === r.id)
              .map((rp) => ({
                ...rp,
                permission: permissionStore.get(rp.permissionId),
              })),
            _count: {
              employees: Array.from(employeeRoleStore.values()).filter((er) => er.roleId === r.id).length,
              assignments: Array.from(userRoleAssignmentStore.values()).filter((ura) => ura.roleId === r.id).length,
            },
          };
        }
        return null;
      }),
      findMany: vi.fn().mockImplementation(async () => {
        return Array.from(tenantRoleStore.values()).map((r) => ({
          ...r,
          permissions: [],
          _count: { employees: 0, assignments: 0 },
        }));
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `role_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const record = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        tenantRoleStore.set(id, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const existing = tenantRoleStore.get(where.id);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        tenantRoleStore.set(where.id, updated);
        return { ...updated, permissions: [] };
      }),
      delete: vi.fn().mockImplementation(async ({ where }: any) => {
        tenantRoleStore.delete(where.id);
        return { id: where.id };
      }),
    },
    permission: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const p of permissionStore.values()) {
          if (where.tenantId && p.tenantId !== where.tenantId) continue;
          if (where.key && p.key !== where.key) continue;
          return p;
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `perm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const record = { id, ...data };
        permissionStore.set(id, record);
        return record;
      }),
    },
    rolePermission: {
      upsert: vi.fn().mockImplementation(async ({ where, create }: any) => {
        const key = `${where.roleId_permissionId.roleId}_${where.roleId_permissionId.permissionId}`;
        const record = { ...create };
        rolePermissionStore.set(key, record);
        return {
          ...record,
          permission: permissionStore.get(record.permissionId),
        };
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        let count = 0;
        for (const [k, v] of rolePermissionStore.entries()) {
          if (where.roleId && v.roleId === where.roleId) {
            if (where.permissionId && v.permissionId !== where.permissionId) continue;
            rolePermissionStore.delete(k);
            count++;
          }
        }
        return { count };
      }),
    },
    userRoleAssignment: {
      upsert: vi.fn().mockImplementation(async ({ where, create, update }: any) => {
        const key = `${where.tenantId_userId_roleId_scopeType_scopeId.tenantId}_${where.tenantId_userId_roleId_scopeType_scopeId.userId}_${where.tenantId_userId_roleId_scopeType_scopeId.roleId}_${where.tenantId_userId_roleId_scopeType_scopeId.scopeType}_${where.tenantId_userId_roleId_scopeType_scopeId.scopeId}`;
        const existing = userRoleAssignmentStore.get(key);
        const record = existing
          ? { ...existing, ...update }
          : { id: `ura_${Date.now()}`, ...create, createdAt: new Date() };
        userRoleAssignmentStore.set(key, record);
        return {
          ...record,
          role: {
            ...tenantRoleStore.get(record.roleId),
            permissions: Array.from(rolePermissionStore.values())
              .filter((rp) => rp.roleId === record.roleId)
              .map((rp) => ({
                ...rp,
                permission: permissionStore.get(rp.permissionId),
              })),
          },
        };
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        let count = 0;
        for (const [k, v] of userRoleAssignmentStore.entries()) {
          if (where.id && v.id === where.id) {
            userRoleAssignmentStore.delete(k);
            count++;
          }
        }
        return { count };
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return Array.from(userRoleAssignmentStore.values())
          .filter((ura) => ura.tenantId === where.tenantId && ura.userId === where.userId)
          .map((ura) => ({
            ...ura,
            role: {
              ...tenantRoleStore.get(ura.roleId),
              permissions: Array.from(rolePermissionStore.values())
                .filter((rp) => rp.roleId === ura.roleId)
                .map((rp) => ({
                  ...rp,
                  permission: permissionStore.get(rp.permissionId),
                })),
            },
          }));
      }),
    },
    queueEntry: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const qe of queueEntryStore.values()) {
          if (where.tenantId && qe.tenantId !== where.tenantId) continue;
          if (where.id && qe.id !== where.id) continue;
          return { ...qe, location: locationStore.get(qe.locationId) };
        }
        return null;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const existing = queueEntryStore.get(where.id);
        const updated = { ...existing, ...data };
        queueEntryStore.set(where.id, updated);
        return updated;
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const existing = queueEntryStore.get(where.id);
        if (existing) {
          queueEntryStore.set(where.id, { ...existing, ...data });
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    queuePolicy: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        return queuePolicyStore.get(where.queueId) || null;
      }),
    },
    queueEntryEvent: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const event = { id: `qee_${Date.now()}`, ...data, createdAt: new Date() };
        queueEntryEventStore.push(event);
        return event;
      }),
    },
  };

  return {
    employeeStore,
    locationStore,
    serviceStore,
    locationServiceStore,
    employeeLocationStore,
    employeeRoleStore,
    employeeServiceStore,
    tenantRoleStore,
    permissionStore,
    rolePermissionStore,
    userRoleAssignmentStore,
    queueEntryStore,
    queuePolicyStore,
    queueEntryEventStore,
    mockDb,
  };
});

// Mock getTenantDb helper at top level
vi.mock("../../src/common/base.repository", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getTenantDb: vi.fn().mockResolvedValue(mockDb),
  };
});

import { createEmployeeRepository } from "../../src/repository/employee.repository";
import { EmployeeService } from "../../src/modules/employee/employee.service";
import { createRoleRepository } from "../../src/repository/role.repository";
import { RoleService } from "../../src/modules/role/role.service";
import { createQueueRepository } from "../../src/repository/queue.repository";
import { QueueService } from "../../src/modules/queue/queue.service";
import { Permission } from "../../src/core/authorization/permissions";
import { TenantContext } from "../../src/core/tenant/tenant-context";

describe("Tenant Employee & Role Management and Requeue Bypass Suite", () => {
  const tenantAdminContext: TenantContext = {
    userId: "user_tenant_admin_1",
    tenantId: "tenant_alpha",
    roleIds: ["TENANT_ADMIN"],
    permissions: [
      Permission.EMPLOYEE_READ,
      Permission.EMPLOYEE_CREATE,
      Permission.EMPLOYEE_UPDATE,
      Permission.EMPLOYEE_DELETE,
      Permission.BRANCH_READ,
      Permission.BRANCH_UPDATE,
      Permission.ROLE_READ,
      Permission.ROLE_CREATE,
      Permission.ROLE_UPDATE,
      Permission.ROLE_DELETE,
      Permission.ROLE_ASSIGN,
      Permission.QUEUE_UPDATE,
      Permission.QUEUE_REQUEUE_OVERRIDE,
    ],
    branchIds: [],
    sessionId: "sess_1",
    securityVersion: 1,
  };

  const branchEmployeeContext: TenantContext = {
    userId: "user_employee_1",
    tenantId: "tenant_alpha",
    roleIds: ["EMPLOYEE"],
    permissions: [
      Permission.EMPLOYEE_READ,
      Permission.QUEUE_READ,
      Permission.QUEUE_UPDATE,
    ],
    branchIds: ["branch_central"],
    sessionId: "sess_2",
    securityVersion: 1,
  };

  beforeEach(() => {
    employeeStore.clear();
    locationStore.clear();
    serviceStore.clear();
    locationServiceStore.clear();
    employeeLocationStore.clear();
    employeeRoleStore.clear();
    employeeServiceStore.clear();
    tenantRoleStore.clear();
    permissionStore.clear();
    rolePermissionStore.clear();
    userRoleAssignmentStore.clear();
    queueEntryStore.clear();
    queuePolicyStore.clear();
    queueEntryEventStore.length = 0;

    // Seed location and service
    locationStore.set("branch_central", {
      id: "branch_central",
      tenantId: "tenant_alpha",
      name: "Central Branch",
      code: "CB01",
    });

    serviceStore.set("srv_express", {
      id: "srv_express",
      tenantId: "tenant_alpha",
      name: "Express Checkout",
    });

    locationServiceStore.set("branch_central_srv_express", {
      locationId: "branch_central",
      serviceId: "srv_express",
      enabled: true,
    });
  });

  describe("Tenant Employee Management", () => {
    it("allows tenant admin to create an employee and associate to branch & service", async () => {
      const repo = createEmployeeRepository();
      const service = new EmployeeService(repo);

      // 1. Create employee
      const employee = await service.createEmployee(tenantAdminContext, {
        employeeCode: "EMP-001",
        name: "Jane Officer",
        email: "jane@company.com",
        department: "Customer Relations",
        locationId: "branch_central",
      });

      expect(employee.id).toBeDefined();
      expect(employee.employeeCode).toBe("EMP-001");
      expect(employee.name).toBe("Jane Officer");

      // 2. Associate with service
      await service.assignService(tenantAdminContext, employee.id, {
        locationId: "branch_central",
        serviceId: "srv_express",
      });

      const fetched = await service.getEmployeeById(tenantAdminContext, employee.id);
      expect(fetched.locations.length).toBe(1);
      expect(fetched.locations[0].locationId).toBe("branch_central");
      expect(fetched.services.length).toBe(1);
      expect(fetched.services[0].locationService.service.name).toBe("Express Checkout");
    });

    it("supports updating and soft-deleting an employee", async () => {
      const repo = createEmployeeRepository();
      const service = new EmployeeService(repo);

      const emp = await service.createEmployee(tenantAdminContext, {
        employeeCode: "EMP-002",
        name: "Bob Specialist",
      });

      await service.updateEmployee(tenantAdminContext, emp.id, {
        name: "Robert Specialist",
        status: EmployeeStatus.INACTIVE,
      });

      const updated = await service.getEmployeeById(tenantAdminContext, emp.id);
      expect(updated.name).toBe("Robert Specialist");
      expect(updated.status).toBe(EmployeeStatus.INACTIVE);

      await service.deleteEmployee(tenantAdminContext, emp.id);
      const deleted = employeeStore.get(emp.id);
      expect(deleted.deletedAt).toBeInstanceOf(Date);
    });

    it("blocks branch employee from creating employees without EMPLOYEE_CREATE permission", async () => {
      const repo = createEmployeeRepository();
      const service = new EmployeeService(repo);

      await expect(
        service.createEmployee(branchEmployeeContext, {
          employeeCode: "EMP-003",
          name: "Unauthorized Employee",
        })
      ).rejects.toThrow("Required permission 'employee:create' is missing");
    });
  });

  describe("Tenant Custom Roles & Hybrid RBAC", () => {
    it("allows tenant admin to create custom role, attach permissions, and assign to employee", async () => {
      const roleRepo = createRoleRepository();
      const roleService = new RoleService(roleRepo);
      const empRepo = createEmployeeRepository();
      const empService = new EmployeeService(empRepo);

      // 1. Create custom role
      const customRole = await roleService.createRole(tenantAdminContext, {
        name: "Senior Teller",
        description: "Can serve VIP queues and transfer tickets",
        maxScope: ScopeType.LOCATION,
        permissionKeys: [Permission.QUEUE_UPDATE, Permission.QUEUE_TRANSFER],
      });

      expect(customRole.name).toBe("Senior Teller");
      expect(customRole.permissions.length).toBe(2);

      // 2. Create employee and assign role
      const employee = await empService.createEmployee(tenantAdminContext, {
        employeeCode: "EMP-004",
        name: "Alice Senior",
      });

      await empService.assignRole(tenantAdminContext, employee.id, {
        roleId: customRole.id,
      });

      const fetchedEmp = await empService.getEmployeeById(tenantAdminContext, employee.id);
      expect(fetchedEmp.roles.length).toBe(1);
      expect(fetchedEmp.roles[0].role.name).toBe("Senior Teller");
    });

    it("evaluates hybrid RBAC effective permissions combining role assignments and scoped user roles", async () => {
      const roleRepo = createRoleRepository();
      const roleService = new RoleService(roleRepo);

      // Create branch-scoped role
      const branchSupervisor = await roleService.createRole(tenantAdminContext, {
        name: "Branch Supervisor",
        maxScope: ScopeType.LOCATION,
        permissionKeys: [Permission.QUEUE_REQUEUE_OVERRIDE, Permission.AUDIT_READ],
      });

      // Assign scoped role to user at branch_central
      await roleService.assignScopedRole(tenantAdminContext, {
        userId: "user_target_42",
        roleId: branchSupervisor.id,
        scopeType: ScopeType.LOCATION,
        scopeId: "branch_central",
      });

      // Check effective permissions for matching scope
      const permsAtBranch = await roleService.getEffectivePermissions(tenantAdminContext, {
        userId: "user_target_42",
        scopeType: ScopeType.LOCATION,
        scopeId: "branch_central",
      });

      expect(permsAtBranch).toContain(Permission.QUEUE_REQUEUE_OVERRIDE);
      expect(permsAtBranch).toContain(Permission.AUDIT_READ);

      // Check effective permissions for different non-matching branch
      const permsOtherBranch = await roleService.getEffectivePermissions(tenantAdminContext, {
        userId: "user_target_42",
        scopeType: ScopeType.LOCATION,
        scopeId: "branch_north",
      });
      expect(permsOtherBranch).not.toContain(Permission.QUEUE_REQUEUE_OVERRIDE);
    });
  });

  describe("Queue Requeue and Missed Turn Rule Bypass", () => {
    it("allows requeuing a customer entry and records queue entry event", async () => {
      const queueRepo = createQueueRepository();
      const queueService = new QueueService();

      queueEntryStore.set("qe_101", {
        id: "qe_101",
        tenantId: "tenant_alpha",
        locationId: "branch_central",
        queueId: "q_main",
        status: QueueEntryStatus.CALLED,
        priority: 1,
      });

      const requeued = await queueService.requeueEntry(tenantAdminContext, "qe_101", {
        reason: "Customer was briefly away",
      });

      expect(requeued.status).toBe(QueueEntryStatus.WAITING);
      expect(queueEntryEventStore.length).toBeGreaterThan(0);
      expect(queueEntryEventStore[0].type).toBe(QueueEventType.REQUEUED);
    });

    it("blocks requeuing a NO_SHOW entry when queue policy disables requeue and no bypass is set", async () => {
      const queueRepo = createQueueRepository();
      const queueService = new QueueService();

      queueEntryStore.set("qe_missed", {
        id: "qe_missed",
        tenantId: "tenant_alpha",
        locationId: "branch_central",
        queueId: "q_strict",
        status: QueueEntryStatus.NO_SHOW,
        priority: 1,
      });

      queuePolicyStore.set("q_strict", {
        id: "pol_strict",
        queueId: "q_strict",
        allowRequeue: false, // Strict policy
      });

      // Attempt requeue without bypassRules
      await expect(
        queueService.requeueEntry(branchEmployeeContext, "qe_missed", {
          bypassRules: false,
        })
      ).rejects.toThrow("Requeuing is disabled by queue policy");
    });

    it("allows authorized admin or supervisor to bypass queue policy rule with QUEUE_REQUEUE_OVERRIDE permission", async () => {
      const queueRepo = createQueueRepository();
      const queueService = new QueueService();

      queueEntryStore.set("qe_missed_2", {
        id: "qe_missed_2",
        tenantId: "tenant_alpha",
        locationId: "branch_central",
        queueId: "q_strict",
        status: QueueEntryStatus.NO_SHOW,
        priority: 1,
      });

      queuePolicyStore.set("q_strict", {
        id: "pol_strict",
        queueId: "q_strict",
        allowRequeue: false,
      });

      // Bypass with tenant admin possessing QUEUE_REQUEUE_OVERRIDE
      const requeued = await queueService.requeueEntry(tenantAdminContext, "qe_missed_2", {
        bypassRules: true,
        reason: "Manager approved customer medical exception",
      });

      expect(requeued.status).toBe(QueueEntryStatus.WAITING);
    });
  });
});

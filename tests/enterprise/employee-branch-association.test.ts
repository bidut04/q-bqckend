import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmployeeStatus } from "@prisma/client";

const {
  employeeStore,
  locationStore,
  employeeLocationStore,
  tenantRoleStore,
  employeeRoleStore,
  mockDb,
} = vi.hoisted(() => {
  const employeeStore = new Map<string, any>();
  const locationStore = new Map<string, any>();
  const employeeLocationStore = new Map<string, any>();
  const tenantRoleStore = new Map<string, any>();
  const employeeRoleStore = new Map<string, any>();

  const mockDb: any = {
    employee: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const e of employeeStore.values()) {
          if (where.tenantId && e.tenantId !== where.tenantId) continue;
          if (where.id && e.id !== where.id) continue;
          if (where.employeeCode && e.employeeCode !== where.employeeCode) continue;
          if (where.deletedAt === null && e.deletedAt !== null) continue;
          return {
            ...e,
            locations: Array.from(employeeLocationStore.values())
              .filter((el) => el.employeeId === e.id)
              .map((el) => ({
                ...el,
                location: locationStore.get(el.locationId),
              })),
            roles: Array.from(employeeRoleStore.values())
              .filter((er) => er.employeeId === e.id)
              .map((er) => ({
                ...er,
                role: tenantRoleStore.get(er.roleId),
              })),
          };
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `emp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const record = { id, deletedAt: null, ...data };
        employeeStore.set(id, record);

        if (data.locations?.create) {
          const locId = data.locations.create.locationId;
          employeeLocationStore.set(`${id}_${locId}`, {
            employeeId: id,
            locationId: locId,
            isPrimary: true,
          });
        }

        if (data.roles?.create) {
          const rId = data.roles.create.roleId;
          employeeRoleStore.set(`${id}_${rId}`, {
            employeeId: id,
            roleId: rId,
          });
        }

        return {
          ...record,
          locations: Array.from(employeeLocationStore.values())
            .filter((el) => el.employeeId === id)
            .map((el) => ({
              ...el,
              location: locationStore.get(el.locationId),
            })),
          roles: Array.from(employeeRoleStore.values())
            .filter((er) => er.employeeId === id)
            .map((er) => ({
              ...er,
              role: tenantRoleStore.get(er.roleId),
            })),
        };
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const existing = employeeStore.get(where.id);
        if (!existing) throw new Error("Employee not found");
        const updated = { ...existing, ...data };
        employeeStore.set(where.id, updated);
        return {
          ...updated,
          locations: Array.from(employeeLocationStore.values())
            .filter((el) => el.employeeId === where.id)
            .map((el) => ({
              ...el,
              location: locationStore.get(el.locationId),
            })),
          roles: Array.from(employeeRoleStore.values())
            .filter((er) => er.employeeId === where.id)
            .map((er) => ({
              ...er,
              role: tenantRoleStore.get(er.roleId),
            })),
        };
      }),
    },
    location: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const loc of locationStore.values()) {
          if (where.tenantId && loc.tenantId !== where.tenantId) continue;
          if (where.id && loc.id === where.id) return loc;
          if (where.OR) {
            const match = where.OR.some(
              (cond: any) =>
                (cond.id && loc.id === cond.id) ||
                (cond.name && loc.name === cond.name) ||
                (cond.code && loc.code === cond.code)
            );
            if (match) return loc;
          }
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `loc-${Date.now()}`;
        const record = { id, ...data };
        locationStore.set(id, record);
        return record;
      }),
    },
    tenantRole: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const r of tenantRoleStore.values()) {
          if (where.tenantId && r.tenantId !== where.tenantId) continue;
          if (where.id && r.id === where.id) return r;
          if (where.OR) {
            const match = where.OR.some(
              (cond: any) =>
                (cond.id && r.id === cond.id) ||
                (cond.name && r.name === cond.name) ||
                (cond.roleName && r.name === cond.roleName)
            );
            if (match) return r;
          }
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `role-${Date.now()}`;
        const record = { id, ...data };
        tenantRoleStore.set(id, record);
        return record;
      }),
    },
    employeeLocation: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        employeeLocationStore.set(`${data.employeeId}_${data.locationId}`, data);
        return data;
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const [key, el] of employeeLocationStore.entries()) {
          if (el.employeeId === where.employeeId) {
            employeeLocationStore.delete(key);
          }
        }
        return { count: 1 };
      }),
    },
    employeeRole: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        employeeRoleStore.set(`${data.employeeId}_${data.roleId}`, data);
        return data;
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const [key, er] of employeeRoleStore.entries()) {
          if (er.employeeId === where.employeeId) {
            employeeRoleStore.delete(key);
          }
        }
        return { count: 1 };
      }),
    },
  };

  return {
    employeeStore,
    locationStore,
    employeeLocationStore,
    tenantRoleStore,
    employeeRoleStore,
    mockDb,
  };
});

vi.mock("../../src/common/base.repository", () => ({
  getTenantDb: vi.fn().mockImplementation(async () => mockDb),
  withTenantScope: vi.fn().mockImplementation((_ctx: any, filter: any) => filter),
  ensureFound: vi.fn().mockImplementation((item: any, name: string) => {
    if (!item) throw new Error(`${name} not found`);
    return item;
  }),
}));

import { createEmployeeRepository } from "../../src/repository/employee.repository";
import { TenantContext } from "../../src/core/tenant/tenant-context";

describe("Employee Branch & Role Association Enterprise Test", () => {
  const context: TenantContext = {
    tenantId: "cmvfluxxl0000v5okel949gjt",
    userId: "user-admin-1",
    roleIds: ["TENANT_ADMIN"],
    branchIds: [],
    permissions: [] as any,
  };

  const repository = createEmployeeRepository();

  beforeEach(() => {
    employeeStore.clear();
    locationStore.clear();
    employeeLocationStore.clear();
    tenantRoleStore.clear();
    employeeRoleStore.clear();

    // Seed a branch
    locationStore.set("loc-main", {
      id: "loc-main",
      tenantId: context.tenantId,
      name: "Main Branch",
      code: "LOC-MAIN",
    });

    // Seed a role
    tenantRoleStore.set("role-receptionist", {
      id: "role-receptionist",
      tenantId: context.tenantId,
      name: "Receptionist",
    });
  });

  it("should create employee and associate branch and role when passed by name", async () => {
    const created = await repository.create(context, {
      employeeCode: "EMP-1002",
      name: "tarens",
      email: "tarens@gmail.com",
      phone: "9647212144",
      department: "Cash & Teller",
      branch: "Main Branch",
      role: "Receptionist",
      status: EmployeeStatus.ACTIVE,
    });

    expect(created.employeeCode).toBe("EMP-1002");
    expect(created.locations).toHaveLength(1);
    expect(created.locations[0].location.name).toBe("Main Branch");
    expect(created.roles).toHaveLength(1);
    expect(created.roles[0].role.name).toBe("Receptionist");
  });

  it("should update employee branch and role and return populated locations and roles", async () => {
    const created = await repository.create(context, {
      employeeCode: "EMP-1003",
      name: "John Doe",
      email: "john@example.com",
      status: EmployeeStatus.ACTIVE,
    });

    // Seed another branch
    locationStore.set("loc-gulshan", {
      id: "loc-gulshan",
      tenantId: context.tenantId,
      name: "Gulshan Branch",
      code: "LOC-GULSHAN",
    });

    const updated = await repository.update(context, created.id, {
      name: "John Doe Updated",
      branch: "Gulshan Branch",
      role: "Receptionist",
    });

    expect(updated.name).toBe("John Doe Updated");
    expect(updated.locations).toHaveLength(1);
    expect(updated.locations[0].location.name).toBe("Gulshan Branch");
    expect(updated.roles).toHaveLength(1);
    expect(updated.roles[0].role.name).toBe("Receptionist");
  });
});

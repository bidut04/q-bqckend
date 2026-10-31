import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBranchController } from '../../src/modules/branch/branch.controller';
import { createDepartmentController } from '../../src/modules/department/department.controller';
import { TenantContext } from '../../src/core/tenant/tenant-context';

// Hoist mock stores for Vitest
const { branchStore, tenantSettingStore, employeeStore, mockDb } = vi.hoisted(() => {
  const branchStore = new Map<string, any>();
  const tenantSettingStore = new Map<string, any>();
  const employeeStore = new Map<string, any>();

  const mockDb: any = {
    location: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return Array.from(branchStore.values()).filter((b) => b.tenantId === where.tenantId);
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const b of branchStore.values()) {
          if (where.tenantId && b.tenantId !== where.tenantId) continue;
          if (where.id && b.id !== where.id) continue;
          return b;
        }
        return null;
      }),
    },
    tenantSetting: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = `${where.tenantId_namespace.tenantId}_${where.tenantId_namespace.namespace}`;
        return tenantSettingStore.get(key) || null;
      }),
      upsert: vi.fn().mockImplementation(async ({ where, create, update }: any) => {
        const key = `${where.tenantId_namespace.tenantId}_${where.tenantId_namespace.namespace}`;
        const existing = tenantSettingStore.get(key);
        const record = existing
          ? { ...existing, ...update, version: (existing.version || 1) + 1 }
          : { id: `setting-${Date.now()}`, ...create, version: 1 };
        tenantSettingStore.set(key, record);
        return record;
      }),
    },
    employee: {
      findMany: vi.fn().mockImplementation(async () => {
        return Array.from(employeeStore.values()).map((e) => ({
          department: e.department,
        }));
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const emp of employeeStore.values()) {
          if (where.tenantId && emp.tenantId !== where.tenantId) continue;
          if (where.department && emp.department !== where.department) continue;
          return emp;
        }
        return null;
      }),
    },
  };

  return {
    branchStore,
    tenantSettingStore,
    employeeStore,
    mockDb,
  };
});

// Mock base repository
vi.mock('../../src/common/base.repository', () => ({
  getTenantDb: vi.fn().mockImplementation(async () => mockDb),
  withTenantScope: vi.fn().mockImplementation((ctx: any, filter: any) => ({
    ...filter,
    tenantId: ctx.tenantId,
  })),
  ensureFound: vi.fn().mockImplementation((entity: any, name: string) => {
    if (!entity) throw new Error(`${name} not found`);
    return entity;
  }),
}));

// Mock tenant context helper
vi.mock('../../src/core/tenant/tenant-context.helper', () => ({
  getTenantContextFromRequest: vi.fn().mockImplementation(() => ({
    tenantId: 'tenant_test_123',
    userId: 'user_admin_123',
    roleIds: ['TENANT_ADMIN'],
    permissions: ['ROLE_READ', 'BRANCH_READ'],
    branchIds: [],
    sessionId: 'session_test',
    securityVersion: 1,
  })),
}));

describe('Branch & Department Endpoints Test Suite', () => {
  beforeEach(() => {
    branchStore.clear();
    tenantSettingStore.clear();
    employeeStore.clear();
    vi.clearAllMocks();
  });

  it('1. GET /api/v1/branches should lazily return real tenant branches from database', async () => {
    // Seed test branches in mock DB
    branchStore.set('branch-01', {
      id: 'branch-01',
      tenantId: 'tenant_test_123',
      name: 'Midnapore Collectorate Branch',
      phone: '+91 3222 275302',
      status: 'ACTIVE',
    });
    branchStore.set('branch-02', {
      id: 'branch-02',
      tenantId: 'tenant_test_123',
      name: 'Daspur Main Branch',
      phone: '+91 3225 254201',
      status: 'ACTIVE',
    });

    const mockBranchRepo: any = {
      findAllForTenant: vi.fn().mockImplementation(async (ctx: TenantContext) => {
        return Array.from(branchStore.values()).filter((b) => b.tenantId === ctx.tenantId);
      }),
    };

    const controller = createBranchController(mockBranchRepo);

    const req: any = {};
    let responseStatus: number = 0;
    let responseBody: any = null;
    const res: any = {
      status: (code: number) => {
        responseStatus = code;
        return {
          json: (data: any) => {
            responseBody = data;
          },
        };
      },
    };
    const next = vi.fn((err) => { if (err) console.error("NEXT ERROR:", err); });

    await controller.getBranches(req, res, next);

    expect(responseStatus).toBe(200);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data.length).toBe(2);
    expect(responseBody.data[0].name).toBe('Midnapore Collectorate Branch');
    expect(responseBody.data[1].name).toBe('Daspur Main Branch');
  });

  it('2. GET /api/v1/departments should lazily return departments merged from tenant settings & active staff without mock data', async () => {
    // Seed real department into tenant settings
    const key = 'tenant_test_123_departments';
    tenantSettingStore.set(key, {
      id: 'setting-1',
      tenantId: 'tenant_test_123',
      namespace: 'departments',
      value: [
        {
          id: 'dept-ops-1',
          deptCode: 'DEP-101',
          deptName: 'Central Operations Desk',
          status: 'Active',
        },
      ],
    });

    // Seed an active staff with unique department
    employeeStore.set('emp-1', {
      id: 'emp-1',
      tenantId: 'tenant_test_123',
      department: 'Compliance & Verification Desk',
    });

    const controller = createDepartmentController();

    const req: any = {};
    let responseStatus: number = 0;
    let responseBody: any = null;
    const res: any = {
      status: (code: number) => {
        responseStatus = code;
        return {
          json: (data: any) => {
            responseBody = data;
          },
        };
      },
    };
    const next = vi.fn((err) => { if (err) console.error("NEXT ERROR:", err); });

    await controller.getDepartments(req, res, next);

    expect(responseStatus).toBe(200);
    expect(responseBody.success).toBe(true);
    const deptNames = responseBody.data.map((d: any) => d.deptName);
    expect(deptNames).toContain('Central Operations Desk');
    expect(deptNames).toContain('Compliance & Verification Desk');
    expect(responseBody.data.length).toBe(2);
  });

  it('3. POST /api/v1/departments should create and persist new department in database settings', async () => {
    const controller = createDepartmentController();

    const req: any = {
      body: {
        deptCode: 'DEP-888',
        deptName: 'Executive VIP Lounge',
        headOfDept: 'Pooja Verma',
        branch: 'Midnapore Collectorate Branch',
        status: 'Active',
      },
    };
    let responseStatus: number = 0;
    let responseBody: any = null;
    const res: any = {
      status: (code: number) => {
        responseStatus = code;
        return {
          json: (data: any) => {
            responseBody = data;
          },
        };
      },
    };
    const next = vi.fn((err) => { if (err) console.error("NEXT ERROR:", err); });

    await controller.createDepartment(req, res, next);

    expect(responseStatus).toBe(201);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data.deptName).toBe('Executive VIP Lounge');

    // Verify persisted into tenantSetting
    const key = 'tenant_test_123_departments';
    const persisted = tenantSettingStore.get(key);
    expect(persisted).toBeDefined();
    expect(persisted.value.some((d: any) => d.deptName === 'Executive VIP Lounge')).toBe(true);
  });

  it('4. GET /api/v1/departments/:id should return specific department from database or 404 if not found', async () => {
    // Seed department into tenant settings
    const key = 'tenant_test_123_departments';
    tenantSettingStore.set(key, {
      id: 'setting-1',
      tenantId: 'tenant_test_123',
      namespace: 'departments',
      value: [
        {
          id: 'dept-frontdesk',
          deptCode: 'DEP-101',
          deptName: 'Front Desk & Reception',
          status: 'Active',
        },
      ],
    });

    const controller = createDepartmentController();

    const req: any = {
      params: { id: 'dept-frontdesk' },
    };
    let responseStatus: number = 0;
    let responseBody: any = null;
    const res: any = {
      status: (code: number) => {
        responseStatus = code;
        return {
          json: (data: any) => {
            responseBody = data;
          },
        };
      },
    };
    const next = vi.fn((err) => { if (err) console.error("NEXT ERROR:", err); });

    await controller.getDepartmentById(req, res, next);

    expect(responseStatus).toBe(200);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data.id).toBe('dept-frontdesk');
    expect(responseBody.data.deptName).toBe('Front Desk & Reception');

    // Test non-existent department returns 404
    const notFoundReq: any = { params: { id: 'non-existent-dept' } };
    await controller.getDepartmentById(notFoundReq, res, next);
    expect(responseStatus).toBe(404);
    expect(responseBody.success).toBe(false);
  });
});


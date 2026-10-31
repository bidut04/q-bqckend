import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScopeType, EmployeeStatus } from '@prisma/client';

// Hoist stores and mockDb for Vitest module hoisting
const {
  employeeStore,
  tenantRoleStore,
  permissionStore,
  rolePermissionStore,
  employeeRoleStore,
  tenantSettingStore,
  mockDb,
} = vi.hoisted(() => {
  const employeeStore = new Map<string, any>();
  const tenantRoleStore = new Map<string, any>();
  const permissionStore = new Map<string, any>();
  const rolePermissionStore = new Map<string, any>();
  const employeeRoleStore = new Map<string, any>();
  const tenantSettingStore = new Map<string, any>();

  const mockDb: any = {
    tenantRole: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const role of tenantRoleStore.values()) {
          if (where.tenantId && role.tenantId !== where.tenantId) continue;
          if (where.id && role.id !== where.id) continue;
          if (where.name && role.name !== where.name) continue;
          return {
            ...role,
            permissions: Array.from(rolePermissionStore.values())
              .filter((rp) => rp.roleId === role.id)
              .map((rp) => ({
                ...rp,
                permission: permissionStore.get(rp.permissionId),
              })),
            _count: { employees: 0, assignments: 0 },
          };
        }
        return null;
      }),
      findMany: vi.fn().mockImplementation(async () => {
        return Array.from(tenantRoleStore.values()).map((role) => ({
          ...role,
          permissions: Array.from(rolePermissionStore.values())
            .filter((rp) => rp.roleId === role.id)
            .map((rp) => ({
              ...rp,
              permission: permissionStore.get(rp.permissionId),
            })),
          _count: { employees: 0, assignments: 0 },
        }));
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = data.id || `role-${Date.now()}`;
        const record = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        tenantRoleStore.set(id, record);
        return record;
      }),
    },
    permission: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const perm of permissionStore.values()) {
          if (where.tenantId && perm.tenantId !== where.tenantId) continue;
          if (where.key && perm.key !== where.key) continue;
          return perm;
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = data.id || `perm-${Date.now()}-${Math.random()}`;
        const record = { id, ...data };
        permissionStore.set(id, record);
        return record;
      }),
    },
    rolePermission: {
      upsert: vi.fn().mockImplementation(async ({ create }: any) => {
        const key = `${create.roleId}_${create.permissionId}`;
        const record = { ...create };
        rolePermissionStore.set(key, record);
        return {
          ...record,
          permission: permissionStore.get(create.permissionId),
        };
      }),
    },
    employee: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const emp of employeeStore.values()) {
          if (where.tenantId && emp.tenantId !== where.tenantId) continue;
          if (where.id && emp.id !== where.id) continue;
          if (where.userId && emp.userId !== where.userId) continue;
          if (where.employeeCode && emp.employeeCode !== where.employeeCode) continue;
          return {
            ...emp,
            roles: Array.from(employeeRoleStore.values())
              .filter((er) => er.employeeId === emp.id)
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
          };
        }
        return null;
      }),
    },
    userRoleAssignment: {
      findMany: vi.fn().mockResolvedValue([]),
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
  };

  return {
    employeeStore,
    tenantRoleStore,
    permissionStore,
    rolePermissionStore,
    employeeRoleStore,
    tenantSettingStore,
    mockDb,
  };
});

// Mock database layer
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

import { Permission } from '../../src/core/authorization/permissions';
import { createRoleRepository } from '../../src/repository/role.repository';
import { createRoleService } from '../../src/modules/role/role.service';
import { TenantContext } from '../../src/core/tenant/tenant-context';

describe('Receptionist Employee RBAC & Permissions Matrix Test Suite', () => {
  const tenantId = 'tenant_receptionist_test';
  const adminUserId = 'user_admin_001';
  const receptionistUserId = 'user_receptionist_001';

  const mockAdminContext: TenantContext = {
    tenantId,
    userId: adminUserId,
    roleIds: ['TENANT_ADMIN'],
    permissions: [
      Permission.ROLE_READ,
      Permission.ROLE_CREATE,
      Permission.ROLE_UPDATE,
      Permission.ROLE_DELETE,
      Permission.ROLE_ASSIGN,
    ],
    branchIds: [],
    sessionId: 'session_admin',
    securityVersion: 1,
  };

  const receptionistContext: TenantContext = {
    tenantId,
    userId: receptionistUserId,
    roleIds: ['role-receptionist'],
    permissions: [
      'TICKET_CREATE',
      'QUEUE_CALL',
      'QUEUE_VIEW',
      'BOOKING_READ',
      'BOOKING_CREATE',
    ],
    branchIds: ['branch_main'],
    sessionId: 'session_receptionist',
    securityVersion: 1,
  };

  beforeEach(() => {
    employeeStore.clear();
    tenantRoleStore.clear();
    permissionStore.clear();
    rolePermissionStore.clear();
    employeeRoleStore.clear();
    tenantSettingStore.clear();
    vi.clearAllMocks();
  });

  it('1. should create Receptionist role and assign operational permissions', async () => {
    const roleRepo = createRoleRepository();
    const roleService = createRoleService(roleRepo);

    const operationalPermissions = [
      'TICKET_CREATE',
      'QUEUE_CALL',
      'QUEUE_VIEW',
      'BOOKING_READ',
      'BOOKING_CREATE',
    ];

    const receptionistRole = await roleService.createRole(mockAdminContext, {
      name: 'Receptionist',
      description: 'Front desk reception, visitor token issuance, and queue check-in',
      maxScope: ScopeType.LOCATION,
      permissionKeys: operationalPermissions,
    });

    expect(receptionistRole).toBeDefined();
    expect(receptionistRole.name).toBe('Receptionist');
    expect(receptionistRole.permissions.length).toBe(operationalPermissions.length);
    const assignedKeys = receptionistRole.permissions.map((p: any) => p.permission.key);
    expect(assignedKeys).toContain('TICKET_CREATE');
    expect(assignedKeys).toContain('QUEUE_CALL');
    expect(assignedKeys).toContain('BOOKING_CREATE');
  });

  it('2. should associate Employee (Pooja Verma) with Receptionist role', async () => {
    const roleId = 'role-rec-001';
    tenantRoleStore.set(roleId, {
      id: roleId,
      tenantId,
      name: 'Receptionist',
      maxScope: ScopeType.LOCATION,
    });

    const employeeId = 'emp-rec-001';
    employeeStore.set(employeeId, {
      id: employeeId,
      tenantId,
      userId: receptionistUserId,
      employeeCode: 'EMP-REC-01',
      name: 'Pooja Verma',
      department: 'Front Desk & Reception',
      status: EmployeeStatus.ACTIVE,
    });

    // Associate Employee with Role
    employeeRoleStore.set(`${employeeId}_${roleId}`, {
      employeeId,
      roleId,
    });

    const roleRepo = createRoleRepository();
    const permissions = await roleRepo.getEffectiveUserPermissions(
      receptionistContext,
      receptionistUserId
    );

    expect(employeeRoleStore.has(`${employeeId}_${roleId}`)).toBe(true);
    expect(permissions).toBeDefined();
  });

  it('3. should verify Effective Permissions resolve operational rights and deny admin rights', async () => {
    const roleId = 'role-rec-001';
    tenantRoleStore.set(roleId, {
      id: roleId,
      tenantId,
      name: 'Receptionist',
      maxScope: ScopeType.LOCATION,
    });

    const permissions = [
      'TICKET_CREATE',
      'QUEUE_CALL',
      'QUEUE_VIEW',
      'BOOKING_READ',
      'BOOKING_CREATE',
    ];

    permissions.forEach((key, idx) => {
      const permId = `perm-${idx}`;
      permissionStore.set(permId, { id: permId, tenantId, key });
      rolePermissionStore.set(`${roleId}_${permId}`, { roleId, permissionId: permId });
    });

    const employeeId = 'emp-rec-001';
    employeeStore.set(employeeId, {
      id: employeeId,
      tenantId,
      userId: receptionistUserId,
      employeeCode: 'EMP-REC-01',
      name: 'Pooja Verma',
      department: 'Front Desk & Reception',
      status: EmployeeStatus.ACTIVE,
    });

    employeeRoleStore.set(`${employeeId}_${roleId}`, {
      employeeId,
      roleId,
    });

    const roleRepo = createRoleRepository();
    const effectivePerms = await roleRepo.getEffectiveUserPermissions(
      receptionistContext,
      receptionistUserId
    );

    // Operational permissions MUST be granted
    expect(effectivePerms).toContain('TICKET_CREATE');
    expect(effectivePerms).toContain('QUEUE_CALL');
    expect(effectivePerms).toContain('QUEUE_VIEW');
    expect(effectivePerms).toContain('BOOKING_READ');
    expect(effectivePerms).toContain('BOOKING_CREATE');

    // Admin permissions MUST NOT be granted
    expect(effectivePerms).not.toContain('ROLE_CREATE');
    expect(effectivePerms).not.toContain('ROLE_DELETE');
    expect(effectivePerms).not.toContain('PERMISSION_MANAGEMENT');
    expect(effectivePerms).not.toContain('SYSTEM_CONFIGURATION');
  });

  it('4. should persist and retrieve custom Permissions Matrix for Receptionist in TenantSetting', async () => {
    const roleRepo = createRoleRepository();
    const roleService = createRoleService(roleRepo);
    const roleId = 'role-rec-001';

    const receptionistMatrix = [
      {
        id: 'tickets',
        module: 'Live Tickets',
        create: true,
        read: true,
        update: true,
        delete: false,
        copy: true,
        excel: false,
        print: true,
        pdf: false,
      },
      {
        id: 'queue',
        module: 'Queue Management',
        create: true,
        read: true,
        update: true,
        delete: false,
        copy: true,
        excel: false,
        print: true,
        pdf: false,
      },
      {
        id: 'bookings',
        module: 'Bookings',
        create: true,
        read: true,
        update: false,
        delete: false,
        copy: true,
        excel: true,
        print: true,
        pdf: false,
      },
      {
        id: 'roles',
        module: 'Roles & Designations',
        create: false,
        read: false, // REVOKED -> Hidden from sidebar
        update: false,
        delete: false,
        copy: false,
        excel: false,
        print: false,
        pdf: false,
      },
      {
        id: 'permissions',
        module: 'Permissions Matrix',
        create: false,
        read: false, // REVOKED -> Hidden from sidebar
        update: false,
        delete: false,
        copy: false,
        excel: false,
        print: false,
        pdf: false,
      },
      {
        id: 'settings',
        module: 'Company Settings',
        create: false,
        read: false, // REVOKED -> Hidden from sidebar
        update: false,
        delete: false,
        copy: false,
        excel: false,
        print: false,
        pdf: false,
      },
    ];

    // Save Matrix to backend
    await roleService.savePermissionsMatrix(mockAdminContext, receptionistMatrix, roleId);

    // Fetch Matrix from backend
    const savedMatrix: any = await roleService.getPermissionsMatrix(mockAdminContext, roleId);
    expect(savedMatrix).toBeDefined();
    expect(Array.isArray(savedMatrix)).toBe(true);

    // Verify Operational Modules have READ power
    const ticketsModule = savedMatrix.find((m: any) => m.id === 'tickets');
    expect(ticketsModule).toBeDefined();
    expect(ticketsModule.read).toBe(true);
    expect(ticketsModule.create).toBe(true);
    expect(ticketsModule.update).toBe(true);

    const bookingsModule = savedMatrix.find((m: any) => m.id === 'bookings');
    expect(bookingsModule.read).toBe(true);

    // Verify Admin Modules have READ power REVOKED
    const rolesModule = savedMatrix.find((m: any) => m.id === 'roles');
    expect(rolesModule.read).toBe(false);

    const permissionsModule = savedMatrix.find((m: any) => m.id === 'permissions');
    expect(permissionsModule.read).toBe(false);

    const settingsModule = savedMatrix.find((m: any) => m.id === 'settings');
    expect(settingsModule.read).toBe(false);
  });
});

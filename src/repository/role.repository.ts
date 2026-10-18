import { ScopeType, Prisma } from "@prisma/client";
import { TenantContext } from "../core/tenant/tenant-context";
import { getTenantDb, withTenantScope, ensureFound } from "../common/base.repository";
import { ResourceNotFoundError, ForbiddenError } from "../core/errors/security.errors";

export interface CreateRoleData {
  name: string;
  description?: string;
  maxScope?: ScopeType;
  permissionKeys?: string[];
}

export interface UpdateRoleData {
  name?: string;
  description?: string;
  maxScope?: ScopeType;
}

export interface ScopedRoleAssignmentData {
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string;
  grantedById?: string;
  expiresAt?: Date;
}

export const createRoleRepository = () => {
  const findRoleById = async (context: TenantContext, id: string) => {
    const db = await getTenantDb(context);
    const role = await db.tenantRole.findFirst({
      where: withTenantScope(context, { id }),
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        _count: {
          select: {
            employees: true,
            assignments: true,
          },
        },
      },
    });

    return ensureFound(role, "TenantRole");
  };

  const findRoles = async (context: TenantContext) => {
    const db = await getTenantDb(context);
    return db.tenantRole.findMany({
      where: withTenantScope(context, {}),
      orderBy: { createdAt: "asc" },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        _count: {
          select: {
            employees: true,
            assignments: true,
          },
        },
      },
    });
  };

  const findByName = async (context: TenantContext, name: string) => {
    const db = await getTenantDb(context);
    return db.tenantRole.findFirst({
      where: withTenantScope(context, { name }),
    });
  };

  const createRole = async (context: TenantContext, data: CreateRoleData) => {
    const db = await getTenantDb(context);

    const existing = await findByName(context, data.name);
    if (existing) {
      throw new Error(`Role '${data.name}' already exists in this tenant`);
    }

    const role = await db.tenantRole.create({
      data: {
        tenantId: context.tenantId,
        name: data.name,
        description: data.description,
        maxScope: data.maxScope || ScopeType.LOCATION,
        isSystem: false,
      },
    });

    if (data.permissionKeys && data.permissionKeys.length > 0) {
      for (const key of data.permissionKeys) {
        await assignPermissionToRole(context, role.id, key);
      }
    }

    return findRoleById(context, role.id);
  };

  const updateRole = async (context: TenantContext, id: string, data: UpdateRoleData) => {
    const db = await getTenantDb(context);
    const role = await findRoleById(context, id);

    if (role.isSystem && data.name && data.name !== role.name) {
      throw new ForbiddenError("Cannot rename system roles");
    }

    return db.tenantRole.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.maxScope ? { maxScope: data.maxScope } : {}),
      },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });
  };

  const deleteRole = async (context: TenantContext, id: string) => {
    const db = await getTenantDb(context);
    const role = await findRoleById(context, id);

    if (role.isSystem) {
      throw new ForbiddenError("Cannot delete system roles");
    }

    if (role._count.employees > 0 || role._count.assignments > 0) {
      throw new ForbiddenError(
        `Cannot delete role '${role.name}' because it is assigned to active employees or users`
      );
    }

    // Delete permissions first
    await db.rolePermission.deleteMany({
      where: { roleId: id },
    });

    return db.tenantRole.delete({
      where: { id },
    });
  };

  // Permission assignment to role
  const assignPermissionToRole = async (
    context: TenantContext,
    roleId: string,
    permissionKey: string
  ) => {
    const db = await getTenantDb(context);
    await findRoleById(context, roleId);

    // Upsert Permission for tenant
    let permission = await db.permission.findFirst({
      where: withTenantScope(context, { key: permissionKey }),
    });

    if (!permission) {
      permission = await db.permission.create({
        data: {
          tenantId: context.tenantId,
          key: permissionKey,
          description: `Permission for ${permissionKey}`,
        },
      });
    }

    return db.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId,
          permissionId: permission.id,
        },
      },
      create: {
        roleId,
        permissionId: permission.id,
      },
      update: {},
      include: {
        permission: true,
      },
    });
  };

  const removePermissionFromRole = async (
    context: TenantContext,
    roleId: string,
    permissionKey: string
  ) => {
    const db = await getTenantDb(context);
    await findRoleById(context, roleId);

    const permission = await db.permission.findFirst({
      where: withTenantScope(context, { key: permissionKey }),
    });

    if (!permission) {
      return { count: 0 };
    }

    return db.rolePermission.deleteMany({
      where: {
        roleId,
        permissionId: permission.id,
      },
    });
  };

  // Hybrid RBAC: Scoped user role assignment
  const assignScopedRole = async (
    context: TenantContext,
    data: ScopedRoleAssignmentData
  ) => {
    const db = await getTenantDb(context);
    const role = await findRoleById(context, data.roleId);

    // Block privilege escalation: cannot assign role at scope broader than role.maxScope
    const scopeHierarchy: Record<ScopeType, number> = {
      PLATFORM: 5,
      TENANT: 4,
      LOCATION: 3,
      SERVICE: 2,
      COUNTER: 1,
      SELF: 0,
    };

    if (scopeHierarchy[data.scopeType] > scopeHierarchy[role.maxScope]) {
      throw new ForbiddenError(
        `Role '${role.name}' allows maximum scope '${role.maxScope}', cannot assign at broader scope '${data.scopeType}'`
      );
    }

    return db.userRoleAssignment.upsert({
      where: {
        tenantId_userId_roleId_scopeType_scopeId: {
          tenantId: context.tenantId,
          userId: data.userId,
          roleId: data.roleId,
          scopeType: data.scopeType,
          scopeId: data.scopeId,
        },
      },
      create: {
        tenantId: context.tenantId,
        userId: data.userId,
        roleId: data.roleId,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        grantedById: data.grantedById || context.userId,
        expiresAt: data.expiresAt,
      },
      update: {
        expiresAt: data.expiresAt,
        grantedById: data.grantedById || context.userId,
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });
  };

  const removeScopedRole = async (context: TenantContext, assignmentId: string) => {
    const db = await getTenantDb(context);
    return db.userRoleAssignment.deleteMany({
      where: {
        id: assignmentId,
        tenantId: context.tenantId,
      },
    });
  };

  const getUserRoleAssignments = async (context: TenantContext, userId: string) => {
    const db = await getTenantDb(context);
    return db.userRoleAssignment.findMany({
      where: {
        tenantId: context.tenantId,
        userId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });
  };

  // Effective permission resolver: combines direct employee roles + scoped role assignments
  const getEffectiveUserPermissions = async (
    context: TenantContext,
    userId: string,
    targetScope?: { scopeType?: ScopeType; scopeId?: string }
  ): Promise<string[]> => {
    const db = await getTenantDb(context);
    const permissionsSet = new Set<string>();

    // 1. Direct Employee roles linked via userId
    const employee = await db.employee.findFirst({
      where: withTenantScope(context, { userId, deletedAt: null }),
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (employee) {
      for (const empRole of employee.roles) {
        for (const rp of empRole.role.permissions) {
          permissionsSet.add(rp.permission.key);
        }
      }
    }

    // 2. Scoped User Role Assignments
    const assignments = await getUserRoleAssignments(context, userId);
    for (const assignment of assignments) {
      let isScopeApplicable = false;

      if (!targetScope || !targetScope.scopeType) {
        // Broadest match
        isScopeApplicable = true;
      } else if (assignment.scopeType === ScopeType.PLATFORM || assignment.scopeType === ScopeType.TENANT) {
        // Tenant scope applies to all branches, services, counters
        isScopeApplicable = true;
      } else if (
        assignment.scopeType === targetScope.scopeType &&
        assignment.scopeId === targetScope.scopeId
      ) {
        isScopeApplicable = true;
      }

      if (isScopeApplicable) {
        for (const rp of assignment.role.permissions) {
          permissionsSet.add(rp.permission.key);
        }
      }
    }

    return Array.from(permissionsSet);
  };

  return {
    findRoleById,
    findRoles,
    findByName,
    createRole,
    updateRole,
    deleteRole,
    assignPermissionToRole,
    removePermissionFromRole,
    assignScopedRole,
    removeScopedRole,
    getUserRoleAssignments,
    getEffectiveUserPermissions,
  };
};

export type RoleRepository = ReturnType<typeof createRoleRepository>;

import { TenantContext } from "../../core/tenant/tenant-context";
import { Authorizer } from "../../core/authorization/authorizer";
import { Permission } from "../../core/authorization/permissions";
import { RoleRepository } from "../../repository/role.repository";
import {
  CreateRoleDTO,
  UpdateRoleDTO,
  AssignPermissionDTO,
  ScopedRoleAssignmentDTO,
  CheckPermissionsQuery,
} from "./role.types";

export const createRoleService = (roleRepo: RoleRepository) => {
  const getRoles = async (context: TenantContext) => {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return roleRepo.findRoles(context);
  };

  const getRoleById = async (context: TenantContext, id: string) => {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return roleRepo.findRoleById(context, id);
  };

  const createRole = async (context: TenantContext, data: CreateRoleDTO) => {
    Authorizer.authorize(context, Permission.ROLE_CREATE);
    return roleRepo.createRole(context, data);
  };

  const updateRole = async (context: TenantContext, id: string, data: UpdateRoleDTO) => {
    Authorizer.authorize(context, Permission.ROLE_UPDATE);
    return roleRepo.updateRole(context, id, data);
  };

  const deleteRole = async (context: TenantContext, id: string) => {
    Authorizer.authorize(context, Permission.ROLE_DELETE);
    return roleRepo.deleteRole(context, id);
  };

  const assignPermission = async (
    context: TenantContext,
    roleId: string,
    data: AssignPermissionDTO
  ) => {
    Authorizer.authorize(context, Permission.ROLE_UPDATE);
    return roleRepo.assignPermissionToRole(context, roleId, data.permissionKey);
  };

  const removePermission = async (
    context: TenantContext,
    roleId: string,
    permissionKey: string
  ) => {
    Authorizer.authorize(context, Permission.ROLE_UPDATE);
    return roleRepo.removePermissionFromRole(context, roleId, permissionKey);
  };

  // Scoped Role Assignments (Hybrid RBAC)
  const assignScopedRole = async (
    context: TenantContext,
    data: ScopedRoleAssignmentDTO
  ) => {
    Authorizer.authorize(context, Permission.ROLE_ASSIGN);
    return roleRepo.assignScopedRole(context, {
      userId: data.userId,
      roleId: data.roleId,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      grantedById: context.userId,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    });
  };

  const removeScopedRole = async (context: TenantContext, assignmentId: string) => {
    Authorizer.authorize(context, Permission.ROLE_ASSIGN);
    return roleRepo.removeScopedRole(context, assignmentId);
  };

  const getUserRoleAssignments = async (context: TenantContext, userId: string) => {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return roleRepo.getUserRoleAssignments(context, userId);
  };

  const getEffectivePermissions = async (
    context: TenantContext,
    query: CheckPermissionsQuery
  ) => {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return roleRepo.getEffectiveUserPermissions(
      context,
      query.userId,
      query.scopeType ? { scopeType: query.scopeType, scopeId: query.scopeId } : undefined
    );
  };

  const getAvailablePermissions = async (context: TenantContext) => {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return Object.values(Permission);
  };

  return {
    getRoles,
    getRoleById,
    createRole,
    updateRole,
    deleteRole,
    assignPermission,
    removePermission,
    assignScopedRole,
    removeScopedRole,
    getUserRoleAssignments,
    getEffectivePermissions,
    getAvailablePermissions,
  };
};

export type RoleService = ReturnType<typeof createRoleService>;

export const RoleService = function (this: unknown, roleRepo: RoleRepository) {
  return createRoleService(roleRepo);
} as unknown as {
  new (roleRepo: RoleRepository): ReturnType<typeof createRoleService>;
};


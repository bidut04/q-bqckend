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

export class RoleService {
  constructor(private readonly roleRepo: RoleRepository) {}

  public async getRoles(context: TenantContext) {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return this.roleRepo.findRoles(context);
  }

  public async getRoleById(context: TenantContext, id: string) {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return this.roleRepo.findRoleById(context, id);
  }

  public async createRole(context: TenantContext, data: CreateRoleDTO) {
    Authorizer.authorize(context, Permission.ROLE_CREATE);
    return this.roleRepo.createRole(context, data);
  }

  public async updateRole(context: TenantContext, id: string, data: UpdateRoleDTO) {
    Authorizer.authorize(context, Permission.ROLE_UPDATE);
    return this.roleRepo.updateRole(context, id, data);
  }

  public async deleteRole(context: TenantContext, id: string) {
    Authorizer.authorize(context, Permission.ROLE_DELETE);
    return this.roleRepo.deleteRole(context, id);
  }

  public async assignPermission(
    context: TenantContext,
    roleId: string,
    data: AssignPermissionDTO
  ) {
    Authorizer.authorize(context, Permission.ROLE_UPDATE);
    return this.roleRepo.assignPermissionToRole(context, roleId, data.permissionKey);
  }

  public async removePermission(
    context: TenantContext,
    roleId: string,
    permissionKey: string
  ) {
    Authorizer.authorize(context, Permission.ROLE_UPDATE);
    return this.roleRepo.removePermissionFromRole(context, roleId, permissionKey);
  }

  // Scoped Role Assignments (Hybrid RBAC)
  public async assignScopedRole(
    context: TenantContext,
    data: ScopedRoleAssignmentDTO
  ) {
    Authorizer.authorize(context, Permission.ROLE_ASSIGN);
    return this.roleRepo.assignScopedRole(context, {
      userId: data.userId,
      roleId: data.roleId,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      grantedById: context.userId,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    });
  }

  public async removeScopedRole(context: TenantContext, assignmentId: string) {
    Authorizer.authorize(context, Permission.ROLE_ASSIGN);
    return this.roleRepo.removeScopedRole(context, assignmentId);
  }

  public async getUserRoleAssignments(context: TenantContext, userId: string) {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return this.roleRepo.getUserRoleAssignments(context, userId);
  }

  public async getEffectivePermissions(
    context: TenantContext,
    query: CheckPermissionsQuery
  ) {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return this.roleRepo.getEffectiveUserPermissions(
      context,
      query.userId,
      query.scopeType ? { scopeType: query.scopeType, scopeId: query.scopeId } : undefined
    );
  }

  public async getAvailablePermissions(context: TenantContext) {
    Authorizer.authorize(context, Permission.ROLE_READ);
    return Object.values(Permission);
  }
}

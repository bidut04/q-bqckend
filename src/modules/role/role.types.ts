import { ScopeType } from "@prisma/client";

export interface CreateRoleDTO {
  name: string;
  description?: string;
  maxScope?: ScopeType;
  permissionKeys?: string[];
}

export interface UpdateRoleDTO {
  name?: string;
  description?: string;
  maxScope?: ScopeType;
}

export interface AssignPermissionDTO {
  permissionKey: string;
}

export interface ScopedRoleAssignmentDTO {
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string;
  expiresAt?: string;
}

export interface CheckPermissionsQuery {
  userId: string;
  scopeType?: ScopeType;
  scopeId?: string;
}

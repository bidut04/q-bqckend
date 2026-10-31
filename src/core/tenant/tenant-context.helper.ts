import { Request } from "express";
import { TenantContext } from "./tenant-context";
import { getDefaultPermissionsForRole, Permission } from "../authorization/permissions";

export const getTenantContextFromRequest = (req: Request): TenantContext => {
  const rawHeaderTenantId = req.headers["x-tenant-id"] ?? req.headers["x-tenant"];
  const headerTenantId = typeof rawHeaderTenantId === "string" ? rawHeaderTenantId.trim() : undefined;

  const user = req.user;
  const isPlatformAdmin = user?.isSuperAdmin === true;
  const rawRole = (user?.role as string) ?? "USER";

  let tenantId = "";
  if (user) {
    if (isPlatformAdmin) {
      if (headerTenantId) {
        tenantId = headerTenantId;
      } else if (user.tenantId) {
        tenantId = user.tenantId;
      } else if (req.tenantId) {
        tenantId = req.tenantId;
      }
    } else {
      if (user.tenantId) {
        tenantId = user.tenantId;
      } else if (headerTenantId) {
        tenantId = headerTenantId;
      } else if (req.tenantId) {
        tenantId = req.tenantId;
      }
    }
  } else {
    if (headerTenantId) {
      tenantId = headerTenantId;
    } else if (req.tenantId) {
      tenantId = req.tenantId;
    }
  }

  const rawHeaderBranchId = req.headers["x-branch-id"] ?? req.headers["x-branch"];
  const headerBranchId = typeof rawHeaderBranchId === "string" ? rawHeaderBranchId.trim() : undefined;

  const userBranchIds = Array.isArray((user as any)?.branchIds) ? (user as any).branchIds : [];

  let branchIds: string[] = [];
  if (isPlatformAdmin && headerBranchId) {
    branchIds = [headerBranchId];
  } else if (userBranchIds.length > 0) {
    branchIds = userBranchIds;
  } else if (headerBranchId) {
    branchIds = [headerBranchId];
  }

  const rawPermissions = Array.isArray((user as any)?.permissions) ? (user as any).permissions : [];
  const permissions: Permission[] =
    rawPermissions.length > 0
      ? (rawPermissions as Permission[])
      : getDefaultPermissionsForRole(rawRole);

  const actorUserId = user?.id ? user.id : "anonymous";
  const actorSessionId = user?.sessionId ? user.sessionId : "default-session";
  const actorSecurityVersion = typeof user?.securityVersion === "number" ? user.securityVersion : 1;

  return {
    userId: actorUserId,
    tenantId,
    roleIds: [rawRole],
    permissions,
    branchIds,
    sessionId: actorSessionId,
    securityVersion: actorSecurityVersion,
    shardId: req.shardId,
  };
};

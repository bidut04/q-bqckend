import { Request } from "express";
import { TenantContext } from "./tenant-context";
import { getDefaultPermissionsForRole, Permission } from "../authorization/permissions";

export const getTenantContextFromRequest = (req: Request): TenantContext => {
  const headerTenantId = req.headers["x-tenant-id"] || req.headers["x-tenant"];
  const user = req.user;
  const tenantId = (user?.tenantId || req.tenantId || headerTenantId || "default-tenant") as string;
  const rawRole = (user?.role || "USER") as string;

  const headerBranchId = (req.headers["x-branch-id"] || req.headers["x-branch"]) as string | undefined;
  const branchIds = headerBranchId ? [headerBranchId] : (user as any)?.branchIds || [];

  const rawPermissions = (user as any)?.permissions || [];
  const permissions: Permission[] =
    rawPermissions.length > 0
      ? (rawPermissions as Permission[])
      : getDefaultPermissionsForRole(rawRole);

  return {
    userId: user?.id || "anonymous",
    tenantId,
    roleIds: [rawRole],
    permissions,
    branchIds,
    sessionId: user?.sessionId || "default-session",
    securityVersion: user?.securityVersion || 1,
    shardId: req.shardId,
  };
};


import { Request } from "express";
import { TenantContext } from "./tenant-context";
import { getDefaultPermissionsForRole, Permission } from "../authorization/permissions";

export const getTenantContextFromRequest = (req: Request): TenantContext => {
  const headerTenantId = (req.headers["x-tenant-id"] || req.headers["x-tenant"]) as string | undefined;
  const user = req.user;
  const rawRole = (user?.role || "USER") as string;

  // Platform admin check: only platform super-admins can switch tenants via header
  const isPlatformAdmin =
    user?.isSuperAdmin === true ||
    rawRole === "ADMIN" ||
    rawRole === "PLATFORM_OWNER" ||
    rawRole === "PLATFORM_SUPER_ADMIN";

  let tenantId: string;
  if (user) {
    if (isPlatformAdmin) {
      tenantId = headerTenantId || user.tenantId || req.tenantId || "default-tenant";
    } else {
      // Non-platform admin: strictly trust verified user tenant context or route-bound tenantId.
      // Untrusted x-tenant-id headers from client requests are ignored to prevent tenant isolation bypass.
      tenantId = user.tenantId || req.tenantId || "default-tenant";
    }
  } else {
    // Unauthenticated/public request (e.g. discovery or public queue view)
    tenantId = req.tenantId || headerTenantId || "default-tenant";
  }

  const headerBranchId = (req.headers["x-branch-id"] || req.headers["x-branch"]) as string | undefined;
  const branchIds = isPlatformAdmin && headerBranchId
    ? [headerBranchId]
    : (user as any)?.branchIds?.length
    ? (user as any).branchIds
    : headerBranchId
    ? [headerBranchId]
    : [];

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


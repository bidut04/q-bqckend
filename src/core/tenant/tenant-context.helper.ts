import { Request } from "express";
import { TenantContext } from "./tenant-context";

export const getTenantContextFromRequest = (req: Request): TenantContext => {
  const headerTenantId = req.headers["x-tenant-id"] || req.headers["x-tenant"];
  const user = req.user;
  const tenantId = (user?.tenantId || req.tenantId || headerTenantId || "default-tenant") as string;

  return {
    userId: user?.id || "anonymous",
    tenantId,
    roleIds: [user?.role || "USER"],
    permissions: [],
    branchIds: [],
    sessionId: user?.sessionId || "default-session",
    securityVersion: user?.securityVersion || 1,
    shardId: req.shardId,
  };
};

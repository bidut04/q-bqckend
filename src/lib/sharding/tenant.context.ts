// src/lib/sharding/tenant.context.ts

import { TenantContext as ITenantContext } from "../../core/tenant/tenant-context";
import {
  runWithTenantContext,
  getTenantContext,
  requireTenantContext,
} from "../../core/tenant/tenant-context.store";

export const runTenantContext = <T>(
  context: Partial<ITenantContext> & { tenantId: string; userId: string; isSuperAdmin?: boolean },
  callback: () => T
): T => {
  const fullContext: ITenantContext = {
    userId: context.userId,
    tenantId: context.tenantId,
    roleIds: context.roleIds || [],
    permissions: context.permissions || [],
    branchIds: context.branchIds || [],
    sessionId: context.sessionId || "default_session",
    securityVersion: context.securityVersion ?? 0,
    isSupportSession: context.isSupportSession,
    supportReason: context.supportReason,
    shardId: context.shardId,
  };
  return runWithTenantContext(fullContext, callback) as T;
};

export { getTenantContext, requireTenantContext };

export const getTenantId = (): string | undefined => getTenantContext()?.tenantId;
export const getShardId = (): string | undefined => getTenantContext()?.shardId;
export const getUserId = (): string | undefined => getTenantContext()?.userId;

export const TenantContext = {
  run: runTenantContext,
  getContext: getTenantContext,
  getTenantContext,
  requireTenantContext,
  getTenantId,
  getShardId,
  getUserId,
};
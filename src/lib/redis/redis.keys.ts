import { TenantContext } from "../../core/tenant/tenant-context";

export const redisKeys = {
  queue: (context: TenantContext, queueId: string): string =>
    `tenant:${context.tenantId}:queue:${queueId}`,

  branchQueue: (context: TenantContext, branchId: string): string =>
    `tenant:${context.tenantId}:branch:${branchId}:queue`,

  booking: (context: TenantContext, bookingId: string): string =>
    `tenant:${context.tenantId}:booking:${bookingId}`,

  rateLimit: (context: TenantContext, userId: string): string =>
    `tenant:${context.tenantId}:rate-limit:${userId}`,

  idempotency: (context: TenantContext, key: string): string =>
    `tenant:${context.tenantId}:idempotency:${key}`,

  shardCatalog: (tenantId: string): string =>
    `tenant:${tenantId}:shard`,

  presence: (context: TenantContext, userId: string): string =>
    `tenant:${context.tenantId}:presence:${userId}`,

  session: (tenantId: string, sessionId: string): string =>
    `tenant:${tenantId}:session:${sessionId}`,
};

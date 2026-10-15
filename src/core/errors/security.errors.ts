import { AppError } from "../../utils/app-error";

export class BaseSecurityError extends AppError {
  constructor(
    message: string,
    statusCode: number,
    public readonly errorCode: string,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(message, statusCode, errorCode);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthenticatedError extends BaseSecurityError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHENTICATED");
  }
}

export class ForbiddenError extends BaseSecurityError {
  constructor(message = "Access forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

export class TenantContextMissingError extends BaseSecurityError {
  constructor(message = "Tenant context is missing from request pipeline") {
    super(message, 500, "TENANT_CONTEXT_MISSING");
  }
}

export class TenantAccessDeniedError extends BaseSecurityError {
  constructor(message = "Access to tenant resource denied") {
    super(message, 403, "TENANT_ACCESS_DENIED");
  }
}

export class BranchAccessDeniedError extends BaseSecurityError {
  constructor(message = "Access to branch resource denied") {
    super(message, 403, "BRANCH_ACCESS_DENIED");
  }
}

export class ResourceNotFoundError extends BaseSecurityError {
  constructor(message = "Resource not found") {
    super(message, 404, "RESOURCE_NOT_FOUND");
  }
}

export class CrossTenantAccessAttemptError extends BaseSecurityError {
  constructor(message = "Cross-tenant access attempt detected") {
    super(message, 403, "CROSS_TENANT_ACCESS_ATTEMPT");
  }
}

export class ShardUnavailableError extends BaseSecurityError {
  constructor(shardId: string, details?: string) {
    super(`Shard '${shardId}' is unavailable${details ? `: ${details}` : ""}`, 503, "SHARD_UNAVAILABLE", { shardId });
  }
}

export class ShardNotFoundError extends BaseSecurityError {
  constructor(tenantId: string) {
    super(`No shard mapped for tenant '${tenantId}'`, 500, "SHARD_NOT_FOUND", { tenantId });
  }
}

export class InvalidSupportSessionError extends BaseSecurityError {
  constructor(message = "Invalid or expired support session") {
    super(message, 401, "INVALID_SUPPORT_SESSION");
  }
}

export class TenantNotFoundError extends BaseSecurityError {
  constructor(tenantId: string) {
    super(`Tenant '${tenantId}' not found`, 404, "TENANT_NOT_FOUND", { tenantId });
  }
}

export class TenantSuspendedError extends BaseSecurityError {
  constructor(tenantId: string, details?: string) {
    super(`Tenant '${tenantId}' is suspended or inactive${details ? `: ${details}` : ""}`, 403, "TENANT_SUSPENDED", { tenantId });
  }
}

export class TenantReadOnlyError extends BaseSecurityError {
  constructor(tenantId: string) {
    super(`Tenant '${tenantId}' is in read-only mode`, 403, "TENANT_READ_ONLY", { tenantId });
  }
}

export class TenantMigratingError extends BaseSecurityError {
  constructor(tenantId: string) {
    super(`Tenant '${tenantId}' is currently undergoing migration cutover lock`, 503, "TENANT_MIGRATING", { tenantId });
  }
}

export class UnauthorizedTenantAccessError extends BaseSecurityError {
  constructor(message = "Unauthorized access to tenant data") {
    super(message, 403, "UNAUTHORIZED_TENANT_ACCESS");
  }
}

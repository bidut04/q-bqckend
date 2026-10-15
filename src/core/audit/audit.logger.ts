import { TenantContext } from "../tenant/tenant-context";

export interface AuditEventPayload {
  tenantId: string;
  actorId: string;
  actorRole?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  branchId?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export class AuditLogger {
  private static sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    const sensitiveKeys = [
      "password",
      "passwordHash",
      "jwt",
      "token",
      "refreshToken",
      "accessToken",
      "secret",
      "apiKey",
      "privateKey",
      "creditCard",
      "ssn",
    ];

    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        clean[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        clean[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }

  public static log(
    context: TenantContext | undefined,
    action: string,
    resourceType: string,
    resourceId?: string,
    metadata?: Record<string, unknown>,
    requestMeta?: { branchId?: string; correlationId?: string; ipAddress?: string; userAgent?: string }
  ): AuditEventPayload {
    const event: AuditEventPayload = {
      tenantId: context?.tenantId || "SYSTEM_UNSCOPED",
      actorId: context?.userId || "ANONYMOUS",
      actorRole: context?.roleIds?.[0],
      action,
      resourceType,
      resourceId,
      branchId: requestMeta?.branchId,
      correlationId: requestMeta?.correlationId,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
      timestamp: new Date().toISOString(),
      metadata: this.sanitizeMetadata(metadata),
    };

    // Emit structured JSON log to stdout/logging backend
    console.log(JSON.stringify({ type: "SECURITY_AUDIT_LOG", event }));
    return event;
  }
}

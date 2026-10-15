import { TenantContext } from "../tenant/tenant-context";
import { Role } from "../authorization/roles";
import { Permission } from "../authorization/permissions";
import { ForbiddenError, InvalidSupportSessionError } from "../errors/security.errors";
import { AuditLogger } from "../audit/audit.logger";

export interface SupportSessionRequest {
  platformUserId: string;
  targetTenantId: string;
  reason: string;
  mfaToken: string;
  durationMinutes?: number;
}

export interface SupportSession {
  sessionId: string;
  platformUserId: string;
  targetTenantId: string;
  reason: string;
  expiresAt: Date;
  supportContext: TenantContext;
}

export class SupportSecurityService {
  private static readonly MAX_SUPPORT_SESSION_MINUTES = 30;

  /**
   * Initiates an audited, time-bound platform support session for a target tenant.
   * Requires explicit reason, platform support permission, and MFA verification.
   */
  public static async createSupportSession(
    actorContext: TenantContext,
    request: SupportSessionRequest,
    mfaValidator: (token: string) => Promise<boolean>
  ): Promise<SupportSession> {
    const isPlatformSupport = actorContext.roleIds.some(
      (r) => r === Role.PLATFORM_OWNER || r === Role.PLATFORM_ADMIN || r === Role.PLATFORM_SUPPORT
    );

    if (!isPlatformSupport || !actorContext.permissions.includes(Permission.PLATFORM_TENANT_READ)) {
      throw new ForbiddenError("Only platform administrators/support can initiate tenant impersonation");
    }

    if (!request.reason || request.reason.trim().length < 10) {
      throw new ForbiddenError("A detailed justification reason (min 10 characters) is required for support access");
    }

    const isValidMfa = await mfaValidator(request.mfaToken);
    if (!isValidMfa) {
      throw new InvalidSupportSessionError("MFA challenge failed. Re-authentication is required to access support mode");
    }

    const duration = Math.min(request.durationMinutes || 15, this.MAX_SUPPORT_SESSION_MINUTES);
    const expiresAt = new Date(Date.now() + duration * 60 * 1000);
    const sessionId = `supp_sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const supportContext: TenantContext = Object.freeze({
      userId: actorContext.userId,
      tenantId: request.targetTenantId,
      roleIds: Object.freeze([Role.PLATFORM_SUPPORT]),
      permissions: Object.freeze([
        Permission.TENANT_READ,
        Permission.BRANCH_READ,
        Permission.BOOKING_READ,
        Permission.QUEUE_READ,
        Permission.FORM_READ,
        Permission.AUDIT_READ,
      ]),
      branchIds: Object.freeze([]), // Full tenant read scope
      sessionId,
      securityVersion: 0,
      isSupportSession: true,
      supportReason: request.reason,
    });

    AuditLogger.log(actorContext, "SUPPORT_SESSION_STARTED", "Tenant", request.targetTenantId, {
      supportSessionId: sessionId,
      targetTenantId: request.targetTenantId,
      reason: request.reason,
      expiresAt: expiresAt.toISOString(),
    });

    return {
      sessionId,
      platformUserId: actorContext.userId,
      targetTenantId: request.targetTenantId,
      reason: request.reason,
      expiresAt,
      supportContext,
    };
  }
}

import { TenantContext } from "./tenant-context";
import { UnauthenticatedError, ForbiddenError } from "../errors/security.errors";

export interface TrustedSessionPayload {
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly branches: readonly string[];
  readonly sessionId: string;
  readonly securityVersion: number;
  readonly isSupportSession?: boolean;
  readonly supportReason?: string;
}

export interface SessionValidator {
  validateSession(sessionId: string, expectedUserId: string, expectedSecurityVersion: number): Promise<boolean>;
}

export class TenantResolver {
  constructor(private readonly sessionValidator?: SessionValidator) {}

  /**
   * Resolves and builds an immutable TenantContext strictly from authenticated payload claims.
   * Explicitly ignores untrusted client inputs (body, query, headers, route params).
   */
  public async resolveFromSession(payload: TrustedSessionPayload): Promise<TenantContext> {
    if (!payload.tenantId || typeof payload.tenantId !== "string" || payload.tenantId.trim() === "") {
      throw new UnauthenticatedError("Invalid token: missing required tenantId claim.");
    }

    if (!payload.userId || typeof payload.userId !== "string") {
      throw new UnauthenticatedError("Invalid token: missing required userId claim.");
    }

    if (this.sessionValidator) {
      const isValid = await this.sessionValidator.validateSession(
        payload.sessionId,
        payload.userId,
        payload.securityVersion
      );
      if (!isValid) {
        throw new UnauthenticatedError("Session revoked or security version mismatch.");
      }
    }

    return Object.freeze({
      userId: payload.userId,
      tenantId: payload.tenantId,
      roleIds: Object.freeze([...(payload.roles || [])]),
      permissions: Object.freeze([...(payload.permissions || [])]),
      branchIds: Object.freeze([...(payload.branches || [])]),
      sessionId: payload.sessionId,
      securityVersion: payload.securityVersion,
      isSupportSession: Boolean(payload.isSupportSession),
      supportReason: payload.supportReason,
    });
  }
}

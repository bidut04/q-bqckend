import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./authenticate";
import { TenantResolver } from "../core/tenant/tenant-resolver";
import { runWithTenantContext } from "../core/tenant/tenant-context.store";
import { UnauthenticatedError } from "../core/errors/security.errors";

const resolver = new TenantResolver();

export const establishTenantContext = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.userPayload) {
      throw new UnauthenticatedError("Authentication must precede tenant context creation.");
    }

    const context = await resolver.resolveFromSession({
      userId: req.userPayload.sub,
      tenantId: req.userPayload.tenantId,
      roles: req.userPayload.roles || [],
      permissions: req.userPayload.permissions || [],
      branches: req.userPayload.branches || [],
      sessionId: req.userPayload.sessionId,
      securityVersion: req.userPayload.securityVersion,
      isSupportSession: req.userPayload.isSupportSession,
      supportReason: req.userPayload.supportReason,
    });

    req.tenantContext = context;

    runWithTenantContext(context, () => {
      next();
    });
  } catch (error) {
    next(error);
  }
};

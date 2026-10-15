import { Request, Response, NextFunction } from "express";
import { verifyJwt } from "../security/jwt";
import { UnauthenticatedError } from "../core/errors/security.errors";

export interface AuthenticatedRequest extends Request {
  userPayload?: {
    sub: string;
    tenantId: string;
    roles: string[];
    permissions: string[];
    branches: string[];
    sessionId: string;
    securityVersion: number;
    isSupportSession?: boolean;
    supportReason?: string;
  };
}

export const authenticate = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      throw new UnauthenticatedError("Missing authorization bearer token or session cookie");
    }

    const decoded = verifyJwt(token) as any;
    if (!decoded || !decoded.sub || !decoded.tenantId) {
      throw new UnauthenticatedError("Invalid token claims");
    }

    req.userPayload = {
      sub: decoded.sub,
      tenantId: decoded.tenantId,
      roles: decoded.roles || [],
      permissions: decoded.permissions || [],
      branches: decoded.branches || [],
      sessionId: decoded.sessionId,
      securityVersion: decoded.securityVersion || 0,
      isSupportSession: decoded.isSupportSession,
      supportReason: decoded.supportReason,
    };

    next();
  } catch (error) {
    next(error);
  }
};

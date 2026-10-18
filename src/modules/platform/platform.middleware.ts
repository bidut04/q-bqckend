import { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { verifyAccessToken } from "../../security/jwt";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors";
import { Permission, PLATFORM_ROLE_PERMISSIONS } from "../../core/authorization/permissions";
import { PlatformRoleType, MemberStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";

export interface PlatformUserContext {
  userId: string;
  email: string;
  role: PlatformRoleType;
  permissions: readonly Permission[];
}

declare global {
  namespace Express {
    interface Request {
      platformUser?: PlatformUserContext;
    }
  }
}

/**
 * Ensures request has valid platform authentication and user is an ACTIVE PlatformMember.
 */
export const requirePlatformAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      throw new UnauthorizedError("Authentication token is missing");
    }

    const payload = verifyAccessToken(token);
    const userId = payload.sub;

    // Check platform membership in Catalog DB
    const platformMember = await prisma.platformMember.findUnique({
      where: { userId },
      include: { user: { select: { email: true, isActive: true } } },
    });

    if (!platformMember) {
      // Check legacy/fallback if role in payload is a platform role
      const legacyRole = payload.role as string;
      if (
        legacyRole === "PLATFORM_OWNER" ||
        legacyRole === "PLATFORM_ADMIN" ||
        legacyRole === "PLATFORM_SUPPORT" ||
        legacyRole === "SUPER_ADMIN"
      ) {
        const assignedRole: PlatformRoleType =
          legacyRole === "PLATFORM_SUPPORT"
            ? PlatformRoleType.PLATFORM_SUPPORT
            : legacyRole === "PLATFORM_ADMIN"
            ? PlatformRoleType.PLATFORM_ADMIN
            : PlatformRoleType.PLATFORM_OWNER;

        req.platformUser = {
          userId,
          email: "",
          role: assignedRole,
          permissions: PLATFORM_ROLE_PERMISSIONS[assignedRole] || [],
        };
        return next();
      }

      throw new ForbiddenError("Platform administrator privileges are required to access this resource");
    }

    if (platformMember.status !== MemberStatus.ACTIVE) {
      throw new ForbiddenError(`Platform membership is currently ${platformMember.status}`);
    }

    if (platformMember.user && !platformMember.user.isActive) {
      throw new ForbiddenError("User account has been disabled");
    }

    req.platformUser = {
      userId,
      email: platformMember.user?.email || "",
      role: platformMember.role,
      permissions: PLATFORM_ROLE_PERMISSIONS[platformMember.role] || [],
    };

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Granular Least-Privilege RBAC middleware for platform endpoints.
 */
export const requirePlatformPermission = (permission: Permission) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.platformUser) {
      return next(new UnauthorizedError("Platform authentication required"));
    }

    if (!req.platformUser.permissions.includes(permission)) {
      return next(
        new ForbiddenError(
          `Platform permission '${permission}' is required. Role '${req.platformUser.role}' is not authorized.`
        )
      );
    }

    next();
  };
};

/**
 * Platform Idempotency Middleware.
 * Caches responses for sensitive/repeatable requests using PlatformIdempotencyKey.
 */
export const platformIdempotency = (scope: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    if (!rawKey || typeof rawKey !== "string") {
      return next();
    }

    const key = rawKey.trim();
    const actorId = req.platformUser?.userId || "anonymous";

    try {
      const existing = await prisma.platformIdempotencyKey.findUnique({
        where: {
          scope_actorId_key: { scope, actorId, key },
        },
      });

      if (existing && existing.responseCode && existing.responseBody) {
        res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT");
        res.status(existing.responseCode).json(existing.responseBody);
        return;
      }

      const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(req.body || {}))
        .digest("hex");

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      if (!existing) {
        await prisma.platformIdempotencyKey.create({
          data: {
            scope,
            actorId,
            key,
            requestHash,
            expiresAt,
          },
        });
      }

      // Intercept res.json to cache response
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          prisma.platformIdempotencyKey
            .update({
              where: {
                scope_actorId_key: { scope, actorId, key },
              },
              data: {
                responseCode: res.statusCode,
                responseBody: body,
              },
            })
            .catch((err) => {
              console.error("[Idempotency] Failed to store response body:", err);
            });
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      // On idempotency error, continue normal execution without blocking client
      console.warn("[Idempotency] Middleware fallback:", err);
      next();
    }
  };
};

import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { verifyAccessToken } from "../security/jwt";
import { UnauthorizedError } from "../lib/errors";
import { redisSecurityCache } from "../service/redis.service";
import { prisma } from "../config/prisma";

export const requireAuth = async (
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;
        let token: string | undefined;

        if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
            token = authHeader.substring(7).trim();
        }

        if (req.cookies && req.cookies.accessToken) {
            _res.clearCookie("accessToken");
        }

        if (!token) {
            throw new UnauthorizedError("Authentication token is missing");
        }

        const payload = verifyAccessToken(token);

        if (payload.securityVersion !== undefined) {
            const currentVersion = await redisSecurityCache.getSecurityVersion(payload.sub);
            if (currentVersion !== null && currentVersion > payload.securityVersion) {
                throw new UnauthorizedError("Session has been revoked. Please log in again.");
            }
        }

        const userWithTenants = await prisma.user.findUnique({
            where: { id: payload.sub },
            select: {
                email: true,
                platformMember: { select: { role: true, status: true } },
                tenantMemberships: {
                    where: { status: "ACTIVE" },
                    select: { tenantId: true, adminRole: true }
                }
            }
        });

        const isSuperAdmin = userWithTenants?.platformMember?.status === "ACTIVE";

        const rawHeaderTenantId = req.headers["x-tenant-id"] ?? req.headers["x-tenant"];
        const headerTenantId = typeof rawHeaderTenantId === "string" ? rawHeaderTenantId.trim() : undefined;

        let activeTenantId: string | undefined;
        const primaryMembership = userWithTenants?.tenantMemberships?.[0];

        if (isSuperAdmin) {
            if (headerTenantId) {
                activeTenantId = headerTenantId;
            } else if (primaryMembership?.tenantId) {
                activeTenantId = primaryMembership.tenantId;
            }
        } else {
            if (headerTenantId) {
                const isMemberOfHeaderTenant = userWithTenants?.tenantMemberships?.some(
                    (m) => m.tenantId === headerTenantId
                );
                if (isMemberOfHeaderTenant) {
                    activeTenantId = headerTenantId;
                } else if (primaryMembership?.tenantId) {
                    activeTenantId = primaryMembership.tenantId;
                }
            } else if (primaryMembership?.tenantId) {
                activeTenantId = primaryMembership.tenantId;
            }
        }

        req.user = {
            id: payload.sub,
            email: userWithTenants?.email ?? "",
            tenantId: activeTenantId,
            isSuperAdmin,
            role: payload.role as Role,
            securityVersion: payload.securityVersion,
            sessionId: payload.sid,
        };

        next();
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            next(error);
        } else {
            next(new UnauthorizedError("Invalid or expired authentication token"));
        }
    }
};

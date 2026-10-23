import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { verifyAccessToken } from "../security/jwt";
import { UnauthorizedError } from "../lib/errors";
import { redisSecurityCache } from "../service/redis.service";

export const requireAuth = async (
    req: Request,
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
            throw new UnauthorizedError("Authentication token is missing");
        }

        const payload = verifyAccessToken(token);

        // Security check: verify securityVersion against Redis cache if available
        // Immediately invalidates access tokens if password was changed or logout-all occurred
        if (payload.securityVersion !== undefined) {
            const currentVersion = await redisSecurityCache.getSecurityVersion(payload.sub);
            if (currentVersion !== null && currentVersion > payload.securityVersion) {
                throw new UnauthorizedError("Session has been revoked. Please log in again.");
            }
        }

        req.user = {
            id: payload.sub,
            email: "",
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

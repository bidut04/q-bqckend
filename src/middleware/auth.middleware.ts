import { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { verifyAccessToken } from "../security/jwt";
import { UnauthorizedError } from "../lib/errors";

export const requireAuth = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
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

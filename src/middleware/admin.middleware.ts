import { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

export const requireAdmin = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    if (!req.user) {
        return next(new UnauthorizedError("Authentication required"));
    }

    if (req.user.role !== "ADMIN") {
        return next(new ForbiddenError("Admin permissions required"));
    }

    next();
};

export const requireRole = (...roles: string[]) => {
    return (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) {
            return next(new UnauthorizedError("Authentication required"));
        }

        if (!roles.includes(req.user.role)) {
            return next(new ForbiddenError("Insufficient permissions"));
        }

        next();
    };
};

import { Request, Response, NextFunction } from "express";
import { getTenantContext } from "../core/tenant/tenant-context.store";
import { redisKeys } from "../lib/redis/redis.keys";
import { redis } from "../redis/redis";
import { BaseSecurityError } from "../core/errors/security.errors";

export const tenantRateLimiter = (maxRequests = 100, windowSeconds = 60) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContext();
      const identifier = context ? `${context.tenantId}:${context.userId}` : req.ip || "anon";
      const redisKey = context
        ? redisKeys.rateLimit(context, context.userId)
        : `global:rate-limit:${identifier}`;

      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, windowSeconds);
      }

      if (count > maxRequests) {
        throw new BaseSecurityError("Rate limit exceeded", 429, "RATE_LIMIT_EXCEEDED");
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

import { Request, Response, NextFunction } from "express";
import { requireTenantContext } from "../core/tenant/tenant-context.store";
import { redisKeys } from "../lib/redis/redis.keys";
import { redis } from "../redis/redis";

export const enforceIdempotency = (ttlSeconds = 86400) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    if (!idempotencyKey) {
      return next();
    }

    try {
      const context = requireTenantContext();
      const key = redisKeys.idempotency(context, idempotencyKey);

      // Check if key already exists in Redis
      const cachedResponse = await redis.get(key);
      if (cachedResponse) {
        const parsed = JSON.parse(cachedResponse);
        res.status(parsed.status).json(parsed.body);
        return;
      }

      // Intercept res.json to cache response
      const originalJson = res.json.bind(res);
      res.json = (body: any): Response => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis
            .set(key, JSON.stringify({ status: res.statusCode, body }), "EX", ttlSeconds)
            .catch((err) => console.error("Failed to cache idempotency key", err));
        }
        return originalJson(body);
      };

      next();
    } catch (error) {
      next(error);
    }
  };
};

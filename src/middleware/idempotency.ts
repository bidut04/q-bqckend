import { Request, Response, NextFunction } from "express";
import { getTenantContext } from "../core/tenant/tenant-context.store";
import { getTenantContextFromRequest } from "../core/tenant/tenant-context.helper";
import { redisKeys } from "../lib/redis/redis.keys";
import { redis } from "../redis/redis";

const memoryIdempotencyCache = new Map<string, { status: number; body: any; expiresAt: number }>();

export const enforceIdempotency = (ttlSeconds = 86400) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    const idempotencyKey = typeof rawKey === "string" ? rawKey.trim() : undefined;
    if (!idempotencyKey) {
      return next();
    }

    try {
      const context = getTenantContext() || getTenantContextFromRequest(req);
      const redisKey = redisKeys.idempotency(context, idempotencyKey);
      const memKey = `${context.tenantId}:${idempotencyKey}`;

      // 1. Check in-memory cache
      const memCached = memoryIdempotencyCache.get(memKey);
      if (memCached && memCached.expiresAt > Date.now()) {
        res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT");
        res.status(memCached.status).json(memCached.body);
        return;
      }

      // 2. Check Redis cache if available
      try {
        const cachedResponse = await redis.get(redisKey);
        if (cachedResponse) {
          const parsed = JSON.parse(cachedResponse);
          res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT");
          res.status(parsed.status).json(parsed.body);
          return;
        }
      } catch {
        // Continue if Redis is offline
      }

      // Intercept res.json to cache response
      const originalJson = res.json.bind(res);
      res.json = (body: any): Response => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const payload = { status: res.statusCode, body };
          memoryIdempotencyCache.set(memKey, {
            ...payload,
            expiresAt: Date.now() + ttlSeconds * 1000,
          });

          redis
            .set(redisKey, JSON.stringify(payload), "EX", ttlSeconds)
            .catch(() => null);
        }
        return originalJson(body);
      };

      next();
    } catch {
      // In case of unexpected context or serialization error, fall through gracefully
      next();
    }
  };
};

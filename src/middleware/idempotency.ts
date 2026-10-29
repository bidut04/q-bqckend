import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { getTenantContext } from "../core/tenant/tenant-context.store";
import { getTenantContextFromRequest } from "../core/tenant/tenant-context.helper";
import { redisKeys } from "../lib/redis/redis.keys";
import { redis } from "../redis/redis";

interface IdempotencyRecord {
  status: number;
  body: any;
  payloadHash: string;
  inFlight: boolean;
  expiresAt: number;
}

const memoryIdempotencyCache = new Map<string, IdempotencyRecord>();

/**
 * Computes deterministic SHA-256 hash of the request payload
 */
export const hashIdempotencyPayload = (body: unknown): string => {
  const content = body ? JSON.stringify(body) : "";
  return crypto.createHash("sha256").update(content).digest("hex");
};

/**
 * Idempotency Middleware with:
 * 1. Concurrent in-flight request locking (409 Conflict)
 * 2. Request body hash verification (422 Unprocessable Entity on payload mismatch)
 * 3. Exact replay of cached 2xx response (X-Cache-Lookup: HIT-IDEMPOTENT)
 * 4. Error cleanup on 4xx/5xx to allow immediate retry
 */
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
      const currentPayloadHash = hashIdempotencyPayload(req.body);

      // Helper to process an existing cached record
      const handleExistingRecord = (record: IdempotencyRecord): boolean => {
        if (record.inFlight && record.expiresAt > Date.now()) {
          res.status(409).json({
            success: false,
            code: "IDEMPOTENCY_IN_FLIGHT",
            message: "A request with this idempotency key is currently in-flight. Please retry shortly.",
          });
          return true;
        }

        if (!record.inFlight && record.expiresAt > Date.now()) {
          // Verify payload hash integrity
          if (record.payloadHash && record.payloadHash !== currentPayloadHash) {
            res.status(422).json({
              success: false,
              code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
              message: "Idempotency key was previously submitted with a different request payload.",
            });
            return true;
          }

          // Identical payload -> replay cached response
          res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT");
          res.status(record.status).json(record.body);
          return true;
        }

        return false;
      };

      // 1. Check in-memory cache
      const memCached = memoryIdempotencyCache.get(memKey);
      if (memCached && handleExistingRecord(memCached)) {
        return;
      }

      // 2. Check Redis cache if available
      try {
        const cachedRaw = await redis.get(redisKey);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw) as IdempotencyRecord;
          if (handleExistingRecord(parsed)) {
            return;
          }
        }
      } catch {
        // Fall back gracefully if Redis is offline
      }

      // 3. Acquire in-flight lock (30-second lease)
      const inFlightRecord: IdempotencyRecord = {
        status: 0,
        body: null,
        payloadHash: currentPayloadHash,
        inFlight: true,
        expiresAt: Date.now() + 30000,
      };

      memoryIdempotencyCache.set(memKey, inFlightRecord);
      try {
        await redis.set(redisKey, JSON.stringify(inFlightRecord), "EX", 30);
      } catch {
        // Ignore redis set error
      }

      // 4. Intercept response to store result or release in-flight lock on failure
      const originalJson = res.json.bind(res);
      res.json = (body: any): Response => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // Success: save completed idempotent response
          const completedRecord: IdempotencyRecord = {
            status: res.statusCode,
            body,
            payloadHash: currentPayloadHash,
            inFlight: false,
            expiresAt: Date.now() + ttlSeconds * 1000,
          };

          memoryIdempotencyCache.set(memKey, completedRecord);
          redis
            .set(redisKey, JSON.stringify(completedRecord), "EX", ttlSeconds)
            .catch(() => null);
        } else {
          // Failure (4xx/5xx): release in-flight lock so client can retry with corrected parameters
          memoryIdempotencyCache.delete(memKey);
          redis.del(redisKey).catch(() => null);
        }
        return originalJson(body);
      };

      next();
    } catch {
      // In case of unexpected context error, fall through gracefully
      next();
    }
  };
};

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { getTenantContext } from "../core/tenant/tenant-context.store";
import { getTenantContextFromRequest } from "../core/tenant/tenant-context.helper";
import { redisKeys } from "../lib/redis/redis.keys";
import { redis } from "../redis/redis";
import { prisma } from "../config/prisma";

export interface IdempotencyOptions {
  /**
   * Time to live for completed 2xx cached responses in seconds.
   * Default: 86400 (24 hours).
   */
  ttlSeconds?: number;
  /**
   * Maximum in-flight lock duration in milliseconds, aligned with HTTP request timeout.
   * Default: 30000 (30 seconds).
   */
  lockTtlMs?: number;
  /**
   * Logical domain scope to isolate keys across operations (e.g. "BOOKING_CREATE", "PAYMENT_CHARGE").
   * Default: "DEFAULT".
   */
  scope?: string;
  /**
   * Time to live for deterministic client errors (400, 422) in seconds.
   * Default: 300 (5 minutes). Set to 0 to disable caching of client errors.
   */
  clientErrorTtlSeconds?: number;
}

export interface IdempotencyRecord {
  status: number;
  body: any;
  payloadHash: string;
  inFlight: boolean;
  expiresAt: number;
  lockOwnerToken?: string;
  scope?: string;
  actorId?: string;
}

export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
export const DEFAULT_LOCK_TTL_MS = 30000;
export const DEFAULT_RESPONSE_TTL_SEC = 86400;
export const DEFAULT_CLIENT_ERR_TTL_SEC = 300;

// Fast in-process L1 cache for immediate same-process read-after-write consistency
const localProcessCache = new Map<string, IdempotencyRecord>();

const setLocalProcessCache = (key: string, record: IdempotencyRecord) => {
  if (localProcessCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of localProcessCache.entries()) {
      if (v.expiresAt <= now) {
        localProcessCache.delete(k);
      }
    }
    if (localProcessCache.size > 2000) {
      let count = 0;
      for (const k of localProcessCache.keys()) {
        localProcessCache.delete(k);
        if (++count >= 500) break;
      }
    }
  }
  localProcessCache.set(key, record);
};

/**
 * Deterministic canonical JSON serialization.
 * Recursively sorts keys so { a: 1, b: 2 } and { b: 2, a: 1 } yield the exact same string.
 */
export const canonicalJsonStringify = (obj: unknown): string => {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj) ?? "";
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJsonStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalJsonStringify((obj as Record<string, unknown>)[k])
  );
  return "{" + entries.join(",") + "}";
};

/**
 * Computes deterministic SHA-256 hash of the canonical request payload.
 */
export const hashIdempotencyPayload = (body: unknown): string => {
  const canonical = canonicalJsonStringify(body);
  return crypto.createHash("sha256").update(canonical).digest("hex");
};

/**
 * Safe lock release helper ensuring only the token owner can release the lock.
 */
export const releaseIdempotencyLock = async (
  redisKey: string,
  lockOwnerToken: string,
  tenantId: string,
  scope: string,
  actorId: string,
  idempotencyKey: string
): Promise<void> => {
  // 0. Release in local L1 cache if token matches
  const memKey = `${tenantId}:${scope}:${actorId}:${idempotencyKey}`;
  const local = localProcessCache.get(memKey);
  if (local && (!local.lockOwnerToken || local.lockOwnerToken === lockOwnerToken)) {
    localProcessCache.delete(memKey);
  }

  // 1. Release in Redis if owner token matches
  try {
    if (redis.status === "ready") {
      const cached = await redis.get(redisKey);
      if (cached) {
        const parsed = JSON.parse(cached) as IdempotencyRecord;
        if (parsed.lockOwnerToken === lockOwnerToken) {
          await redis.del(redisKey);
        }
      }
    }
  } catch {
    // Non-fatal Redis release fallback
  }

  // 2. Release in Database if owner token matches and state is still in-flight
  try {
    const existing = await prisma.idempotencyKey.findFirst({
      where: {
        tenantId,
        scope,
        actorId,
        key: idempotencyKey,
      },
    });

    if (existing && existing.responseStatus === null) {
      const body = existing.responseBody as any;
      if (body && body.lockOwnerToken === lockOwnerToken) {
        await prisma.idempotencyKey.delete({
          where: { id: existing.id },
        });
      }
    }
  } catch {
    // Non-fatal DB cleanup error
  }
};

/**
 * Production Idempotency Middleware
 *
 * Security & Reliability Guarantees:
 * 1. Scope & Actor Isolation: Unique compound key (tenantId + scope + actorId + key).
 * 2. Deterministic Canonical Hashing: SHA-256 with recursive key sorting.
 * 3. Lock Ownership Tokens: Uses unique UUIDv4 tokens so expired/foreign requests cannot release active locks.
 * 4. Lock TTL aligned with request deadline (default 30s).
 * 5. Multi-Instance DB-Backed Locking: If Redis is offline or down, falls back to MySQL database-backed locking.
 *    If the database is also unreachable, FAILS CLOSED (503 Service Unavailable), NEVER falling back to local memory.
 * 6. Explicit Failure Caching Policy:
 *    - 2xx Success: Cached for full TTL (default 24h).
 *    - 4xx Deterministic Client Errors (400, 422): Cached for short TTL (5m).
 *    - 401, 403, 429: Not cached.
 *    - 5xx Server Errors & Uncaught Exceptions: NEVER CACHED. Lock is released immediately to allow retry.
 */
export const enforceIdempotency = (options: number | IdempotencyOptions = {}) => {
  const opts: IdempotencyOptions =
    typeof options === "number" ? { ttlSeconds: options } : options;

  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_RESPONSE_TTL_SEC;
  const lockTtlMs = opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const scope = opts.scope ?? "DEFAULT";
  const clientErrorTtl = opts.clientErrorTtlSeconds ?? DEFAULT_CLIENT_ERR_TTL_SEC;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    const idempotencyKey = typeof rawKey === "string" ? rawKey.trim() : undefined;

    if (!idempotencyKey) {
      return next();
    }

    // 1. Validate Key Length (RFC / Enterprise standard: Max 128 chars)
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      res.status(400).json({
        success: false,
        code: "IDEMPOTENCY_KEY_TOO_LONG",
        message: `Idempotency-Key must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      });
      return;
    }

    // 2. Resolve Context & Actor
    const context = getTenantContext() || getTenantContextFromRequest(req);
    const tenantId = context.tenantId;
    const actorId = context.userId || "ANONYMOUS";
    const redisKey = redisKeys.idempotency(context, idempotencyKey, scope, actorId);
    const currentPayloadHash = hashIdempotencyPayload(req.body);
    const lockOwnerToken = crypto.randomUUID();
    const memKey = `${tenantId}:${scope}:${actorId}:${idempotencyKey}`;

    let isCompleted = false;

    // Helper to evaluate and replay existing records
    const handleExistingRecord = (record: IdempotencyRecord): boolean => {
      // In-flight check
      if (record.inFlight && record.expiresAt > Date.now()) {
        res.status(409).json({
          success: false,
          code: "IDEMPOTENCY_IN_FLIGHT",
          message: "A request with this idempotency key is currently in-flight. Please retry shortly.",
        });
        return true;
      }

      // Completed check
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

        // Exact replay of cached response
        res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT");
        res.status(record.status).json(record.body);
        return true;
      }

      return false;
    };

    // 0. Check in-process L1 cache for instant read-after-write consistency in this process
    const localCached = localProcessCache.get(memKey);
    if (localCached && handleExistingRecord(localCached)) {
      return;
    }

    try {
      // ========================================================================
      // TIER 1: FAST-PATH (REDIS DISTRIBUTED LOCK)
      // ========================================================================
      let acquiredInRedis = false;

      if (redis.status === "ready") {
        try {
          // Check cached record in Redis
          const cachedRaw = await redis.get(redisKey);
          if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw) as IdempotencyRecord;
            if (handleExistingRecord(parsed)) {
              return;
            }
          }

          // Acquire Redis Lock using atomic SET ... NX PX
          const inFlightRecord: IdempotencyRecord = {
            status: 0,
            body: null,
            payloadHash: currentPayloadHash,
            inFlight: true,
            expiresAt: Date.now() + lockTtlMs,
            lockOwnerToken,
            scope,
            actorId,
          };

          const lockRes = await redis.set(
            redisKey,
            JSON.stringify(inFlightRecord),
            "PX",
            lockTtlMs,
            "NX"
          );

          if (!lockRes) {
            // Lock already held by a racing concurrent request
            res.status(409).json({
              success: false,
              code: "IDEMPOTENCY_IN_FLIGHT",
              message: "A request with this idempotency key is currently in-flight. Please retry shortly.",
            });
            return;
          }

          setLocalProcessCache(memKey, inFlightRecord);
          acquiredInRedis = true;
        } catch {
          acquiredInRedis = false; // Fall back to database locking
        }
      }

      // ========================================================================
      // TIER 2: RELIABLE DB-BACKED DISTRIBUTED LOCKING (WHEN REDIS IS DOWN/OFFLINE)
      // ========================================================================
      if (!acquiredInRedis) {
        try {
          // 1. Check existing record in DB using tenant, scope, actorId, and key
          const existing = await prisma.idempotencyKey.findFirst({
            where: {
              tenantId,
              scope,
              actorId,
              key: idempotencyKey,
            },
          });

          if (existing) {
            // Check completed record in DB
            if (existing.responseStatus !== null && existing.expiresAt > new Date()) {
              if (existing.requestHash !== currentPayloadHash) {
                res.status(422).json({
                  success: false,
                  code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
                  message: "Idempotency key was previously submitted with a different request payload.",
                });
                return;
              }

              res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT");
              res.status(existing.responseStatus).json(existing.responseBody);
              return;
            }

            // Check if active in-flight lock is currently held
            const existingBody = existing.responseBody as any;
            const lockedUntil = existingBody?.lockedUntil ? Number(existingBody.lockedUntil) : 0;

            if (existing.responseStatus === null && lockedUntil > Date.now()) {
              res.status(409).json({
                success: false,
                code: "IDEMPOTENCY_IN_FLIGHT",
                message: "A request with this idempotency key is currently in-flight. Please retry shortly.",
              });
              return;
            }

            // Stale lock expired: acquire lock atomically
            await prisma.idempotencyKey.update({
              where: { id: existing.id },
              data: {
                requestHash: currentPayloadHash,
                responseStatus: null,
                responseBody: {
                  inFlight: true,
                  lockOwnerToken,
                  lockedUntil: Date.now() + lockTtlMs,
                  payloadHash: currentPayloadHash,
                },
                expiresAt: new Date(Date.now() + lockTtlMs),
              },
            });
          } else {
            // No record exists: create new IN_PROGRESS lock row
            try {
              await prisma.idempotencyKey.create({
                data: {
                  tenantId,
                  scope,
                  actorId,
                  key: idempotencyKey,
                  requestHash: currentPayloadHash,
                  responseStatus: null,
                  responseBody: {
                    inFlight: true,
                    lockOwnerToken,
                    lockedUntil: Date.now() + lockTtlMs,
                    payloadHash: currentPayloadHash,
                  },
                  expiresAt: new Date(Date.now() + lockTtlMs),
                },
              });
            } catch (err: any) {
              if (err?.code === "P2002") {
                res.status(409).json({
                  success: false,
                  code: "IDEMPOTENCY_IN_FLIGHT",
                  message: "A request with this idempotency key is currently in-flight. Please retry shortly.",
                });
                return;
              }
              throw err;
            }
          }

          setLocalProcessCache(memKey, {
            status: 0,
            body: null,
            payloadHash: currentPayloadHash,
            inFlight: true,
            expiresAt: Date.now() + lockTtlMs,
            lockOwnerToken,
            scope,
            actorId,
          });
        } catch (dbErr) {
          // FAIL-CLOSED: Reject rather than using uncoordinated in-memory Map
          console.error("[Idempotency] DB locking failure, failing closed:", dbErr);
          res.status(503).json({
            success: false,
            code: "IDEMPOTENCY_STORE_UNAVAILABLE",
            message: "Unable to reliably secure idempotency guarantee. Please retry shortly.",
          });
          return;
        }
      }

      // ========================================================================
      // TIER 3: RESPONSE INTERCEPTION & CACHE POLICY ENFORCEMENT
      // ========================================================================
      const originalJson = res.json.bind(res);

      // Clean up lock if socket or connection abruptly closes before res.json
      if (typeof res.on === "function") {
        res.on("close", () => {
          if (!isCompleted) {
            localProcessCache.delete(memKey);
            releaseIdempotencyLock(
              redisKey,
              lockOwnerToken,
              tenantId,
              scope,
              actorId,
              idempotencyKey
            ).catch(() => null);
          }
        });
      }

      let completionPromise: Promise<void> | null = null;

      res.json = (body: any): Response => {
        isCompleted = true;

        if (res.statusCode >= 200 && res.statusCode < 300) {
          // --------------------------------------------------------------------
          // POLICY 1: 2xx SUCCESS -> Full TTL Cache
          // --------------------------------------------------------------------
          const completedRecord: IdempotencyRecord = {
            status: res.statusCode,
            body,
            payloadHash: currentPayloadHash,
            inFlight: false,
            expiresAt: Date.now() + ttlSeconds * 1000,
            scope,
            actorId,
          };
          setLocalProcessCache(memKey, completedRecord);

          completionPromise = (async () => {
            // 1. Cache in Redis
            if (redis.status === "ready") {
              await redis
                .set(redisKey, JSON.stringify(completedRecord), "EX", ttlSeconds)
                .catch(() => null);
            }

            // 2. Persist in Database
            await prisma.idempotencyKey
              .updateMany({
                where: {
                  tenantId,
                  scope,
                  actorId,
                  key: idempotencyKey,
                  responseStatus: null,
                },
                data: {
                  responseStatus: res.statusCode,
                  responseBody: body,
                  expiresAt: new Date(Date.now() + ttlSeconds * 1000),
                },
              })
              .catch((err) => {
                console.error("[Idempotency] Failed to persist completed DB record:", err);
              });
          })();
        } else if (
          res.statusCode >= 400 &&
          res.statusCode < 500 &&
          res.statusCode !== 429 &&
          res.statusCode !== 401 &&
          res.statusCode !== 403 &&
          clientErrorTtl > 0
        ) {
          // --------------------------------------------------------------------
          // POLICY 2: Deterministic Client Error (400, 422) -> Short TTL Cache
          // --------------------------------------------------------------------
          const clientErrRecord: IdempotencyRecord = {
            status: res.statusCode,
            body,
            payloadHash: currentPayloadHash,
            inFlight: false,
            expiresAt: Date.now() + clientErrorTtl * 1000,
            scope,
            actorId,
          };
          setLocalProcessCache(memKey, clientErrRecord);

          completionPromise = (async () => {
            if (redis.status === "ready") {
              await redis
                .set(redisKey, JSON.stringify(clientErrRecord), "EX", clientErrorTtl)
                .catch(() => null);
            }

            await prisma.idempotencyKey
              .updateMany({
                where: {
                  tenantId,
                  scope,
                  actorId,
                  key: idempotencyKey,
                  responseStatus: null,
                },
                data: {
                  responseStatus: res.statusCode,
                  responseBody: body,
                  expiresAt: new Date(Date.now() + clientErrorTtl * 1000),
                },
              })
              .catch(() => null);
          })();
        } else {
          // --------------------------------------------------------------------
          // POLICY 3: 5xx Server Errors & Transient Failures -> NEVER CACHE!
          // Release lock immediately with token verification so client can retry.
          // --------------------------------------------------------------------
          localProcessCache.delete(memKey);
          completionPromise = releaseIdempotencyLock(
            redisKey,
            lockOwnerToken,
            tenantId,
            scope,
            actorId,
            idempotencyKey
          );
        }

        (res as any).__idempotencyPromise = completionPromise;
        return originalJson(body);
      };

      next();
    } catch (unexpectedError) {
      // Fail closed on unhandled exception
      localProcessCache.delete(memKey);
      releaseIdempotencyLock(
        redisKey,
        lockOwnerToken,
        tenantId,
        scope,
        actorId,
        idempotencyKey
      ).catch(() => null);

      next(unexpectedError);
    }
  };
};

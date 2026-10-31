import { describe, it, expect, vi } from "vitest";
import { Request, Response } from "express";
import crypto from "crypto";
import {
  enforceIdempotency,
  hashIdempotencyPayload,
  canonicalJsonStringify,
  releaseIdempotencyLock,
  MAX_IDEMPOTENCY_KEY_LENGTH,
} from "../../src/middleware/idempotency";
import { redis } from "../../src/redis/redis";
import { prisma } from "../../src/config/prisma";

describe("Enterprise Idempotency Concurrency, Chaos & Failure Suite", () => {
  const testTenantId = "tenant_chaos_test";
  const defaultActorId = "user_chaos_01";

  const createReqRes = (
    key?: string,
    body: any = {},
    headers: Record<string, string> = {},
    tenantId = testTenantId,
    userId = defaultActorId
  ) => {
    const reqHeaders: Record<string, string> = {
      ...headers,
      "x-tenant-id": tenantId,
    };
    if (key !== undefined) {
      reqHeaders["idempotency-key"] = key;
    }

    const req = {
      headers: reqHeaders,
      user: {
        id: userId,
        tenantId,
        role: "USER",
      },
      tenantId,
      body,
      params: {},
      query: {},
    } as unknown as Request;

    let statusCode = 200;
    let jsonBody: any = null;
    const resHeaders: Record<string, string> = {};

    const res = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      setHeader(name: string, value: string) {
        resHeaders[name.toLowerCase()] = value;
        return res;
      },
      getHeader(name: string) {
        return resHeaders[name.toLowerCase()];
      },
      json(data: any) {
        jsonBody = data;
        return res;
      },
      on: vi.fn(),
      get statusCode() {
        return statusCode;
      },
    } as unknown as Response;

    return {
      req,
      res,
      getStatus: () => statusCode,
      getBody: () => jsonBody,
      getHeaders: () => resHeaders,
    };
  };

  // ============================================================================
  // 1. DETERMINISTIC CANONICAL JSON HASHING
  // ============================================================================
  describe("1. Deterministic Canonical JSON Hashing", () => {
    it("should produce the identical hash for objects with different key insertion orders", () => {
      const objA = { z: 100, a: "hello", m: { b: true, a: [1, 2, 3] } };
      const objB = { a: "hello", m: { a: [1, 2, 3], b: true }, z: 100 };

      const hashA = hashIdempotencyPayload(objA);
      const hashB = hashIdempotencyPayload(objB);

      expect(canonicalJsonStringify(objA)).toBe(canonicalJsonStringify(objB));
      expect(hashA).toBe(hashB);
    });

    it("should handle null, primitives, and nested arrays consistently", () => {
      expect(hashIdempotencyPayload(null)).toBe(hashIdempotencyPayload(null));
      expect(hashIdempotencyPayload("")).toBe(hashIdempotencyPayload(""));
      expect(hashIdempotencyPayload([1, 2, 3])).toBe(hashIdempotencyPayload([1, 2, 3]));
    });
  });

  // ============================================================================
  // 2. INPUT VALIDATION & MAX KEY LENGTH ENFORCEMENT
  // ============================================================================
  describe("2. Key Validation & RFC Standard Constraints", () => {
    it("should reject idempotency keys exceeding 128 characters with 400 Bad Request", async () => {
      const longKey = "k".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1);
      const { req, res, getStatus, getBody } = createReqRes(longKey, { amount: 50 });

      const middleware = enforceIdempotency();
      let nextCalled = false;
      await middleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(getStatus()).toBe(400);
      expect(getBody().code).toBe("IDEMPOTENCY_KEY_TOO_LONG");
    });

    it("should allow idempotency keys up to exactly 128 characters", async () => {
      const validKey = "k".repeat(MAX_IDEMPOTENCY_KEY_LENGTH);
      const { req, res, getStatus } = createReqRes(validKey, { amount: 50 });

      const middleware = enforceIdempotency();
      await middleware(req, res, () => {
        res.status(200).json({ processed: true });
      });

      expect(getStatus()).toBe(200);
    });

    it("should bypass middleware transparently if no Idempotency-Key header is present", async () => {
      const { req, res, getStatus } = createReqRes(undefined, { amount: 50 });

      const middleware = enforceIdempotency();
      let nextCalled = false;
      await middleware(req, res, () => {
        nextCalled = true;
        res.status(200).json({ processed: true });
      });

      expect(nextCalled).toBe(true);
      expect(getStatus()).toBe(200);
    });
  });

  // ============================================================================
  // 3. CONCURRENCY & IN-FLIGHT LOCKING (409 CONFLICT)
  // ============================================================================
  describe("3. Concurrency & In-Flight Lock Lease", () => {
    it("should reject concurrent duplicate requests racing for the same key with 409 IDEMPOTENCY_IN_FLIGHT", async () => {
      const key = `race_key_${Date.now()}_${Math.random()}`;
      const payload = { branchId: "b1", customerId: "c1" };
      const middleware = enforceIdempotency({ lockTtlMs: 10000 });

      // Request 1 arrives and begins slow processing
      const r1 = createReqRes(key, payload);
      let finishR1: () => Promise<void> = async () => {};
      await middleware(r1.req, r1.res, () => {
        finishR1 = async () => {
          r1.res.status(201).json({ id: "bk_999", status: "CONFIRMED" });
          await (r1.res as any).__idempotencyPromise;
        };
      });

      // Request 2 arrives concurrently while Request 1 is in-flight
      const r2 = createReqRes(key, payload);
      let r2Executed = false;
      await middleware(r2.req, r2.res, () => {
        r2Executed = true;
      });

      expect(r2Executed).toBe(false);
      expect(r2.getStatus()).toBe(409);
      expect(r2.getBody().code).toBe("IDEMPOTENCY_IN_FLIGHT");

      // Request 1 completes successfully
      await finishR1();

      // Request 3 arrives after completion -> gets cached response
      const r3 = createReqRes(key, payload);
      let r3Executed = false;
      await middleware(r3.req, r3.res, () => {
        r3Executed = true;
      });

      expect(r3Executed).toBe(false);
      expect(r3.getStatus()).toBe(201);
      expect(r3.getBody().id).toBe("bk_999");
      expect(r3.getHeaders()["x-cache-lookup"]).toBe("HIT-IDEMPOTENT");
    });
  });

  // ============================================================================
  // 4. PAYLOAD MISMATCH DETECTION (422 UNPROCESSABLE ENTITY)
  // ============================================================================
  describe("4. Payload Integrity Verification", () => {
    it("should return 422 if an idempotency key is reused with a altered payload", async () => {
      const key = `mismatch_key_${Date.now()}`;
      const middleware = enforceIdempotency();

      // First call with amount: 100
      const r1 = createReqRes(key, { amount: 100 });
      await middleware(r1.req, r1.res, () => {
        r1.res.status(200).json({ chargeId: "ch_01" });
      });
      await (r1.res as any).__idempotencyPromise;

      // Second call with altered amount: 200
      const r2 = createReqRes(key, { amount: 200 });
      let r2Ran = false;
      await middleware(r2.req, r2.res, () => {
        r2Ran = true;
      });

      expect(r2Ran).toBe(false);
      expect(r2.getStatus()).toBe(422);
      expect(r2.getBody().code).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
    });
  });

  // ============================================================================
  // 5. ACTOR & SCOPE ISOLATION
  // ============================================================================
  describe("5. Actor and Scope Isolation Guarantees", () => {
    it("should isolate identical keys between different actors within the same tenant", async () => {
      const sharedKey = `shared_key_${Date.now()}`;
      const middleware = enforceIdempotency();

      // Actor 1 (User A) creates booking
      const r1 = createReqRes(sharedKey, { item: "A" }, {}, testTenantId, "user_A");
      await middleware(r1.req, r1.res, () => {
        r1.res.status(200).json({ owner: "user_A" });
      });
      await (r1.res as any).__idempotencyPromise;
      expect(r1.getStatus()).toBe(200);

      // Actor 2 (User B) submits same key -> Does NOT collide with User A
      const r2 = createReqRes(sharedKey, { item: "B" }, {}, testTenantId, "user_B");
      let r2Executed = false;
      await middleware(r2.req, r2.res, () => {
        r2Executed = true;
        r2.res.status(200).json({ owner: "user_B" });
      });
      await (r2.res as any).__idempotencyPromise;

      expect(r2Executed).toBe(true);
      expect(r2.getStatus()).toBe(200);
      expect(r2.getBody().owner).toBe("user_B");
    });

    it("should isolate identical keys across different logical scopes", async () => {
      const key = `scope_key_${Date.now()}`;
      const bookingMiddleware = enforceIdempotency({ scope: "BOOKING_CREATE" });
      const paymentMiddleware = enforceIdempotency({ scope: "PAYMENT_CHARGE" });

      // Scope 1: Booking
      const r1 = createReqRes(key, { item: "booking" });
      await bookingMiddleware(r1.req, r1.res, () => {
        r1.res.status(201).json({ entity: "booking" });
      });
      await (r1.res as any).__idempotencyPromise;
      expect(r1.getStatus()).toBe(201);

      // Scope 2: Payment with SAME key -> Should not conflict with booking
      const r2 = createReqRes(key, { item: "payment" });
      let r2Executed = false;
      await paymentMiddleware(r2.req, r2.res, () => {
        r2Executed = true;
        r2.res.status(201).json({ entity: "payment" });
      });
      await (r2.res as any).__idempotencyPromise;

      expect(r2Executed).toBe(true);
      expect(r2.getStatus()).toBe(201);
      expect(r2.getBody().entity).toBe("payment");
    });
  });

  // ============================================================================
  // 6. FAILURE CACHING POLICY: NEVER CACHE 5XX
  // ============================================================================
  describe("6. Failure Policy & Transient 5xx Handling", () => {
    it("should NOT cache 500 errors and immediately release lock for retries", async () => {
      const key = `err_500_key_${Date.now()}`;
      const payload = { action: "unstable_op" };
      const middleware = enforceIdempotency();

      // First attempt fails with 500
      const r1 = createReqRes(key, payload);
      await middleware(r1.req, r1.res, () => {
        r1.res.status(500).json({ error: "Database timeout" });
      });
      await (r1.res as any).__idempotencyPromise;

      expect(r1.getStatus()).toBe(500);

      // Immediate retry with the same key should NOT be blocked by an in-flight lock or get cached 500
      const r2 = createReqRes(key, payload);
      let r2Executed = false;
      await middleware(r2.req, r2.res, () => {
        r2Executed = true;
        r2.res.status(200).json({ recovered: true });
      });
      await (r2.res as any).__idempotencyPromise;

      expect(r2Executed).toBe(true);
      expect(r2.getStatus()).toBe(200);
      expect(r2.getBody().recovered).toBe(true);
    });
  });

  // ============================================================================
  // 7. LOCK OWNERSHIP TOKEN SECURITY
  // ============================================================================
  describe("7. Lock Ownership Token Protection", () => {
    it("should prevent a foreign or expired token from deleting another request's active lock", async () => {
      const lockKey = `lock_sec_${Date.now()}`;
      const validOwnerToken = crypto.randomUUID();
      const foreignToken = crypto.randomUUID();

      // Create an active in-progress lock in DB
      await prisma.idempotencyKey.create({
        data: {
          tenantId: testTenantId,
          scope: "DEFAULT",
          actorId: defaultActorId,
          key: lockKey,
          requestHash: "hash123",
          responseStatus: null,
          responseBody: {
            inFlight: true,
            lockOwnerToken: validOwnerToken,
            lockedUntil: Date.now() + 30000,
          },
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Attempt release with unauthorized foreign token
      await releaseIdempotencyLock(
        `tenant:${testTenantId}:idempotency:DEFAULT:${defaultActorId}:${lockKey}`,
        foreignToken,
        testTenantId,
        "DEFAULT",
        defaultActorId,
        lockKey
      );

      // Lock should STILL be intact in DB
      const remaining = await prisma.idempotencyKey.findFirst({
        where: { tenantId: testTenantId, key: lockKey },
      });
      expect(remaining).not.toBeNull();
      expect((remaining?.responseBody as any)?.lockOwnerToken).toBe(validOwnerToken);

      // Release with correct token
      await releaseIdempotencyLock(
        `tenant:${testTenantId}:idempotency:DEFAULT:${defaultActorId}:${lockKey}`,
        validOwnerToken,
        testTenantId,
        "DEFAULT",
        defaultActorId,
        lockKey
      );
      const after = await prisma.idempotencyKey.findFirst({
        where: { tenantId: testTenantId, key: lockKey, responseStatus: null },
      });
      expect(after).toBeNull();
    });
  });

  // ============================================================================
  // 8. DATABASE-BACKED DISTRIBUTED LOCKING CHAOS (REDIS DOWN SIMULATION)
  // ============================================================================
  describe("8. Redis Outage Chaos & DB-Backed Locking Fallback", () => {
    it("should seamlessly maintain distributed locking and replay via MySQL when Redis is offline", async () => {
      // Temporarily mock Redis as unavailable
      const originalStatus = redis.status;
      (redis as any).status = "close";

      try {
        const key = `db_fallback_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const payload = { customerPhone: "+919876543210" };
        const middleware = enforceIdempotency({ scope: "CHAOS_DB_TEST" });

        // Request 1: Runs and persists completed state directly to DB
        const r1 = createReqRes(key, payload);
        await middleware(r1.req, r1.res, () => {
          r1.res.status(201).json({ ticketNo: "T-888" });
        });
        await (r1.res as any).__idempotencyPromise;

        expect(r1.getStatus()).toBe(201);
        expect(r1.getBody().ticketNo).toBe("T-888");

        // Verify record is saved in MySQL Catalog DB
        const savedKey = await prisma.idempotencyKey.findFirst({
          where: {
            tenantId: testTenantId,
            scope: "CHAOS_DB_TEST",
            actorId: defaultActorId,
            key,
          },
        });

        expect(savedKey).not.toBeNull();
        expect(savedKey?.responseStatus).toBe(201);

        // Request 2: Replays from DB directly without Redis
        const r2 = createReqRes(key, payload);
        let r2Ran = false;
        await middleware(r2.req, r2.res, () => {
          r2Ran = true;
        });

        expect(r2Ran).toBe(false);
        expect(r2.getStatus()).toBe(201);
        expect(r2.getBody().ticketNo).toBe("T-888");
        expect(r2.getHeaders()["x-cache-lookup"]).toBe("HIT-IDEMPOTENT");
      } finally {
        (redis as any).status = originalStatus;
      }
    });
  });
});

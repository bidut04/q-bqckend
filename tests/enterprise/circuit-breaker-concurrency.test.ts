import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createShardCircuitBreaker,
  executeWithRetry,
  disconnectAllShards,
} from "../../src/lib/sharding/shard.manager";
import { ShardUnavailableError, ShardReadOnlyError } from "../../src/core/errors/security.errors";
import { enforceIdempotency, hashIdempotencyPayload } from "../../src/middleware/idempotency";

import { runTenantTransaction } from "../../src/lib/sharding/tenant-db";
import { TenantContext } from "../../src/core/tenant/tenant-context";
import { Request, Response } from "express";

describe("Circuit Breaker Concurrency, Deadline & Idempotency Hardening Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Circuit Breaker Concurrency & HALF_OPEN Probe Limit (P0)", () => {
    it("should allow only maxHalfOpenProbes (2) into HALF_OPEN state and reject excess concurrent requests", () => {
      const breaker = createShardCircuitBreaker("shard_concurrency_test", 3, 1000, 2, 2);

      // Trip to OPEN
      breaker.recordFailure("DB Error 1");
      breaker.recordFailure("DB Error 2");
      breaker.recordFailure("DB Error 3");
      expect(breaker.state).toBe("OPEN");

      // Advance time beyond reset timeout
      breaker.lastStateChangeTime = Date.now() - 2000;

      // First request advances to HALF_OPEN and claims Probe 1
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.state).toBe("HALF_OPEN");
      expect(breaker.inFlightProbes).toBe(1);

      // Second concurrent request claims Probe 2
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.inFlightProbes).toBe(2);

      // 3rd to 100th concurrent requests MUST be rejected (probe limit reached)
      let rejectedCount = 0;
      for (let i = 0; i < 98; i++) {
        try {
          breaker.canExecute();
        } catch (error) {
          expect(error).toBeInstanceOf(ShardUnavailableError);
          expect((error as Error).message).toContain("Canary probe limit reached");
          rejectedCount += 1;
        }
      }

      expect(rejectedCount).toBe(98);
      expect(breaker.inFlightProbes).toBe(2);

      // Probe 1 succeeds
      breaker.recordSuccess();
      expect(breaker.inFlightProbes).toBe(1);
      expect(breaker.state).toBe("HALF_OPEN");

      // Probe 2 succeeds -> reaches threshold (2) -> recovers to CLOSED!
      breaker.recordSuccess();
      expect(breaker.inFlightProbes).toBe(0);
      expect(breaker.state).toBe("CLOSED");

      // Traffic flows freely again
      expect(breaker.canExecute()).toBe(true);
    });

    it("should immediately trip back to OPEN if a canary probe fails during HALF_OPEN", () => {
      const breaker = createShardCircuitBreaker("shard_probe_fail_test", 2, 1000, 2, 2);

      breaker.recordFailure("Err 1");
      breaker.recordFailure("Err 2");
      expect(breaker.state).toBe("OPEN");

      breaker.lastStateChangeTime = Date.now() - 2000;

      // Claim probe 1
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.state).toBe("HALF_OPEN");

      // Probe 1 fails -> instantly back to OPEN
      breaker.recordFailure("Canary query failed: connection reset");
      expect(breaker.state).toBe("OPEN");
      expect(breaker.inFlightProbes).toBe(0);

      // Next request must fast-fail because breaker is back in OPEN
      expect(() => breaker.canExecute()).toThrow(ShardUnavailableError);
    });
  });

  describe("2. Bounded Retries & Operation Deadline (P0)", () => {
    it("should abort retry loop and throw when overall operation deadline is exceeded", async () => {
      let attempts = 0;
      const slowTransientOp = async () => {
        attempts += 1;
        await new Promise((r) => setTimeout(r, 40));
        const err = new Error("Connection pool exhausted (pool_timeout)");
        (err as any).code = "P1001";
        throw err;
      };

      // Set maxDeadlineMs to 50ms with maxAttempts = 5
      await expect(
        executeWithRetry("shard_test_deadline", slowTransientOp, 5, 20, 50)
      ).rejects.toThrow(ShardUnavailableError);

      // Should stop well before attempt 5 because of deadline
      expect(attempts).toBeLessThan(5);
    });
  });

  describe("3. Idempotency Payload Hash & In-Flight Lock (P0)", () => {
    const createReqRes = (key: string, body: any) => {
      const headers: Record<string, string> = { "idempotency-key": key };
      const req = {
        headers,
        body,
      } as unknown as Request;

      const resHeaders: Record<string, any> = {};
      let statusCode = 200;
      let jsonBody: any = null;

      const res = {
        statusCode: 200,
        setHeader: (name: string, value: any) => {
          resHeaders[name.toLowerCase()] = value;
        },
        status: (code: number) => {
          statusCode = code;
          res.statusCode = code;
          return res;
        },
        json: (data: any) => {
          jsonBody = data;
          return res;
        },
      } as unknown as Response;

      return { req, res, getHeaders: () => resHeaders, getStatus: () => statusCode, getBody: () => jsonBody };
    };

    it("should return cached response when key and payload match", async () => {
      const idempotency = enforceIdempotency(60);
      const key = `test_idem_${Date.now()}_1`;
      const payload = { branchId: "b1", serviceId: "s1" };

      // Request 1: Executes successfully
      const r1 = createReqRes(key, payload);
      await idempotency(r1.req, r1.res, () => {
        r1.res.status(201).json({ tokenNumber: 101, status: "WAITING" });
      });

      expect(r1.getStatus()).toBe(201);
      expect(r1.getBody().tokenNumber).toBe(101);

      // Request 2: Replays cached result with X-Cache-Lookup: HIT-IDEMPOTENT
      const r2 = createReqRes(key, payload);
      let r2Executed = false;
      await idempotency(r2.req, r2.res, () => {
        r2Executed = true;
      });

      expect(r2Executed).toBe(false); // Handler was skipped
      expect(r2.getStatus()).toBe(201);
      expect(r2.getBody().tokenNumber).toBe(101);
      expect(r2.getHeaders()["x-cache-lookup"]).toBe("HIT-IDEMPOTENT");
    });

    it("should reject with 422 if same key is used with different request payload", async () => {
      const idempotency = enforceIdempotency(60);
      const key = `test_idem_${Date.now()}_2`;

      // Request 1: book doctor A
      const r1 = createReqRes(key, { doctorId: "doc_A" });
      await idempotency(r1.req, r1.res, () => {
        r1.res.status(200).json({ bookingId: "bk_001" });
      });

      // Request 2: same key, but different payload doctor B
      const r2 = createReqRes(key, { doctorId: "doc_B" });
      let r2Executed = false;
      await idempotency(r2.req, r2.res, () => {
        r2Executed = true;
      });

      expect(r2Executed).toBe(false);
      expect(r2.getStatus()).toBe(422);
      expect(r2.getBody().code).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");
    });

    it("should reject with 409 if another request with same key is currently in-flight", async () => {
      const idempotency = enforceIdempotency(60);
      const key = `test_idem_${Date.now()}_3`;

      // Request 1: starts processing (does not call res.json yet)
      const r1 = createReqRes(key, { amount: 100 });
      let finishR1: () => void = () => {};
      await idempotency(r1.req, r1.res, () => {
        finishR1 = () => r1.res.status(200).json({ status: "OK" });
      });

      // Request 2 arrives while Request 1 is still in-flight
      const r2 = createReqRes(key, { amount: 100 });
      let r2Executed = false;
      await idempotency(r2.req, r2.res, () => {
        r2Executed = true;
      });

      expect(r2Executed).toBe(false);
      expect(r2.getStatus()).toBe(409);
      expect(r2.getBody().code).toBe("IDEMPOTENCY_IN_FLIGHT");

      // Finish Request 1
      finishR1();
    });
  });

  describe("4. Connection Draining & Disconnect All Shards", () => {
    it("should safely disconnect all shards using Promise.allSettled without throwing", async () => {
      await expect(disconnectAllShards()).resolves.toBeUndefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateTraceId,
  generateSpanId,
  formatTraceparent,
  parseTraceparent,
  runWithTraceContext,
  getActiveTraceContext,
  withSpan,
  injectTraceHeaders,
} from "../../src/lib/tracing/tracer";
import { createKafkaEnvelope } from "../../src/lib/kafka/kafka.envelope";
import { createRealtimeEnvelope } from "../../src/lib/socket/socket.emitter";
import { RealtimeEventType } from "../../src/lib/socket/socket.types";
import { createSlidingRateLimiter } from "../../src/middleware/sliding-rate-limiter";
import { Request, Response } from "express";

describe("Distributed Tracing (OpenTelemetry) & Redis Sliding-Window Rate Limiter Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. OpenTelemetry W3C Distributed Tracing", () => {
    it("should generate standard 32-character hex trace ID and 16-character hex span ID", () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();

      expect(typeof traceId).toBe("string");
      expect(traceId.length).toBe(32);
      expect(/^[0-9a-f]{32}$/.test(traceId)).toBe(true);

      expect(typeof spanId).toBe("string");
      expect(spanId.length).toBe(16);
      expect(/^[0-9a-f]{16}$/.test(spanId)).toBe(true);
    });

    it("should format and parse W3C traceparent headers correctly", () => {
      const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      const spanId = "00f067aa0ba902b7";

      const header = formatTraceparent(traceId, spanId, true);
      expect(header).toBe(`00-${traceId}-${spanId}-01`);

      const parsed = parseTraceparent(header);
      expect(parsed).not.toBeNull();
      expect(parsed?.traceId).toBe(traceId);
      expect(parsed?.parentSpanId).toBe(spanId);
      expect(parsed?.traceFlags).toBe("01");

      // Invalid header should return null
      expect(parseTraceparent("invalid-header")).toBeNull();
      expect(parseTraceparent(null)).toBeNull();
    });

    it("should bind active TraceContext in AsyncLocalStorage and inject into outgoing headers", async () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();

      await runWithTraceContext(
        {
          traceId,
          spanId,
          traceFlags: "01",
          startTime: Date.now(),
        },
        async () => {
          const active = getActiveTraceContext();
          expect(active).toBeDefined();
          expect(active?.traceId).toBe(traceId);
          expect(active?.spanId).toBe(spanId);

          const headers = injectTraceHeaders({});
          expect(headers["traceparent"]).toBe(`00-${traceId}-${spanId}-01`);
          expect(headers["x-trace-id"]).toBe(traceId);
        }
      );

      // Outside context, active should be undefined
      expect(getActiveTraceContext()).toBeUndefined();
    });

    it("should automatically propagate active traceId from HTTP context into Kafka/Outbox envelopes", async () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();

      await runWithTraceContext(
        {
          traceId,
          spanId,
          traceFlags: "01",
          startTime: Date.now(),
        },
        () => {
          const envelope = createKafkaEnvelope(
            "tenant_bank_kolkata",
            "queue.entry.called",
            "QueueEntry",
            "qe_9988",
            { tokenNumber: 42, branchId: "branch_park_street" }
          );

          expect(envelope.traceId).toBe(traceId);
          expect(envelope.spanId).toBe(spanId);
          expect(envelope.traceparent).toBe(`00-${traceId}-${spanId}-01`);
          expect(envelope.tenantId).toBe("tenant_bank_kolkata");
        }
      );
    });

    it("should automatically propagate active traceId into Socket.IO Realtime envelopes", async () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();

      await runWithTraceContext(
        {
          traceId,
          spanId,
          traceFlags: "01",
          startTime: Date.now(),
        },
        () => {
          const rtEnvelope = createRealtimeEnvelope(
            "tenant_bank_kolkata",
            RealtimeEventType.DISPLAY_CALL,
            { tokenNumber: 42, tokenLabel: "A042", counterId: "Counter 1", calledAt: new Date().toISOString() },
            "branch_park_street"
          );

          expect(rtEnvelope.traceId).toBe(traceId);
          expect(rtEnvelope.spanId).toBe(spanId);
          expect(rtEnvelope.eventType).toBe(RealtimeEventType.DISPLAY_CALL);
          expect(rtEnvelope.tenantId).toBe("tenant_bank_kolkata");
        }
      );
    });

    it("should measure duration and record status in withSpan", async () => {
      const result = await withSpan("db.query.find_entry", async (span) => {
        expect(span.name).toBe("db.query.find_entry");
        await new Promise((r) => setTimeout(r, 20));
        return { id: "qe_123", status: "WAITING" };
      });

      expect(result.id).toBe("qe_123");
    });
  });

  describe("2. Redis Sliding-Window Rate Limiter & Bot Protection", () => {
    const createMockReqRes = (ip = "192.168.1.50", headers: Record<string, string> = {}) => {
      const req = {
        ip,
        header: (name: string) => headers[name.toLowerCase()] || headers[name] || undefined,
      } as unknown as Request;

      const resHeaders: Record<string, any> = {};
      let statusCode = 200;
      let jsonBody: any = null;

      const res = {
        setHeader: (name: string, value: any) => {
          resHeaders[name.toLowerCase()] = value;
        },
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (body: any) => {
          jsonBody = body;
          return res;
        },
      } as unknown as Response;

      return { req, res, getHeaders: () => resHeaders, getStatusCode: () => statusCode, getJsonBody: () => jsonBody };
    };

    it("should allow requests under the limit and set rate limit headers", async () => {
      const limiter = createSlidingRateLimiter({
        windowMs: 60000,
        limit: 5,
        keyPrefix: "test:ratelimit:allow",
      });

      const next = vi.fn();
      const { req, res, getHeaders, getStatusCode } = createMockReqRes("10.0.0.1");

      await limiter(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(getStatusCode()).toBe(200);
      expect(getHeaders()["x-ratelimit-limit"]).toBe(5);
      expect(getHeaders()["x-ratelimit-remaining"]).toBe(4);
      expect(getHeaders()["x-ratelimit-reset"]).toBeDefined();
    });

    it("should reject requests exceeding limit with 429 and Retry-After header", async () => {
      const limit = 3;
      const limiter = createSlidingRateLimiter({
        windowMs: 60000,
        limit,
        keyPrefix: "test:ratelimit:block",
      });

      const next = vi.fn();

      // Send 3 requests (allowed)
      for (let i = 0; i < limit; i++) {
        const { req, res } = createMockReqRes("10.0.0.2");
        await limiter(req, res, next);
      }
      expect(next).toHaveBeenCalledTimes(3);

      // 4th request must be rejected with 429
      const fourth = createMockReqRes("10.0.0.2");
      await limiter(fourth.req, fourth.res, next);

      expect(next).toHaveBeenCalledTimes(3); // Not called for 4th
      expect(fourth.getStatusCode()).toBe(429);
      expect(fourth.getJsonBody().code).toBe("RATE_LIMIT_EXCEEDED");
      expect(fourth.getHeaders()["retry-after"]).toBeDefined();
      expect(fourth.getHeaders()["x-ratelimit-remaining"]).toBe(0);
    });

    it("should segregate rate limits by API Key (X-API-Key)", async () => {
      const limit = 2;
      const limiter = createSlidingRateLimiter({
        windowMs: 60000,
        limit,
        keyPrefix: "test:ratelimit:apikey",
      });

      const next = vi.fn();

      // Client A exhausts their 2 requests
      for (let i = 0; i < limit; i++) {
        const { req, res } = createMockReqRes("192.168.1.1", { "x-api-key": "partner_key_alpha" });
        await limiter(req, res, next);
      }
      expect(next).toHaveBeenCalledTimes(2);

      // Client A 3rd request blocked
      const clientABlocked = createMockReqRes("192.168.1.1", { "x-api-key": "partner_key_alpha" });
      await limiter(clientABlocked.req, clientABlocked.res, next);
      expect(clientABlocked.getStatusCode()).toBe(429);

      // Client B with distinct API key from same IP is NOT blocked
      const clientB = createMockReqRes("192.168.1.1", { "x-api-key": "partner_key_beta" });
      await limiter(clientB.req, clientB.res, next);
      expect(clientB.getStatusCode()).toBe(200);
      expect(next).toHaveBeenCalledTimes(3);
    });
  });
});

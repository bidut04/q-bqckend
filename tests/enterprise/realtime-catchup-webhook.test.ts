import { describe, it, expect, vi, beforeEach } from "vitest";
import { realtimeCacheService } from "../../src/lib/redis/realtime-cache.service";
import { webhookDispatcher } from "../../src/modules/webhook/webhook.dispatcher";

describe("Realtime Reconnection Catch-Up & Webhook Dispatcher Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Reconnection Catch-Up (Heartbeat Gap)", () => {
    it("should record recent events in ring buffer and return only missed events after sinceTimestamp", async () => {
      const tenantId = "tenant_test_catchup";
      const branchId = "branch_01";

      const t1 = new Date(Date.now() - 30000).toISOString();
      const t2 = new Date(Date.now() - 20000).toISOString();
      const t3 = new Date(Date.now() - 10000).toISOString();

      await realtimeCacheService.recordRecentEvent(tenantId, branchId, {
        eventId: "ev_1",
        tokenLabel: "K001",
        occurredAt: t1,
      });

      await realtimeCacheService.recordRecentEvent(tenantId, branchId, {
        eventId: "ev_2",
        tokenLabel: "K002",
        occurredAt: t2,
      });

      await realtimeCacheService.recordRecentEvent(tenantId, branchId, {
        eventId: "ev_3",
        tokenLabel: "K003",
        occurredAt: t3,
      });

      // Client disconnected right after t1 and reconnects now asking for events after t1
      const missed = await realtimeCacheService.getMissedEvents(tenantId, branchId, t1);

      expect(missed.length).toBe(2);
      expect(missed[0].eventId).toBe("ev_2");
      expect(missed[1].eventId).toBe("ev_3");
      expect(missed[0].tokenLabel).toBe("K002");
      expect(missed[1].tokenLabel).toBe("K003");
    });
  });

  describe("2. Webhook Engine & HMAC Signature", () => {
    it("should compute valid HMAC-SHA256 signature matching standard crypto digest", () => {
      const secret = "whsec_super_secret_token";
      const body = JSON.stringify({ event: "queue.entry.called", token: "A101" });

      const sig1 = webhookDispatcher.generateSignature(body, secret);
      const sig2 = webhookDispatcher.generateSignature(body, secret);

      expect(sig1).toBe(sig2);
      expect(typeof sig1).toBe("string");
      expect(sig1.length).toBe(64); // 256-bit hex string is 64 chars
    });

    it("should register config and dispatch webhook with signature headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      global.fetch = mockFetch;

      const tenantId = "tenant_partner_bank";
      webhookDispatcher.registerConfig(tenantId, {
        url: "https://api.partnerbank.com/hooks/queue",
        secret: "whsec_partner_key",
        events: ["queue.entry.called"],
        enabled: true,
      });

      await webhookDispatcher.dispatch(tenantId, "queue.entry.called", {
        tokenLabel: "P005",
        counterId: "Counter 2",
      });

      // Wait a tick for setImmediate
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe("https://api.partnerbank.com/hooks/queue");
      expect(calledInit.method).toBe("POST");
      expect(calledInit.headers["X-QueueFlow-Event"]).toBe("queue.entry.called");
      expect(calledInit.headers["X-QueueFlow-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    });
  });
});

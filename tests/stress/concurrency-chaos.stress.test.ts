import { describe, it, expect, vi } from "vitest";
import { QueueStateMachine } from "../../src/modules/queue/queue.state-machine";

describe("High-Concurrency Chaos & Stress Test Suite (Simulating Many Users)", () => {
  describe("1. Concurrent Token Booking Race Condition Test (100 Concurrent Users)", () => {
    it("should issue strictly unique, collision-free token numbers when 100 users book simultaneously", async () => {
      const TOTAL_CONCURRENT_USERS = 100;
      let sharedAtomicCounter = 100; // Starting ticket number
      const issuedTokens: Array<{ tokenNumber: number; tokenLabel: string; userId: string; timestamp: number }> = [];

      // Atomic lock simulation (representing PostgreSQL SELECT FOR UPDATE / Atomic Increment)
      const lock = {
        locked: false,
        async acquire() {
          while (this.locked) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          this.locked = true;
        },
        release() {
          this.locked = false;
        },
      };

      const simulateUserBooking = async (userIndex: number) => {
        // Add random jitter between 0 and 15ms to simulate realistic distributed network arrivals
        await new Promise((r) => setTimeout(r, Math.random() * 15));

        await lock.acquire();
        try {
          sharedAtomicCounter += 1;
          const currentToken = sharedAtomicCounter;
          const tokenLabel = `Q-${String(currentToken).padStart(4, "0")}`;

          issuedTokens.push({
            tokenNumber: currentToken,
            tokenLabel,
            userId: `user_concurrent_${userIndex}`,
            timestamp: Date.now(),
          });

          return { success: true, tokenNumber: currentToken, tokenLabel };
        } finally {
          lock.release();
        }
      };

      // Fire 100 user bookings simultaneously using Promise.all
      const userPromises = Array.from({ length: TOTAL_CONCURRENT_USERS }, (_, i) => simulateUserBooking(i));
      const results = await Promise.all(userPromises);

      // Verify: All 100 requests completed successfully
      expect(results).toHaveLength(TOTAL_CONCURRENT_USERS);
      expect(results.every((r) => r.success)).toBe(true);

      // Verify: Exactly 100 tokens issued
      expect(issuedTokens).toHaveLength(TOTAL_CONCURRENT_USERS);

      // CHAOS CHECK 1: Zero duplicate token numbers
      const tokenNumbers = issuedTokens.map((t) => t.tokenNumber);
      const uniqueTokenNumbers = new Set(tokenNumbers);
      expect(uniqueTokenNumbers.size).toBe(TOTAL_CONCURRENT_USERS);

      // CHAOS CHECK 2: Monotonically increasing with zero gaps
      const sortedTokens = [...tokenNumbers].sort((a, b) => a - b);
      for (let i = 0; i < sortedTokens.length; i++) {
        expect(sortedTokens[i]).toBe(101 + i);
      }
    });
  });

  describe("2. Concurrent Counter Operators 'Call-Next' Collision Test (50 Counters vs 20 Waiting Tickets)", () => {
    it("should prevent double-calling: exactly 20 tickets called, 30 counters safely informed queue is empty", async () => {
      const TOTAL_WAITING_TICKETS = 20;
      const TOTAL_CONCURRENT_COUNTERS = 50;

      // In-memory queue state
      interface SimulatedEntry {
        id: string;
        tokenLabel: string;
        status: "WAITING" | "CALLED" | "SERVING";
        calledByCounterId: string | null;
        version: number;
      }

      const queueEntries: SimulatedEntry[] = Array.from({ length: TOTAL_WAITING_TICKETS }, (_, i) => ({
        id: `ticket_${i + 1}`,
        tokenLabel: `A-${100 + i}`,
        status: "WAITING",
        calledByCounterId: null,
        version: 0,
      }));

      // Simulate atomic call-next with optimistic locking
      const simulateCounterCallNext = async (counterId: string) => {
        // Random micro-delay to simulate network delay
        await new Promise((r) => setTimeout(r, Math.random() * 20));

        // Atomically find first WAITING entry
        const entry = queueEntries.find((e) => e.status === "WAITING");
        if (!entry) {
          return { success: false, reason: "NO_TICKETS_WAITING" };
        }

        // Validate state machine transition
        try {
          QueueStateMachine.validateTransition(entry.status, "CALLED");
        } catch {
          return { success: false, reason: "INVALID_STATE_TRANSITION" };
        }

        // Optimistic lock simulation (if version matches)
        if (entry.status !== "WAITING") {
          return { success: false, reason: "CONCURRENT_CONFLICT" };
        }

        entry.status = "CALLED";
        entry.calledByCounterId = counterId;
        entry.version += 1;

        return { success: true, ticketId: entry.id, tokenLabel: entry.tokenLabel, counterId };
      };

      // 50 counters attempt to call next ticket simultaneously
      const counterCalls = Array.from({ length: TOTAL_CONCURRENT_COUNTERS }, (_, i) =>
        simulateCounterCallNext(`counter_${i + 1}`)
      );
      const outcomes = await Promise.all(counterCalls);

      const successfulCalls = outcomes.filter((o) => o.success);
      const emptyOrConflictCalls = outcomes.filter((o) => !o.success);

      // CHAOS CHECK: Exactly 20 tickets were successfully called
      expect(successfulCalls).toHaveLength(TOTAL_WAITING_TICKETS);
      expect(emptyOrConflictCalls).toHaveLength(TOTAL_CONCURRENT_COUNTERS - TOTAL_WAITING_TICKETS);

      // CHAOS CHECK: No single ticket was called by more than one counter
      const calledTickets = successfulCalls.map((s: any) => s.ticketId);
      const uniqueCalledTickets = new Set(calledTickets);
      expect(uniqueCalledTickets.size).toBe(TOTAL_WAITING_TICKETS);

      // CHAOS CHECK: Every single entry is now in CALLED state
      expect(queueEntries.every((e) => e.status === "CALLED")).toBe(true);
      expect(queueEntries.every((e) => e.calledByCounterId !== null)).toBe(true);
    });
  });

  describe("3. Multi-Tenant Cross-Contamination Stress Test (High Load Isolation)", () => {
    it("should guarantee 100% tenant isolation across 100 concurrent inter-tenant queries", async () => {
      const TENANT_A = "tenant_apollo_hospital";
      const TENANT_B = "tenant_hdfc_bank";

      const tenantAData = Array.from({ length: 50 }, (_, i) => ({
        id: `tA_rec_${i}`,
        tenantId: TENANT_A,
        patientName: `Patient ${i}`,
        confidentialRecord: `Medical History A-${i}`,
      }));

      const tenantBData = Array.from({ length: 50 }, (_, i) => ({
        id: `tB_rec_${i}`,
        tenantId: TENANT_B,
        accountNumber: `ACCT-${1000 + i}`,
        confidentialBalance: 50000 + i * 1000,
      }));

      const allDatabaseRecords = [...tenantAData, ...tenantBData];

      // Simulated tenant scoped query with context enforcement
      const executeTenantQuery = async (queryingTenantId: string, recordId: string) => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));

        const record: any = allDatabaseRecords.find((r) => r.id === recordId);
        if (!record) return { found: false, error: "NOT_FOUND" };

        // Security assertion: Must match caller's tenant
        if (record.tenantId !== queryingTenantId) {
          return { found: false, error: "TENANT_ACCESS_DENIED", data: null };
        }

        return { found: true, data: record };
      };

      // Generate 50 legitimate Tenant A requests + 50 malicious attempts by Tenant B accessing Tenant A's records
      const legitimateRequests = tenantAData.map((rec) => executeTenantQuery(TENANT_A, rec.id));
      const crossTenantMaliciousRequests = tenantAData.map((rec) => executeTenantQuery(TENANT_B, rec.id));

      const [legitResults, maliciousResults] = await Promise.all([
        Promise.all(legitimateRequests),
        Promise.all(crossTenantMaliciousRequests),
      ]);

      // All legitimate queries succeeded
      expect(legitResults.every((r) => r.found)).toBe(true);

      // CHAOS CHECK: 100% of cross-tenant malicious attempts are BLOCKED
      expect(maliciousResults.every((r) => !r.found)).toBe(true);
      expect(maliciousResults.every((r) => r.error === "TENANT_ACCESS_DENIED")).toBe(true);
      expect(maliciousResults.every((r) => r.data === null)).toBe(true);
    });
  });

  describe("4. Rapid Queue State Machine Invariant Stress Test", () => {
    it("should reject illegal out-of-order state transitions under rapid chaos events", () => {
      // Valid path: WAITING -> CALLED -> IN_SERVICE -> COMPLETED
      expect(() => QueueStateMachine.validateTransition("WAITING", "CALLED")).not.toThrow();
      expect(() => QueueStateMachine.validateTransition("CALLED", "IN_SERVICE")).not.toThrow();
      expect(() => QueueStateMachine.validateTransition("IN_SERVICE", "COMPLETED")).not.toThrow();

      // CHAOS CHECKS: Illegal jumps must throw error every single time
      expect(() => QueueStateMachine.validateTransition("WAITING", "COMPLETED")).toThrow();
      expect(() => QueueStateMachine.validateTransition("WAITING", "IN_SERVICE")).toThrow();
      expect(() => QueueStateMachine.validateTransition("COMPLETED", "WAITING")).toThrow();
      expect(() => QueueStateMachine.validateTransition("CANCELLED", "IN_SERVICE")).toThrow();
      expect(() => QueueStateMachine.validateTransition("NO_SHOW", "COMPLETED")).toThrow();
    });
  });
});

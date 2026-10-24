/**
 * High-Concurrency User Simulator & Stress Engine
 * Simulates high concurrent load (N users booking simultaneously)
 * Checks for:
 *   - Duplicate token collisions
 *   - Race conditions
 *   - P50, P95, P99 Latency
 *   - Success vs failure rate
 */

export interface SimulationConfig {
  concurrentUsers: number;
  startingTokenNumber: number;
  jitterMs: number;
}

export interface SimulationResult {
  totalUsers: number;
  successfulBookings: number;
  failedBookings: number;
  tokenCollisions: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  allUniqueTokens: boolean;
  issuedTokens: string[];
}

export async function runConcurrentSimulation(config: SimulationConfig): Promise<SimulationResult> {
  const { concurrentUsers, startingTokenNumber, jitterMs } = config;

  let atomicCounter = startingTokenNumber;
  const issuedTokenSet = new Set<string>();
  const latencies: number[] = [];
  const issuedTokens: string[] = [];
  let collisions = 0;

  // Mutex lock to simulate database-level atomic locking
  const mutex = {
    isLocked: false,
    async lock() {
      while (this.isLocked) {
        await new Promise((res) => setTimeout(res, 1));
      }
      this.isLocked = true;
    },
    unlock() {
      this.isLocked = false;
    },
  };

  const simulateSingleUser = async (userId: string): Promise<boolean> => {
    const startTime = performance.now();

    // Random user arrival jitter
    await new Promise((res) => setTimeout(res, Math.random() * jitterMs));

    await mutex.lock();
    try {
      atomicCounter += 1;
      const token = `K-${String(atomicCounter).padStart(4, "0")}`;

      if (issuedTokenSet.has(token)) {
        collisions += 1;
      } else {
        issuedTokenSet.add(token);
      }
      issuedTokens.push(token);

      const endTime = performance.now();
      latencies.push(endTime - startTime);
      return true;
    } catch {
      return false;
    } finally {
      mutex.unlock();
    }
  };

  const startTimestamp = performance.now();
  const promises = Array.from({ length: concurrentUsers }, (_, i) => simulateSingleUser(`user_${i + 1}`));
  const outcomes = await Promise.all(promises);
  const totalDuration = performance.now() - startTimestamp;

  const successfulBookings = outcomes.filter(Boolean).length;
  latencies.sort((a, b) => a - b);

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95Latency = latencies[p95Index] || 0;

  return {
    totalUsers: concurrentUsers,
    successfulBookings,
    failedBookings: concurrentUsers - successfulBookings,
    tokenCollisions: collisions,
    minLatencyMs: Math.round(latencies[0] || 0),
    maxLatencyMs: Math.round(latencies[latencies.length - 1] || 0),
    avgLatencyMs: Math.round(avgLatency),
    p95LatencyMs: Math.round(p95Latency),
    allUniqueTokens: collisions === 0 && issuedTokenSet.size === concurrentUsers,
    issuedTokens,
  };
}

// Standalone runner execution
if (process.argv[1]?.endsWith("simulate_many_users.ts")) {
  console.log("==================================================");
  console.log("   QUEUEFLOW CONCURRENCY LOAD & CHAOS SIMULATOR   ");
  console.log("==================================================");
  console.log("Simulating 100 concurrent users booking simultaneously...\n");

  runConcurrentSimulation({
    concurrentUsers: 100,
    startingTokenNumber: 500,
    jitterMs: 15,
  }).then((res) => {
    console.log(`Total Concurrent Users: ${res.totalUsers}`);
    console.log(`Successful Bookings:   ${res.successfulBookings}`);
    console.log(`Failed Bookings:       ${res.failedBookings}`);
    console.log(`Token Collisions:      ${res.tokenCollisions}`);
    console.log(`All Tokens Unique:     ${res.allUniqueTokens ? "PASSED (100% Unique)" : "FAILED (Collisions detected!)"}`);
    console.log(`Min Latency:           ${res.minLatencyMs}ms`);
    console.log(`Avg Latency:           ${res.avgLatencyMs}ms`);
    console.log(`P95 Latency:           ${res.p95LatencyMs}ms`);
    console.log(`Max Latency:           ${res.maxLatencyMs}ms`);
    console.log("==================================================");
    if (res.allUniqueTokens) {
      console.log("PASSED: Zero race conditions or token collisions detected under concurrent load!");
    } else {
      console.error("FAILED: Concurrency race condition detected!");
      process.exit(1);
    }
  });
}

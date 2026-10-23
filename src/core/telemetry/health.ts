import { Request, Response } from "express";
import { redis } from "../../redis/redis";
import { shardManager } from "../../lib/sharding/shard.manager";

export const livenessHandler = (_req: Request, res: Response): void => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
};

export const readinessHandler = async (_req: Request, res: Response): Promise<void> => {
  const checks: Record<string, string> = {};
  let isReady = true;

  // 1. Check Redis
  try {
    if (redis.status !== "ready") {
      checks.redis = "DEGRADED (offline)";
    } else {
      const pong = await Promise.race([
        redis.ping(),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 800)),
      ]);
      checks.redis = pong === "PONG" ? "HEALTHY" : "DEGRADED";
    }
  } catch (error) {
    checks.redis = `UNHEALTHY: ${(error as Error).message}`;
    isReady = false;
  }

  // 2. Check Shards
  try {
    const shardHealthList = await shardManager.checkHealth();
    const allHealthy = shardHealthList.length > 0 && shardHealthList.every((s) => s.healthy);
    checks.shards = allHealthy ? "HEALTHY" : "DEGRADED";
    if (!allHealthy) {
      isReady = false;
    }
  } catch (error) {
    checks.shards = `UNHEALTHY: ${(error as Error).message}`;
    isReady = false;
  }

  const statusCode = isReady ? 200 : 503;
  res.status(statusCode).json({
    status: isReady ? "READY" : "NOT_READY",
    timestamp: new Date().toISOString(),
    checks,
  });
};

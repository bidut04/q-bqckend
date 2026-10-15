import Redis from "ioredis";
import { env } from "./env";

export const redisClient = new Redis(
  env.REDIS_URL,
  {
    maxRetriesPerRequest: 3,

    enableReadyCheck: true,

    lazyConnect: false,

    retryStrategy(times) {
      const delay = Math.min(
        times * 100,
        3000
      );

      return delay;
    },
  }
);

redisClient.on("connect", () => {
  console.log("✅ Redis connected");
});

redisClient.on("error", (error) => {
  console.error(
    "❌ Redis error:",
    error
  );
});
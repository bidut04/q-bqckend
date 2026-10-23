import Redis from "ioredis";
import { env } from "./env";

let isLoggedOffline = false;

export const redisClient = new Redis(
  env.REDIS_URL,
  {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) {
        return 5000;
      }
      return Math.min(times * 100, 2000);
    },
  }
);

redisClient.on("connect", () => {
  isLoggedOffline = false;
  console.log("✅ Redis connected");
});

redisClient.on("error", (error) => {
  if (!isLoggedOffline) {
    console.warn("⚠️ Redis offline (port 6379):", error.message);
    isLoggedOffline = true;
  }
});
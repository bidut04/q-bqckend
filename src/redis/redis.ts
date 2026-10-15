import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 3) {
      return 5000;
    }
    return Math.min(times * 100, 2000);
  },
});

let isLoggedOffline = false;
redis.on("error", (error) => {
  if (!isLoggedOffline) {
    console.warn("⚠️ Redis offline (port 6379):", error.message);
    isLoggedOffline = true;
  }
});

redis.on("connect", () => {
  isLoggedOffline = false;
  console.log("✅ Redis connected");
});
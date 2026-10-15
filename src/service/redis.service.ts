import { redis } from "../redis/redis";

export const redisSecurityCache = {
  async getSecurityVersion(userId: string): Promise<number | null> {
    try {
      const value = await redis.get(`security:user:${userId}`);
      return value === null ? null : Number(value);
    } catch {
      return null;
    }
  },

  async setSecurityVersion(userId: string, version: number): Promise<void> {
    try {
      await redis.set(`security:user:${userId}`, version, "EX", 3600);
    } catch {
      // Graceful fallback when Redis server is offline
    }
  },

  async incrementLoginAttempts(key: string): Promise<number> {
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, 60);
      }
      return count;
    } catch {
      return 0;
    }
  },
};

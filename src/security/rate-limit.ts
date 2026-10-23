import { redis } from "../redis/redis";
import { redisKeys } from "../redis/redis.keys";
import { AppError } from "../../utils/app-error";

export async function checkLoginRateLimit(
  ip: string,
  email: string,
): Promise<void> {
  try {
    if (redis.status !== "ready") {
      return; // Skip Redis rate-limiting if Redis is not connected
    }

    const ipKey = redisKeys.loginRateLimit(ip);
    const emailKey = redisKeys.loginEmailRateLimit(email);

    const pipeline = redis.pipeline();

    pipeline.incr(ipKey);
    pipeline.expire(ipKey, 60);

    pipeline.incr(emailKey);
    pipeline.expire(emailKey, 60);

    const result = await pipeline.exec();

    const ipAttempts = Number(result?.[0]?.[1] ?? 0);
    const emailAttempts = Number(result?.[2]?.[1] ?? 0);

    if (ipAttempts > 20) {
      throw new AppError(
        "Too many login attempts from this IP address. Please wait 60 seconds.",
        429,
        "RATE_LIMIT_EXCEEDED"
      );
    }

    if (emailAttempts > 10) {
      throw new AppError(
        "Too many login attempts for this account. Please wait 60 seconds.",
        429,
        "RATE_LIMIT_EXCEEDED"
      );
    }
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    // Fail-open for transient Redis connection issues to avoid blocking valid logins
    console.warn("⚠️ Rate limit check skipped due to Redis error:", (err as Error).message);
  }
}
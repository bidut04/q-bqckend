import { redis } from "../redis/redis";
import { redisKeys } from "../redis/redis.keys";

export async function checkLoginRateLimit(
  ip: string,
  email: string,
): Promise<void> {
  const ipKey =
    redisKeys.loginRateLimit(ip);

  const emailKey =
    redisKeys.loginEmailRateLimit(
      email,
    );

  const pipeline =
    redis.pipeline();

  pipeline.incr(ipKey);
  pipeline.expire(ipKey, 60);

  pipeline.incr(emailKey);
  pipeline.expire(emailKey, 60);

  const result =
    await pipeline.exec();

  const ipAttempts =
    Number(result?.[0]?.[1] ?? 0);

  const emailAttempts =
    Number(result?.[2]?.[1] ?? 0);

  if (ipAttempts > 20) {
    throw new Error(
      "Too many login attempts",
    );
  }

  if (emailAttempts > 10) {
    throw new Error(
      "Too many login attempts",
    );
  }
}
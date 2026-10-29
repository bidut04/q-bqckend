import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { redis } from "../redis/redis";
import { getTenantContext } from "../core/tenant/tenant-context.store";

export interface SlidingRateLimiterOptions {
  /**
   * The sliding window duration in milliseconds (default: 60,000ms = 1 minute)
   */
  windowMs?: number;

  /**
   * Maximum allowed requests within the sliding window (default: 100)
   */
  limit?: number;

  /**
   * Redis key prefix
   */
  keyPrefix?: string;

  /**
   * Custom identifier extractor (IP, API Key, Tenant ID)
   */
  keyGenerator?: (req: Request) => string;

  /**
   * Error message returned when limit is exceeded
   */
  message?: string;

  /**
   * Error code returned in JSON response
   */
  code?: string;

  /**
   * Skip predicate (e.g. during specific test runs or health checks)
   */
  skip?: (req: Request) => boolean;
}

// In-memory fallback sliding-window ring buffer when Redis is offline or in disconnected state
const memorySlidingCache = new Map<string, number[]>();

/**
 * Pure in-memory sliding window fallback
 */
const checkMemorySlidingWindow = (
  key: string,
  now: number,
  windowMs: number,
  limit: number
): { allowed: boolean; remaining: number; resetMs: number } => {
  const cutoff = now - windowMs;
  let timestamps = memorySlidingCache.get(key) || [];
  
  // Prune expired timestamps outside sliding window
  timestamps = timestamps.filter((t) => t > cutoff);

  if (timestamps.length < limit) {
    timestamps.push(now);
    memorySlidingCache.set(key, timestamps);
    return {
      allowed: true,
      remaining: Math.max(0, limit - timestamps.length),
      resetMs: windowMs,
    };
  }

  // Not allowed
  const oldestInWindow = timestamps[0] || now;
  const resetMs = Math.max(0, oldestInWindow + windowMs - now);
  return {
    allowed: false,
    remaining: 0,
    resetMs,
  };
};

/**
 * Lua script for atomic sliding window rate limiting in Redis
 * KEYS[1] = rate limit key
 * ARGV[1] = current timestamp (ms)
 * ARGV[2] = window duration (ms)
 * ARGV[3] = max limit
 * ARGV[4] = unique member identifier
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local clearBefore = now - windowMs

-- 1. Remove timestamps outside the sliding window
redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)

-- 2. Count current entries in window
local currentCount = redis.call('ZCARD', key)

if currentCount < limit then
  -- Allowed: Add current request timestamp
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowMs + 2000)
  return {1, limit - currentCount - 1}
else
  -- Blocked: Find oldest timestamp in current window to calculate reset time
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetMs = windowMs
  if oldest and #oldest >= 2 then
    resetMs = math.max(0, tonumber(oldest[2]) + windowMs - now)
  end
  return {0, 0, resetMs}
end
`;

/**
 * Factory function creating a Redis Sliding-Window Rate Limiter middleware
 */
export const createSlidingRateLimiter = (options: SlidingRateLimiterOptions = {}) => {
  const windowMs = options.windowMs || 60 * 1000; // 1 minute
  const limit = options.limit || 100; // 100 requests / minute
  const keyPrefix = options.keyPrefix || "ratelimit:sliding";
  const message = options.message || "Too many requests. Please slow down and try again later.";
  const code = options.code || "RATE_LIMIT_EXCEEDED";

  const defaultKeyGen = (req: Request): string => {
    // 1. API Key priority (X-API-Key header)
    const apiKey = req.header("x-api-key");
    if (apiKey) {
      return `apikey:${apiKey.trim()}`;
    }

    // 2. Tenant Context priority (if authenticated)
    const context = getTenantContext();
    if (context) {
      return `tenant:${context.tenantId}:user:${context.userId}`;
    }

    // 3. Client IP (with X-Forwarded-For support)
    const forwarded = req.header("x-forwarded-for");
    const ip = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : undefined) || req.ip || "127.0.0.1";
    return `ip:${ip}`;
  };

  const keyGen = options.keyGenerator || defaultKeyGen;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (options.skip && options.skip(req)) {
      next();
      return;
    }

    const identifier = keyGen(req);
    const redisKey = `${keyPrefix}:${identifier}`;
    const now = Date.now();
    const uniqueMember = `${now}_${crypto.randomBytes(4).toString("hex")}`;

    let allowed = true;
    let remaining = limit;
    let resetMs = windowMs;

    try {
      if (redis.status === "ready" || redis.status === "connect") {
        // Execute atomic Redis Lua script
        const result = (await redis.eval(
          SLIDING_WINDOW_LUA,
          1,
          redisKey,
          now.toString(),
          windowMs.toString(),
          limit.toString(),
          uniqueMember
        )) as [number, number, number?];

        allowed = result[0] === 1;
        remaining = result[1];
        if (result[2]) {
          resetMs = result[2];
        }
      } else {
        // Redis offline fallback to in-memory sliding window
        const memResult = checkMemorySlidingWindow(redisKey, now, windowMs, limit);
        allowed = memResult.allowed;
        remaining = memResult.remaining;
        resetMs = memResult.resetMs;
      }
    } catch {
      // On Redis execution error, fallback seamlessly to in-memory sliding window
      const memResult = checkMemorySlidingWindow(redisKey, now, windowMs, limit);
      allowed = memResult.allowed;
      remaining = memResult.remaining;
      resetMs = memResult.resetMs;
    }

    // Standard IETF & GitHub / Stripe Rate Limit Headers
    const resetSeconds = Math.ceil((now + resetMs) / 1000);
    const retryAfterSeconds = Math.ceil(resetMs / 1000);

    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", resetSeconds);

    if (!allowed) {
      res.setHeader("Retry-After", retryAfterSeconds);
      res.status(429).json({
        success: false,
        code,
        message,
        limit,
        remaining: 0,
        retryAfterSeconds,
      });
      return;
    }

    next();
  };
};

/**
 * Pre-configured Public Booking API Limiter:
 * 100 req/min per IP or API Key to protect public kiosk & booking forms from bot floods.
 */
export const publicBookingSlidingLimiter = createSlidingRateLimiter({
  windowMs: 60 * 1000, // 1 minute sliding window
  limit: 100, // 100 req/min
  keyPrefix: "ratelimit:public_booking",
  code: "BOOKING_RATE_LIMITED",
  message: "Too many public booking requests. Public queue booking is limited to 100 requests per minute.",
  skip: () => process.env.NODE_ENV === "test",
});

/**
 * Pre-configured API Gateway Sliding Rate Limiter
 */
export const apiGatewaySlidingLimiter = createSlidingRateLimiter({
  windowMs: 60 * 1000,
  limit: 300,
  keyPrefix: "ratelimit:gateway",
  skip: () => process.env.NODE_ENV === "test",
});

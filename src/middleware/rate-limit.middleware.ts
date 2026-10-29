import rateLimit from "express-rate-limit";

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMITED",
    message: "Too many requests. Please try again later.",
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    code: "AUTH_RATE_LIMITED",
    message: "Too many authentication attempts. Please try again later.",
  },
});

export const publicBookingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: {
    success: false,
    code: "BOOKING_RATE_LIMITED",
    message: "Too many booking requests from this IP. Please try again later.",
  },
});

export {
  createSlidingRateLimiter,
  publicBookingSlidingLimiter,
  apiGatewaySlidingLimiter,
} from "./sliding-rate-limiter";


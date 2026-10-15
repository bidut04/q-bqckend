import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";

import { env, isProduction } from "./src/config/env";
import { globalRateLimiter } from "./src/middleware/rate-limit.middleware";
import { notFoundMiddleware } from "./src/middleware/not-found.middleware";
import { errorMiddleware } from "./src/middleware/error.middleware";
import { tenantShardingMiddleware } from "./src/middleware/tenant.middleware";
import { shardManager } from "./src/lib/sharding/shard.manager";
import { apiRouter } from "./src/routes";

export const app = express();

// ============================================================
// TRUST PROXY
// ============================================================

/*
 * Required when running behind:
 * Nginx, AWS ALB, Render, Railway, Vercel proxy, Cloudflare
 * Allows Express to correctly understand req.ip / HTTPS information.
 */

if (isProduction) {
  app.set("trust proxy", 1);
}

// ============================================================
// SECURITY HEADERS
// ============================================================

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy:
      env.NODE_ENV === "production"
        ? undefined
        : false,

    crossOriginEmbedderPolicy: false,
  })
);

// ============================================================
// CORS
// ============================================================

const allowedOrigins =
  env.CORS_ORIGIN
    .split(",")
    .map((origin) =>
      origin.trim()
    )
    .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server / curl requests
      if (!origin) {
        callback(null, true);
        return;
      }

      if (
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(
        new Error("CORS origin not allowed")
      );
    },

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-Tenant-ID",
      "X-Tenant",
    ],
  })
);

// ============================================================
// BODY PARSING & COOKIE PARSER
// ============================================================

app.use(
  express.json({
    limit: "1mb",
    strict: true,
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "1mb",
  })
);

app.use(cookieParser());

// ============================================================
// TENANT SHARDING MIDDLEWARE
// ============================================================

app.use(tenantShardingMiddleware);

// ============================================================
// GLOBAL RATE LIMIT
// ============================================================

app.use(globalRateLimiter);

// ============================================================
// HEALTH CHECK WITH SHARD STATUS
// ============================================================

app.get(
  "/health",
  async (_req, res) => {
    const shardHealth = await shardManager.checkHealth();
    res.status(200).json({
      success: true,
      status: "ok",
      timestamp: new Date().toISOString(),
      shards: shardHealth,
    });
  }
);

// ============================================================
// API ROUTES
// ============================================================

app.use("/api/v1", apiRouter);

// ============================================================
// 404
// ============================================================

app.use(notFoundMiddleware);

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(errorMiddleware);
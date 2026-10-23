import http from "http";


import { app } from "./app";
import { env } from "./src/config/env";
import { prisma } from "./src/config/prisma";
import { socketServer } from "./src/lib/socket/socket.server";
import { redisClient } from "./src/config/redis";

let server: http.Server | undefined;

// ============================================================
// START SERVER
// ============================================================

const startServer = async (): Promise<void> => {
  try {
    // ---------------------------------------------
    // Database connection
    // ---------------------------------------------

    await prisma.$connect();

    console.log(
      "✅ MySQL connected"
    );

    try {
      await Promise.race([
        redisClient.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Redis connection timeout")), 1500)),
      ]);
    } catch {
      // Handled by redisClient error listener
    }

    if (redisClient.status === "ready") {
      console.log("✅ Redis connected");
    } else {
      console.log("ℹ️ Redis offline - running with in-memory caching and local socket adapter");
    }

    // ---------------------------------------------
    // HTTP server
    // ---------------------------------------------

    server = http.createServer(app);
    await socketServer.init(server);

    server.listen(
      env.PORT,
      () => {
        console.log(
          `🚀 API running on port ${env.PORT}`
        );

        console.log(
          `Environment: ${env.NODE_ENV}`
        );
      }
    );

    // ---------------------------------------------
    // Server error
    // ---------------------------------------------

    server.on(
      "error",
      (error) => {
        console.error(
          "❌ HTTP server error:",
          error
        );

        process.exit(1);
      }
    );

  } catch (error) {
    console.error(
      "❌ Failed to start server:",
      error
    );

    await shutdown();
    process.exit(1);
  }
};

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

const shutdown = async (): Promise<void> => {
  console.log(
    "🛑 Shutting down..."
  );

  try {
    // Stop accepting new requests
    if (server) {
      await new Promise<void>(
        (resolve) => {
          server!.close(() => {
            resolve();
          });
        }
      );
    }

    await socketServer.close();

    // Close Redis
    if (redisClient.status === "ready") {
      try {
        await redisClient.quit();
      } catch {
        redisClient.disconnect();
      }
    }

    // Close MySQL
    await prisma.$disconnect();

    console.log(
      "✅ Shutdown complete"
    );

  } catch (error) {
    console.error(
      "❌ Shutdown error:",
      error
    );

    process.exit(1);
  }
};

// ============================================================
// PROCESS SIGNALS
// ============================================================

process.on(
  "SIGTERM",
  async () => {
    await shutdown();
    process.exit(0);
  }
);

process.on(
  "SIGINT",
  async () => {
    await shutdown();
    process.exit(0);
  }
);

// ============================================================
// UNHANDLED PROMISE
// ============================================================

process.on(
  "unhandledRejection",
  async (reason) => {
    console.error(
      "❌ UNHANDLED REJECTION:",
      reason
    );

    await shutdown();
    process.exit(1);
  }
);

// ============================================================
// UNCAUGHT EXCEPTION
// ============================================================

process.on(
  "uncaughtException",
  async (error) => {
    console.error(
      "❌ UNCAUGHT EXCEPTION:",
      error
    );

    await shutdown();
    process.exit(1);
  }
);

// ============================================================
// START
// ============================================================

void startServer();
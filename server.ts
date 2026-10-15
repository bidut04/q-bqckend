import http from "http";


import { app } from "./app";
import { env } from "./src/config/env";
import { prisma } from "./src/config/prisma";
//import { redisClient } from "./config/redis";

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

    // ---------------------------------------------
    // Redis connection
    // ---------------------------------------------

    //await redisClient.ping();

    console.log(
      "✅ Redis connected"
    );

    // ---------------------------------------------
    // HTTP server
    // ---------------------------------------------

    server = http.createServer(app);

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

    // Close Redis
    //try {
    //  await redisClient.quit();
    //} catch {
    //  redisClient.disconnect();
    //}

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
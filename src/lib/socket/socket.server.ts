import http from "http";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "../../config/env";
import { redisClient } from "../../config/redis";
import { realtimeCacheService } from "../redis/realtime-cache.service";
import { authenticateSocket, joinRoom, AuthenticatedSocket } from "./socket.authorizer";

let io: Server | null = null;
let pubClient: typeof redisClient | null = null;
let subClient: typeof redisClient | null = null;

export const initSocketServer = async (httpServer: http.Server): Promise<Server> => {
  if (io) {
    return io;
  }

  const allowedOrigins = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
    : ["*"];

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
      credentials: true,
      methods: ["GET", "POST"],
    },
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  // Wire Redis Adapter for multi-node horizontal scalability if Redis is online
  if (redisClient.status === "ready") {
    try {
      const pub = redisClient.duplicate({ maxRetriesPerRequest: null });
      const sub = redisClient.duplicate({ maxRetriesPerRequest: null });

      pub.on("error", (err) => {
        console.warn("⚠️ Socket.IO Redis pubClient error:", err.message);
      });
      sub.on("error", (err) => {
        console.warn("⚠️ Socket.IO Redis subClient error:", err.message);
      });

      await Promise.all([pub.connect().catch(() => {}), sub.connect().catch(() => {})]);

      if (pub.status === "ready" && sub.status === "ready") {
        pubClient = pub;
        subClient = sub;
        io.adapter(createAdapter(pubClient, subClient));
        console.log("✅ Socket.IO Redis Adapter active (Clustered Pub/Sub enabled)");
      } else {
        try { pub.disconnect(); } catch {}
        try { sub.disconnect(); } catch {}
        console.log("ℹ️ Socket.IO running in standalone mode (In-Memory Adapter)");
      }
    } catch (adapterError) {
      console.warn("⚠️ Socket.IO Redis Adapter fallback to memory:", (adapterError as Error).message);
      console.log("ℹ️ Socket.IO running in standalone mode (In-Memory Adapter)");
    }
  } else {
    console.log("ℹ️ Socket.IO running in standalone mode (In-Memory Adapter)");
  }

  // 1. Authenticate connection with JWT handshake
  io.use((socket: Socket, next) => {
    authenticateSocket(socket as unknown as AuthenticatedSocket, next);
  });

  // 2. Connection handler
  io.on("connection", (socket: Socket) => {
    const authSocket = socket as unknown as AuthenticatedSocket;
    const tenantContext = authSocket.tenantContext;

    if (!tenantContext) {
      socket.disconnect(true);
      return;
    }

    // Automatically join the tenant-wide broadcast room
    socket.join(`tenant:${tenantContext.tenantId}`);

    // Client requests room subscription (e.g. branch queue or TV display)
    socket.on(
      "subscribe",
      async (
        data: { room: string; lastSeenAt?: string },
        callback?: (res: { success: boolean; error?: string }) => void
      ) => {
        if (!data || !data.room) {
          if (callback) callback({ success: false, error: "Room name missing" });
          return;
        }

        const isAllowed = joinRoom(authSocket, data.room);
        if (isAllowed) {
          // 1. If subscribing to a display screen, hydrate with currently calling tokens from Redis cache
          if (data.room.endsWith(":display")) {
            const branchMatch = data.room.match(/:branch:([a-zA-Z0-9_-]+):display$/);
            if (branchMatch) {
              const branchId = branchMatch[1];
              const callingState = await realtimeCacheService.getCallingDisplay(tenantContext.tenantId, branchId);
              socket.emit("display.initial_state", { branchId, activeCalls: callingState });
            }
          }

          // 2. RECONNECTION CATCH-UP: If client reconnected with lastSeenAt, catch up on missed token events
          if (data.lastSeenAt) {
            const branchMatch = data.room.match(/:branch:([a-zA-Z0-9_-]+)/);
            const branchId = branchMatch ? branchMatch[1] : "default";
            const missed = await realtimeCacheService.getMissedEvents(
              tenantContext.tenantId,
              branchId,
              data.lastSeenAt
            );
            if (missed && missed.length > 0) {
              socket.emit("queue.sync_missed_events", {
                room: data.room,
                branchId,
                syncedAt: new Date().toISOString(),
                events: missed,
              });
            }
          }

          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false, error: "Forbidden room subscription" });
        }
      }
    );

    socket.on("unsubscribe", (data: { room: string }) => {
      if (data && data.room) {
        socket.leave(data.room);
      }
    });
  });

  console.log("✅ Socket.IO Server initialized with CORS & multi-tenant isolation");
  return io;
};

export const getSocketIO = (): Server | null => io;

export const closeSocketServer = async (): Promise<void> => {
  if (io) {
    await new Promise<void>((resolve) => {
      io!.close(() => resolve());
    });
    io = null;
  }
  if (pubClient) {
    await pubClient.quit().catch(() => {});
    pubClient = null;
  }
  if (subClient) {
    await subClient.quit().catch(() => {});
    subClient = null;
  }
  console.log("✅ Socket.IO Server and Redis Adapter closed cleanly");
};

export const socketServer = {
  init: initSocketServer,
  getIO: getSocketIO,
  close: closeSocketServer,
};

export const SocketServer = function (this: unknown) {
  return socketServer;
} as unknown as {
  new (): typeof socketServer;
};

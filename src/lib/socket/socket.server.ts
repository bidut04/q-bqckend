import http from "http";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "../../config/env";
import { redisClient } from "../../config/redis";
import { SocketAuthorizer, AuthenticatedSocket } from "./socket.authorizer";
import { realtimeCacheService } from "../redis/realtime-cache.service";

export class SocketServer {
  private io: Server | null = null;
  private pubClient: typeof redisClient | null = null;
  private subClient: typeof redisClient | null = null;

  public async init(httpServer: http.Server): Promise<Server> {
    if (this.io) {
      return this.io;
    }

    const allowedOrigins = env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
      : ["*"];

    this.io = new Server(httpServer, {
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
          this.pubClient = pub;
          this.subClient = sub;
          this.io.adapter(createAdapter(this.pubClient, this.subClient));
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
    this.io.use((socket: Socket, next) => {
      SocketAuthorizer.authenticateSocket(socket as unknown as AuthenticatedSocket, next);
    });

    // 2. Connection handler
    this.io.on("connection", (socket: Socket) => {
      const authSocket = socket as unknown as AuthenticatedSocket;
      const tenantContext = authSocket.tenantContext;

      if (!tenantContext) {
        socket.disconnect(true);
        return;
      }

      // Automatically join the tenant-wide broadcast room
      socket.join(`tenant:${tenantContext.tenantId}`);

      // Client requests room subscription (e.g. branch queue or TV display)
      socket.on("subscribe", async (data: { room: string }, callback?: (res: { success: boolean; error?: string }) => void) => {
        if (!data || !data.room) {
          if (callback) callback({ success: false, error: "Room name missing" });
          return;
        }

        const isAllowed = SocketAuthorizer.joinRoom(authSocket, data.room);
        if (isAllowed) {
          // If subscribing to a display screen, hydrate with currently calling tokens from Redis cache
          if (data.room.endsWith(":display")) {
            const branchMatch = data.room.match(/:branch:([a-zA-Z0-9_-]+):display$/);
            if (branchMatch) {
              const branchId = branchMatch[1];
              const callingState = await realtimeCacheService.getCallingDisplay(tenantContext.tenantId, branchId);
              socket.emit("display.initial_state", { branchId, activeCalls: callingState });
            }
          }

          if (callback) callback({ success: true });
        } else {
          if (callback) callback({ success: false, error: "Forbidden room subscription" });
        }
      });

      socket.on("unsubscribe", (data: { room: string }) => {
        if (data && data.room) {
          socket.leave(data.room);
        }
      });
    });

    console.log("✅ Socket.IO Server initialized with CORS & multi-tenant isolation");
    return this.io;
  }

  public getIO(): Server | null {
    return this.io;
  }

  public async close(): Promise<void> {
    if (this.io) {
      await new Promise<void>((resolve) => {
        this.io!.close(() => resolve());
      });
      this.io = null;
    }
    if (this.pubClient) {
      await this.pubClient.quit().catch(() => {});
      this.pubClient = null;
    }
    if (this.subClient) {
      await this.subClient.quit().catch(() => {});
      this.subClient = null;
    }
    console.log("✅ Socket.IO Server and Redis Adapter closed cleanly");
  }
}

export const socketServer = new SocketServer();

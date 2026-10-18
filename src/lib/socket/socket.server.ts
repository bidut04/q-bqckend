import http from "http";
import { Server, Socket } from "socket.io";
import { env } from "../../config/env";
import { SocketAuthorizer, AuthenticatedSocket } from "./socket.authorizer";
import { realtimeCacheService } from "../redis/realtime-cache.service";

export class SocketServer {
  private io: Server | null = null;

  public init(httpServer: http.Server): Server {
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
      console.log("✅ Socket.IO Server closed");
    }
  }
}

export const socketServer = new SocketServer();

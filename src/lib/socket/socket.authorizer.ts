import { verifyJwt } from "../../security/jwt";
import { TenantResolver } from "../../core/tenant/tenant-resolver";
import { TenantContext } from "../../core/tenant/tenant-context";
import { Authorizer } from "../../core/authorization/authorizer";
import { AuditLogger } from "../../core/audit/audit.logger";

const resolver = new TenantResolver();

export interface AuthenticatedSocket {
  id: string;
  handshake: {
    auth: Record<string, any>;
    headers: Record<string, string | string[] | undefined>;
  };
  join(room: string): void;
  emit(event: string, ...args: any[]): void;
  tenantContext?: TenantContext;
}

export class SocketAuthorizer {
  /**
   * Authenticates socket handshake JWT and attaches trusted TenantContext.
   */
  public static async authenticateSocket(socket: AuthenticatedSocket, next: (err?: Error) => void): Promise<void> {
    try {
      const rawAuthHeader = socket.handshake.headers.authorization;
      const authHeaderStr = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
      const token = socket.handshake.auth.token || (authHeaderStr?.startsWith("Bearer ") ? authHeaderStr.substring(7) : authHeaderStr);
      if (!token) {
        return next(new Error("Socket authentication token missing"));
      }

      const decoded = verifyJwt(token) as any;
      if (!decoded || !decoded.tenantId || !decoded.sub) {
        return next(new Error("Invalid socket token claims"));
      }

      const context = await resolver.resolveFromSession({
        userId: decoded.sub,
        tenantId: decoded.tenantId,
        roles: decoded.roles || [],
        permissions: decoded.permissions || [],
        branches: decoded.branches || [],
        sessionId: decoded.sessionId,
        securityVersion: decoded.securityVersion || 0,
      });

      socket.tenantContext = context;
      next();
    } catch (error) {
      next(new Error(`Socket Auth Failed: ${(error as Error).message}`));
    }
  }

  /**
   * Authorizes socket room subscription attempt.
   * Restricts room joins strictly to `tenant:{tenantId}` or `tenant:{tenantId}:branch:{branchId}`.
   */
  public static joinRoom(socket: AuthenticatedSocket, roomName: string): boolean {
    const context = socket.tenantContext;
    if (!context) {
      socket.emit("error", { message: "Unauthenticated socket room join attempt" });
      return false;
    }

    const tenantRoomPattern = new RegExp(`^tenant:${context.tenantId}$`);
    const branchRoomPattern = new RegExp(`^tenant:${context.tenantId}:branch:([a-zA-Z0-9_-]+)$`);

    if (tenantRoomPattern.test(roomName)) {
      socket.join(roomName);
      return true;
    }

    const branchMatch = roomName.match(branchRoomPattern);
    if (branchMatch) {
      const targetBranchId = branchMatch[1];
      if (Authorizer.isBranchAuthorized(context, targetBranchId)) {
        socket.join(roomName);
        return true;
      }
    }

    // Security violation attempt logged
    AuditLogger.log(context, "CROSS_TENANT_ACCESS_ATTEMPT", "SocketRoom", roomName, {
      attemptedRoom: roomName,
      socketId: socket.id,
    });
    socket.emit("error", { message: "Unauthorized socket room subscription attempt" });
    return false;
  }
}

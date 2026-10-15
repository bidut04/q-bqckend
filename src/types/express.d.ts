import { Role } from "@prisma/client";
import { TenantContext } from "../core/tenant/tenant-context";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  securityVersion: number;
  sessionId: string;
  tenantId?: string;
  sub?: string;
  isSuperAdmin?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      tenantId?: string;
      shardId?: string;
      tenantContext?: TenantContext;
    }
  }
}


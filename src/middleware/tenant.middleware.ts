import type { Request, Response, NextFunction } from "express";
import { TenantContext } from "../lib/sharding/tenant.context";
import { ShardRouter } from "../lib/sharding/shard.router";

export interface ShardedRequest extends Request {
  tenantId?: string;
  shardId?: string;
}

export async function tenantShardingMiddleware(
  req: ShardedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = req.user;
  const rawHeaderTenant = req.headers["x-tenant-id"] ?? req.headers["x-tenant"];
  const headerTenant = typeof rawHeaderTenant === "string" ? rawHeaderTenant.trim() : undefined;

  let tenantId: string | undefined;
  if (user?.tenantId) {
    tenantId = user.tenantId;
  } else if (req.tenantId) {
    tenantId = req.tenantId;
  } else if (headerTenant) {
    tenantId = headerTenant;
  }

  if (!tenantId) {
    return next();
  }

  try {
    const shardId = await ShardRouter.resolveShard(tenantId);

    req.tenantId = tenantId;
    req.shardId = shardId;
    res.setHeader("X-Resolved-Shard", shardId);

    let actorId = "anonymous";
    if (user?.id) {
      actorId = user.id;
    } else if (user?.email) {
      actorId = user.email;
    }

    TenantContext.run(
      {
        tenantId,
        shardId,
        userId: actorId,
      },
      () => {
        next();
      }
    );
  } catch (error) {
    next(error);
  }
}

export function requireTenantContext(
  req: ShardedRequest,
  res: Response,
  next: NextFunction
): void {
  const tenantId = TenantContext.getTenantId();
  if (!tenantId) {
    res.status(400).json({
      error: "TenantContextRequired",
      message: "Valid tenant authentication context is required for this route.",
    });
    return;
  }
  next();
}

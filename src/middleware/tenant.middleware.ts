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
  if (!user || !user.tenantId) {
    return next();
  }

  try {
    const tenantId = user.tenantId;
    const shardId = await ShardRouter.resolveShard(tenantId);

    req.tenantId = tenantId;
    req.shardId = shardId;
    res.setHeader("X-Resolved-Shard", shardId);

    TenantContext.run(
      {
        tenantId,
        shardId,
        userId: user.id || user.sub || user.email || "anonymous",
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

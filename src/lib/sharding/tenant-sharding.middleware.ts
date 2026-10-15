import { Request, Response, NextFunction } from "express";
import { resolveTenantShard } from "./shard.router";
import { runTenantContext } from "./tenant.context";

export const tenantShardingMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.tenantId) {
      res.status(401).json({
        success: false,
        message: "Authentication and tenant identity required.",
      });
      return;
    }

    const tenantId = user.tenantId;
    const shardId = await resolveTenantShard(tenantId);
    res.setHeader("X-Resolved-Shard", shardId);

    runTenantContext(
      {
        tenantId,
        shardId,
        userId: user.id || user.sub || user.email || "anonymous",
        isSuperAdmin: Boolean(user.isSuperAdmin),
      },
      () => {
        next();
      }
    );
  } catch (error) {
    next(error);
  }
};
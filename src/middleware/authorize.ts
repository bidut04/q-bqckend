import { Request, Response, NextFunction } from "express";
import { requireTenantContext } from "../core/tenant/tenant-context.store";
import { Permission } from "../core/authorization/permissions";
import { Authorizer } from "../core/authorization/authorizer";

export const requirePermission = (permission: Permission) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const context = requireTenantContext();
      Authorizer.authorize(context, permission);
      next();
    } catch (error) {
      next(error);
    }
  };
};

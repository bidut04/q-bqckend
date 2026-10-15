import { Request, Response, NextFunction } from "express";
import { requireTenantContext } from "../core/tenant/tenant-context.store";
import { Authorizer } from "../core/authorization/authorizer";
import { BranchAccessDeniedError } from "../core/errors/security.errors";
import { AuditLogger } from "../core/audit/audit.logger";

export const enforceBranchScope = (paramOrBodyKey = "branchId") => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const context = requireTenantContext();
      
      const targetBranchId =
        req.params[paramOrBodyKey] || req.body[paramOrBodyKey] || (req.query[paramOrBodyKey] as string);

      if (targetBranchId) {
        const authorized = Authorizer.isBranchAuthorized(context, targetBranchId);
        if (!authorized) {
          AuditLogger.log(context, "BRANCH_ACCESS_DENIED", "Branch", targetBranchId, {
            requestedBranchId: targetBranchId,
            assignedBranchIds: context.branchIds,
          });
          throw new BranchAccessDeniedError(
            `Branch '${targetBranchId}' is outside authorized branch scope [${context.branchIds.join(", ")}]`
          );
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

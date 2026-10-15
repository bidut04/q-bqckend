import { TenantContext } from "../tenant/tenant-context";
import { Permission } from "./permissions";
import { Role } from "./roles";
import { ForbiddenError, TenantAccessDeniedError, BranchAccessDeniedError } from "../errors/security.errors";

export interface AuthorizationResource {
  tenantId: string;
  branchId?: string;
  ownerUserId?: string;
}

export class Authorizer {
  /**
   * Verifies if the context has the required permission and optionally matches tenant/branch scope.
   */
  public static authorize(
    context: TenantContext,
    requiredPermission: Permission,
    targetResource?: AuthorizationResource
  ): void {
    // 1. Check Platform Super Admin bypass (ONLY for explicit platform permissions or authorized support session)
    const isPlatformUser = context.roleIds.some(
      (r) => r === Role.PLATFORM_OWNER || r === Role.PLATFORM_ADMIN || r === Role.PLATFORM_SUPPORT
    );

    if (isPlatformUser && requiredPermission.startsWith("platform:")) {
      if (!context.permissions.includes(requiredPermission)) {
        throw new ForbiddenError(`Platform permission '${requiredPermission}' is required`);
      }
      return;
    }

    // 2. Permission check
    if (!context.permissions.includes(requiredPermission)) {
      throw new ForbiddenError(`Required permission '${requiredPermission}' is missing`);
    }

    // 3. Target resource tenant boundary check
    if (targetResource) {
      if (targetResource.tenantId !== context.tenantId) {
        throw new TenantAccessDeniedError(`Resource belongs to tenant '${targetResource.tenantId}', active tenant context is '${context.tenantId}'`);
      }

      // 4. Branch boundary check if target resource has a branchId and user has branch restrictions
      if (targetResource.branchId && context.branchIds.length > 0) {
        const isBranchAdminOrEmp = context.roleIds.some((r) => r === Role.BRANCH_ADMIN || r === Role.EMPLOYEE);
        if (isBranchAdminOrEmp && !context.branchIds.includes(targetResource.branchId)) {
          throw new BranchAccessDeniedError(`Access to branch '${targetResource.branchId}' is not authorized for user's assigned branch scope [${context.branchIds.join(", ")}]`);
        }
      }

      // 5. Resource ownership check (if strict ownership is required)
      if (targetResource.ownerUserId && context.roleIds.includes(Role.EMPLOYEE)) {
        if (targetResource.ownerUserId !== context.userId) {
          throw new ForbiddenError("Resource does not belong to authenticated user");
        }
      }
    }
  }

  /**
   * Helper to check if a branch ID is authorized for the given tenant context.
   */
  public static isBranchAuthorized(context: TenantContext, targetBranchId: string): boolean {
    if (!context.branchIds || context.branchIds.length === 0) {
      // Empty branchIds means tenant-wide access (e.g. TENANT_OWNER, TENANT_ADMIN)
      return true;
    }
    return context.branchIds.includes(targetBranchId);
  }
}

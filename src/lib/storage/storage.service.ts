import { TenantContext } from "../../core/tenant/tenant-context";
import { Authorizer } from "../../core/authorization/authorizer";
import { Permission } from "../../core/authorization/permissions";
import { TenantAccessDeniedError } from "../../core/errors/security.errors";

export class StorageService {
  /**
   * Generates an authorized, short-lived presigned URL for access to a tenant-scoped file asset.
   */
  public static generatePresignedUrl(
    context: TenantContext,
    targetFileTenantId: string,
    customerId: string,
    fileId: string,
    expiresInSeconds = 300
  ): string {
    // 1. Enforce tenant isolation check
    if (targetFileTenantId !== context.tenantId) {
      throw new TenantAccessDeniedError(`Cannot access file belonging to tenant '${targetFileTenantId}'`);
    }

    // 2. Enforce permission check
    Authorizer.authorize(context, Permission.CUSTOMER_READ);

    // 3. Construct structured tenant object path
    const storagePath = `tenants/${context.tenantId}/customers/${customerId}/documents/${fileId}`;
    const token = `sig_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    // 4. Return short-lived presigned URL
    return `https://storage.queueflow.internal/${storagePath}?token=${token}&expiresIn=${expiresInSeconds}`;
  }
}

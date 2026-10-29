import { TenantContext } from "../core/tenant/tenant-context";
import { getTenantDb, withTenantScope, ensureFound } from "../common/base.repository";

export const createBranchRepository = () => {
  const findById = async (context: TenantContext, branchId: string) => {
    const db = await getTenantDb(context);
    const delegate = (db as any).branch ?? db.location;
    const branch = await delegate.findFirst({
      where: withTenantScope(context, { id: branchId }),
    });
    return ensureFound(branch, "Branch");
  };

  const findAllForTenant = async (context: TenantContext) => {
    const db = await getTenantDb(context);
    const delegate = (db as any).branch ?? db.location;
    const whereClause: Record<string, unknown> = { tenantId: context.tenantId };

    if (context.branchIds && context.branchIds.length > 0) {
      whereClause.id = { in: context.branchIds };
    }

    return delegate.findMany({
      where: whereClause,
    });
  };

  return {
    findById,
    findAllForTenant,
  };
};

export const createLocationRepository = createBranchRepository;
export type BranchRepository = ReturnType<typeof createBranchRepository>;
export type LocationRepository = BranchRepository;

export const createBranchRepositoryAdapter = () => createBranchRepository();

export const BranchRepositoryAdapter = function (this: unknown) {
  return createBranchRepository();
} as unknown as {
  new (): ReturnType<typeof createBranchRepository>;
};

export const BranchRepository = BranchRepositoryAdapter as unknown as typeof BranchRepositoryAdapter &
  typeof createBranchRepository;

export const LocationRepository = BranchRepository;

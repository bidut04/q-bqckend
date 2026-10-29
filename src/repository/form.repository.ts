import { TenantContext } from "../core/tenant/tenant-context";
import { getTenantDb, withTenantScope, ensureFound } from "../common/base.repository";

export const createFormRepository = () => {
  const findFormById = async (context: TenantContext, formId: string) => {
    const db = await getTenantDb(context);
    const form = await db.form.findFirst({
      where: withTenantScope(context, { id: formId }),
      include: {
        versions: {
          include: {
            fields: true,
          },
        },
      },
    });
    return ensureFound(form, "Form");
  };

  const findPublishedFormForBranchAndService = async (
    context: TenantContext,
    branchId: string,
    serviceId: string
  ) => {
    const db = await getTenantDb(context);
    const form = await db.form.findFirst({
      where: withTenantScope(context, {
        scopeId: serviceId ?? branchId,
      }),
      include: {
        versions: {
          take: 1,
          include: { fields: true },
        },
      },
    });
    return ensureFound(form, "Published Form");
  };

  return {
    findFormById,
    findPublishedFormForBranchAndService,
  };
};

export type FormRepository = ReturnType<typeof createFormRepository>;

export const createFormRepositoryAdapter = () => createFormRepository();

export const FormRepositoryAdapter = function (this: unknown) {
  return createFormRepository();
} as unknown as {
  new (): ReturnType<typeof createFormRepository>;
};

export const FormRepository = FormRepositoryAdapter as unknown as typeof FormRepositoryAdapter &
  typeof createFormRepository;


import { TenantContext } from "../core/tenant/tenant-context";
import { getTenantDb, withTenantScope, ensureFound } from "../common/base.repository";

export const createCustomerRepository = () => {
  const findById = async (context: TenantContext, customerId: string) => {
    const db = await getTenantDb(context);
    const customer = await db.customer.findFirst({
      where: withTenantScope(context, { id: customerId }),
    });
    return ensureFound(customer, "Customer");
  };

  const findByPhone = async (context: TenantContext, phone: string) => {
    const db = await getTenantDb(context);
    return db.customer.findFirst({
      where: withTenantScope(context, { phone }),
    });
  };

  const createCustomer = async (
    context: TenantContext,
    data: { name?: string; phone?: string; email?: string }
  ) => {
    const db = await getTenantDb(context);
    return db.customer.create({
      data: {
        tenantId: context.tenantId,
        name: data.name,
        phone: data.phone,
        email: data.email,
      },
    });
  };

  return {
    findById,
    findByPhone,
    createCustomer,
  };
};

export type CustomerRepository = ReturnType<typeof createCustomerRepository>;

export const createCustomerRepositoryAdapter = () => createCustomerRepository();

export const CustomerRepositoryAdapter = function (this: unknown) {
  return createCustomerRepository();
} as unknown as {
  new (): ReturnType<typeof createCustomerRepository>;
};

export const CustomerRepository = CustomerRepositoryAdapter as unknown as typeof CustomerRepositoryAdapter &
  typeof createCustomerRepository;


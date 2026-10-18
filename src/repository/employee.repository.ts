import { EmployeeStatus, Prisma } from "@prisma/client";
import { TenantContext } from "../core/tenant/tenant-context";
import { getTenantDb, withTenantScope, ensureFound } from "../common/base.repository";
import { ResourceNotFoundError } from "../core/errors/security.errors";

export interface CreateEmployeeData {
  employeeCode: string;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  status?: EmployeeStatus;
  userId?: string;
  locationId?: string;
  roleId?: string;
}

export interface UpdateEmployeeData {
  name?: string;
  email?: string;
  phone?: string;
  department?: string;
  status?: EmployeeStatus;
  userId?: string;
}

export interface EmployeeFilter {
  locationId?: string;
  department?: string;
  status?: EmployeeStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export const createEmployeeRepository = () => {
  const findById = async (context: TenantContext, id: string) => {
    const db = await getTenantDb(context);
    const employee = await db.employee.findFirst({
      where: withTenantScope(context, { id, deletedAt: null }),
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
        locations: {
          include: {
            location: true,
          },
        },
        services: {
          include: {
            locationService: {
              include: {
                service: true,
                location: true,
              },
            },
          },
        },
        counters: {
          include: {
            counter: true,
          },
        },
      },
    });

    return ensureFound(employee, "Employee");
  };

  const findByCode = async (context: TenantContext, employeeCode: string) => {
    const db = await getTenantDb(context);
    return db.employee.findFirst({
      where: withTenantScope(context, { employeeCode, deletedAt: null }),
    });
  };

  const findMany = async (context: TenantContext, filter: EmployeeFilter = {}) => {
    const db = await getTenantDb(context);
    const page = Math.max(1, filter.page || 1);
    const limit = Math.min(100, Math.max(1, filter.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.EmployeeWhereInput = withTenantScope(context, {
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.department ? { department: filter.department } : {}),
      ...(filter.locationId
        ? {
            locations: {
              some: { locationId: filter.locationId },
            },
          }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search } },
              { employeeCode: { contains: filter.search } },
              { email: { contains: filter.search } },
            ],
          }
        : {}),
    });

    const [items, total] = await Promise.all([
      db.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          roles: {
            include: {
              role: true,
            },
          },
          locations: {
            include: {
              location: true,
            },
          },
          services: {
            include: {
              locationService: {
                include: {
                  service: true,
                },
              },
            },
          },
        },
      }),
      db.employee.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  };

  const create = async (context: TenantContext, data: CreateEmployeeData) => {
    const db = await getTenantDb(context);

    // Verify employee code uniqueness within tenant
    const existing = await findByCode(context, data.employeeCode);
    if (existing) {
      throw new Error(`Employee with code '${data.employeeCode}' already exists in this tenant`);
    }

    const employee = await db.employee.create({
      data: {
        tenantId: context.tenantId,
        employeeCode: data.employeeCode,
        name: data.name,
        email: data.email,
        phone: data.phone,
        department: data.department,
        status: data.status || EmployeeStatus.ACTIVE,
        userId: data.userId,
        ...(data.locationId
          ? {
              locations: {
                create: {
                  locationId: data.locationId,
                  isPrimary: true,
                },
              },
            }
          : {}),
        ...(data.roleId
          ? {
              roles: {
                create: {
                  roleId: data.roleId,
                },
              },
            }
          : {}),
      },
      include: {
        roles: { include: { role: true } },
        locations: { include: { location: true } },
      },
    });

    return employee;
  };

  const update = async (context: TenantContext, id: string, data: UpdateEmployeeData) => {
    const db = await getTenantDb(context);
    await findById(context, id);

    return db.employee.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.department !== undefined ? { department: data.department } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.userId !== undefined ? { userId: data.userId } : {}),
      },
      include: {
        roles: { include: { role: true } },
        locations: { include: { location: true } },
      },
    });
  };

  const deleteEmployee = async (context: TenantContext, id: string) => {
    const db = await getTenantDb(context);
    await findById(context, id);

    return db.employee.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: EmployeeStatus.INACTIVE,
      },
    });
  };

  // Branch / Location association
  const assignBranch = async (
    context: TenantContext,
    employeeId: string,
    locationId: string,
    isPrimary: boolean = false
  ) => {
    const db = await getTenantDb(context);
    await findById(context, employeeId);

    // Verify location exists in tenant
    const location = await db.location.findFirst({
      where: withTenantScope(context, { id: locationId }),
    });
    if (!location) {
      throw new ResourceNotFoundError(`Location/Branch '${locationId}' not found in this tenant`);
    }

    if (isPrimary) {
      // Unset other primary locations for this employee
      await db.employeeLocation.updateMany({
        where: { employeeId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return db.employeeLocation.upsert({
      where: {
        employeeId_locationId: {
          employeeId,
          locationId,
        },
      },
      create: {
        employeeId,
        locationId,
        isPrimary,
      },
      update: {
        isPrimary,
      },
      include: {
        location: true,
      },
    });
  };

  const removeBranch = async (context: TenantContext, employeeId: string, locationId: string) => {
    const db = await getTenantDb(context);
    await findById(context, employeeId);

    return db.employeeLocation.deleteMany({
      where: {
        employeeId,
        locationId,
      },
    });
  };

  // Service association
  const assignService = async (
    context: TenantContext,
    employeeId: string,
    locationId: string,
    serviceId: string
  ) => {
    const db = await getTenantDb(context);
    await findById(context, employeeId);

    // Ensure LocationService exists
    const locationService = await db.locationService.findUnique({
      where: {
        locationId_serviceId: {
          locationId,
          serviceId,
        },
      },
    });

    if (!locationService) {
      // Create locationService link if it doesn't exist
      await db.locationService.create({
        data: {
          locationId,
          serviceId,
          enabled: true,
        },
      });
    }

    // Upsert EmployeeService
    return db.employeeService.upsert({
      where: {
        employeeId_locationId_serviceId: {
          employeeId,
          locationId,
          serviceId,
        },
      },
      create: {
        tenantId: context.tenantId,
        employeeId,
        locationId,
        serviceId,
      },
      update: {},
      include: {
        locationService: {
          include: {
            service: true,
            location: true,
          },
        },
      },
    });
  };

  const removeService = async (
    context: TenantContext,
    employeeId: string,
    locationId: string,
    serviceId: string
  ) => {
    const db = await getTenantDb(context);
    await findById(context, employeeId);

    return db.employeeService.deleteMany({
      where: {
        tenantId: context.tenantId,
        employeeId,
        locationId,
        serviceId,
      },
    });
  };

  // Role association
  const assignRole = async (context: TenantContext, employeeId: string, roleId: string) => {
    const db = await getTenantDb(context);
    await findById(context, employeeId);

    // Verify role belongs to tenant
    const role = await db.tenantRole.findFirst({
      where: withTenantScope(context, { id: roleId }),
    });
    if (!role) {
      throw new ResourceNotFoundError(`TenantRole '${roleId}' not found in this tenant`);
    }

    return db.employeeRole.upsert({
      where: {
        employeeId_roleId: {
          employeeId,
          roleId,
        },
      },
      create: {
        employeeId,
        roleId,
      },
      update: {},
      include: {
        role: true,
      },
    });
  };

  const removeRole = async (context: TenantContext, employeeId: string, roleId: string) => {
    const db = await getTenantDb(context);
    await findById(context, employeeId);

    return db.employeeRole.deleteMany({
      where: {
        employeeId,
        roleId,
      },
    });
  };

  // Counter association
  const assignCounter = async (context: TenantContext, employeeId: string, counterId: string) => {
    const db = await getTenantDb(context);
    await findById(context, employeeId);

    const counter = await db.counter.findFirst({
      where: withTenantScope(context, { id: counterId }),
    });
    if (!counter) {
      throw new ResourceNotFoundError(`Counter '${counterId}' not found in this tenant`);
    }

    return db.counterEmployee.upsert({
      where: {
        counterId_employeeId: {
          counterId,
          employeeId,
        },
      },
      create: {
        counterId,
        employeeId,
        active: true,
      },
      update: {
        active: true,
      },
      include: {
        counter: true,
      },
    });
  };

  const removeCounter = async (context: TenantContext, employeeId: string, counterId: string) => {
    const db = await getTenantDb(context);
    await findById(context, employeeId);

    return db.counterEmployee.deleteMany({
      where: {
        counterId,
        employeeId,
      },
    });
  };

  return {
    findById,
    findByCode,
    findMany,
    create,
    update,
    delete: deleteEmployee,
    assignBranch,
    removeBranch,
    assignService,
    removeService,
    assignRole,
    removeRole,
    assignCounter,
    removeCounter,
  };
};

export type EmployeeRepository = ReturnType<typeof createEmployeeRepository>;


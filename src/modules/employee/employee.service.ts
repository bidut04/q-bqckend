import { TenantContext } from "../../core/tenant/tenant-context";
import { Authorizer } from "../../core/authorization/authorizer";
import { Permission } from "../../core/authorization/permissions";
import { EmployeeRepository } from "../../repository/employee.repository";
import {
  CreateEmployeeDTO,
  UpdateEmployeeDTO,
  AssignBranchDTO,
  AssignServiceDTO,
  AssignRoleDTO,
  EmployeeFilterQuery,
} from "./employee.types";

export const createEmployeeService = (employeeRepo: EmployeeRepository) => {
  const getEmployees = async (context: TenantContext, query: EmployeeFilterQuery) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_READ);
    return employeeRepo.findMany(context, query);
  };

  const getEmployeeById = async (context: TenantContext, id: string) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_READ);
    return employeeRepo.findById(context, id);
  };

  const createEmployee = async (context: TenantContext, data: CreateEmployeeDTO) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_CREATE);

    // If initial branch assignment specified, verify branch authorization
    if (data.locationId && !Authorizer.isBranchAuthorized(context, data.locationId)) {
      Authorizer.authorize(context, Permission.EMPLOYEE_CREATE, {
        tenantId: context.tenantId,
        branchId: data.locationId,
      });
    }

    // If initial role assignment specified, verify role assignment permission
    if (data.roleId) {
      Authorizer.authorize(context, Permission.ROLE_ASSIGN);
    }

    return employeeRepo.create(context, data);
  };

  const updateEmployee = async (context: TenantContext, id: string, data: UpdateEmployeeDTO) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    return employeeRepo.update(context, id, data);
  };

  const deleteEmployee = async (context: TenantContext, id: string) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_DELETE);
    return employeeRepo.delete(context, id);
  };

  const assignBranch = async (context: TenantContext, employeeId: string, data: AssignBranchDTO) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.BRANCH_UPDATE, {
      tenantId: context.tenantId,
      branchId: data.locationId,
    });
    return employeeRepo.assignBranch(context, employeeId, data.locationId, data.isPrimary);
  };

  const removeBranch = async (context: TenantContext, employeeId: string, locationId: string) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.BRANCH_UPDATE, {
      tenantId: context.tenantId,
      branchId: locationId,
    });
    return employeeRepo.removeBranch(context, employeeId, locationId);
  };

  const assignService = async (context: TenantContext, employeeId: string, data: AssignServiceDTO) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.BRANCH_UPDATE, {
      tenantId: context.tenantId,
      branchId: data.locationId,
    });
    return employeeRepo.assignService(context, employeeId, data.locationId, data.serviceId);
  };

  const removeService = async (
    context: TenantContext,
    employeeId: string,
    locationId: string,
    serviceId: string
  ) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.BRANCH_UPDATE, {
      tenantId: context.tenantId,
      branchId: locationId,
    });
    return employeeRepo.removeService(context, employeeId, locationId, serviceId);
  };

  const assignRole = async (context: TenantContext, employeeId: string, data: AssignRoleDTO) => {
    Authorizer.authorize(context, Permission.ROLE_ASSIGN);
    return employeeRepo.assignRole(context, employeeId, data.roleId);
  };

  const removeRole = async (context: TenantContext, employeeId: string, roleId: string) => {
    Authorizer.authorize(context, Permission.ROLE_ASSIGN);
    return employeeRepo.removeRole(context, employeeId, roleId);
  };

  const assignCounter = async (context: TenantContext, employeeId: string, counterId: string) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.COUNTER_UPDATE);
    return employeeRepo.assignCounter(context, employeeId, counterId);
  };

  const removeCounter = async (context: TenantContext, employeeId: string, counterId: string) => {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.COUNTER_UPDATE);
    return employeeRepo.removeCounter(context, employeeId, counterId);
  };

  return {
    getEmployees,
    getEmployeeById,
    createEmployee,
    updateEmployee,
    deleteEmployee,
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

export type EmployeeService = ReturnType<typeof createEmployeeService>;

export const EmployeeService = function (this: unknown, employeeRepo: EmployeeRepository) {
  return createEmployeeService(employeeRepo);
} as unknown as {
  new (employeeRepo: EmployeeRepository): ReturnType<typeof createEmployeeService>;
};



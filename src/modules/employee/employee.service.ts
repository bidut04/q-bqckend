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

export class EmployeeService {
  constructor(private readonly employeeRepo: EmployeeRepository) {}

  public async getEmployees(context: TenantContext, query: EmployeeFilterQuery) {
    Authorizer.authorize(context, Permission.EMPLOYEE_READ);
    return this.employeeRepo.findMany(context, query);
  }

  public async getEmployeeById(context: TenantContext, id: string) {
    Authorizer.authorize(context, Permission.EMPLOYEE_READ);
    return this.employeeRepo.findById(context, id);
  }

  public async createEmployee(context: TenantContext, data: CreateEmployeeDTO) {
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

    return this.employeeRepo.create(context, data);
  }

  public async updateEmployee(context: TenantContext, id: string, data: UpdateEmployeeDTO) {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    return this.employeeRepo.update(context, id, data);
  }

  public async deleteEmployee(context: TenantContext, id: string) {
    Authorizer.authorize(context, Permission.EMPLOYEE_DELETE);
    return this.employeeRepo.delete(context, id);
  }

  public async assignBranch(context: TenantContext, employeeId: string, data: AssignBranchDTO) {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.BRANCH_UPDATE, {
      tenantId: context.tenantId,
      branchId: data.locationId,
    });
    return this.employeeRepo.assignBranch(context, employeeId, data.locationId, data.isPrimary);
  }

  public async removeBranch(context: TenantContext, employeeId: string, locationId: string) {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.BRANCH_UPDATE, {
      tenantId: context.tenantId,
      branchId: locationId,
    });
    return this.employeeRepo.removeBranch(context, employeeId, locationId);
  }

  public async assignService(context: TenantContext, employeeId: string, data: AssignServiceDTO) {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.BRANCH_UPDATE, {
      tenantId: context.tenantId,
      branchId: data.locationId,
    });
    return this.employeeRepo.assignService(context, employeeId, data.locationId, data.serviceId);
  }

  public async removeService(
    context: TenantContext,
    employeeId: string,
    locationId: string,
    serviceId: string
  ) {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.BRANCH_UPDATE, {
      tenantId: context.tenantId,
      branchId: locationId,
    });
    return this.employeeRepo.removeService(context, employeeId, locationId, serviceId);
  }

  public async assignRole(context: TenantContext, employeeId: string, data: AssignRoleDTO) {
    Authorizer.authorize(context, Permission.ROLE_ASSIGN);
    return this.employeeRepo.assignRole(context, employeeId, data.roleId);
  }

  public async removeRole(context: TenantContext, employeeId: string, roleId: string) {
    Authorizer.authorize(context, Permission.ROLE_ASSIGN);
    return this.employeeRepo.removeRole(context, employeeId, roleId);
  }

  public async assignCounter(context: TenantContext, employeeId: string, counterId: string) {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.COUNTER_UPDATE);
    return this.employeeRepo.assignCounter(context, employeeId, counterId);
  }

  public async removeCounter(context: TenantContext, employeeId: string, counterId: string) {
    Authorizer.authorize(context, Permission.EMPLOYEE_UPDATE);
    Authorizer.authorize(context, Permission.COUNTER_UPDATE);
    return this.employeeRepo.removeCounter(context, employeeId, counterId);
  }
}


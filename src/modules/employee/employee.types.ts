import { EmployeeStatus } from "@prisma/client";

export interface CreateEmployeeDTO {
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

export interface UpdateEmployeeDTO {
  name?: string;
  email?: string;
  phone?: string;
  department?: string;
  status?: EmployeeStatus;
  userId?: string;
}

export interface AssignBranchDTO {
  locationId: string;
  isPrimary?: boolean;
}

export interface AssignServiceDTO {
  locationId: string;
  serviceId: string;
}

export interface AssignRoleDTO {
  roleId: string;
}

export interface AssignCounterDTO {
  counterId: string;
}

export interface EmployeeFilterQuery {
  locationId?: string;
  department?: string;
  status?: EmployeeStatus;
  search?: string;
  page?: number;
  limit?: number;
}

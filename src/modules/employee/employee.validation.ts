import { z } from "zod";
import { EmployeeStatus } from "@prisma/client";

const statusEnum = z.preprocess((val) => {
  if (typeof val === "string") {
    const upper = val.toUpperCase().trim();
    if (upper === "ACTIVE" || upper === "ON LEAVE" || upper === "ON_LEAVE") return EmployeeStatus.ACTIVE;
    if (upper === "INACTIVE") return EmployeeStatus.INACTIVE;
    if (upper === "SUSPENDED") return EmployeeStatus.SUSPENDED;
    if (upper === "TERMINATED") return EmployeeStatus.TERMINATED;
    if (upper === "INVITED") return EmployeeStatus.INVITED;
    return upper;
  }
  return val;
}, z.nativeEnum(EmployeeStatus));

export const createEmployeeSchema = z
  .object({
    employeeCode: z.string().min(1).max(50).optional(),
    employeeId: z.string().min(1).max(50).optional(),
    name: z.string().min(1).max(100),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().max(30).optional().or(z.literal("")),
    department: z.string().max(100).optional(),
    branch: z.string().optional(),
    role: z.string().optional(),
    status: statusEnum.optional(),
    userId: z.string().min(1).optional(),
    locationId: z.string().min(1).optional(),
    roleId: z.string().min(1).optional(),
  })
  .transform((data) => ({
    ...data,
    employeeCode: data.employeeCode || data.employeeId || `EMP-${Date.now().toString().slice(-4)}`,
    email: data.email || undefined,
    phone: data.phone || undefined,
  }));

export const updateEmployeeSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().max(30).optional().or(z.literal("")),
    department: z.string().max(100).optional(),
    branch: z.string().optional(),
    role: z.string().optional(),
    locationId: z.string().min(1).optional(),
    roleId: z.string().min(1).optional(),
    status: statusEnum.optional(),
    userId: z.string().min(1).optional(),
  })
  .transform((data) => ({
    ...data,
    email: data.email || undefined,
    phone: data.phone || undefined,
  }));

export const assignBranchSchema = z.object({
  locationId: z.string().min(1),
  isPrimary: z.boolean().optional(),
});

export const assignServiceSchema = z.object({
  locationId: z.string().min(1),
  serviceId: z.string().min(1),
});

export const assignRoleSchema = z.object({
  roleId: z.string().min(1),
});

export const assignCounterSchema = z.object({
  counterId: z.string().min(1),
});

export const employeeQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  department: z.string().optional(),
  status: statusEnum.optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

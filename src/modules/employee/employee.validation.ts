import { z } from "zod";
import { EmployeeStatus } from "@prisma/client";

export const createEmployeeSchema = z.object({
  employeeCode: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  department: z.string().max(100).optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
  userId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  roleId: z.string().uuid().optional(),
});

export const updateEmployeeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  department: z.string().max(100).optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
  userId: z.string().uuid().optional(),
});

export const assignBranchSchema = z.object({
  locationId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
});

export const assignServiceSchema = z.object({
  locationId: z.string().uuid(),
  serviceId: z.string().uuid(),
});

export const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
});

export const assignCounterSchema = z.object({
  counterId: z.string().uuid(),
});

export const employeeQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  department: z.string().optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

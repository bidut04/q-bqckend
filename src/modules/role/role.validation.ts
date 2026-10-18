import { z } from "zod";
import { ScopeType } from "@prisma/client";

export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  maxScope: z.nativeEnum(ScopeType).optional(),
  permissionKeys: z.array(z.string()).optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  maxScope: z.nativeEnum(ScopeType).optional(),
});

export const assignPermissionSchema = z.object({
  permissionKey: z.string().min(1).max(100),
});

export const scopedRoleAssignmentSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: z.nativeEnum(ScopeType),
  scopeId: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});

export const checkPermissionsQuerySchema = z.object({
  userId: z.string().uuid(),
  scopeType: z.nativeEnum(ScopeType).optional(),
  scopeId: z.string().optional(),
});

import { Request, Response, NextFunction } from "express";
import { RoleService } from "./role.service";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";
import {
  createRoleSchema,
  updateRoleSchema,
  assignPermissionSchema,
  scopedRoleAssignmentSchema,
  checkPermissionsQuerySchema,
} from "./role.validation";

const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param ?? "";
};

export const createRoleController = (roleService: RoleService) => {
  const getRoles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const result = await roleService.getRoles(context);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const getRoleById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = getParam(req.params.id);
      const result = await roleService.getRoleById(context, id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const createRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const data = createRoleSchema.parse(req.body);
      const result = await roleService.createRole(context, data);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const updateRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = getParam(req.params.id);
      const data = updateRoleSchema.parse(req.body);
      const result = await roleService.updateRole(context, id, data);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const deleteRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = getParam(req.params.id);
      const result = await roleService.deleteRole(context, id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const assignPermission = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const roleId = getParam(req.params.id);
      const data = assignPermissionSchema.parse(req.body);
      const result = await roleService.assignPermission(context, roleId, data);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const removePermission = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const roleId = getParam(req.params.id);
      const permissionKey = getParam(req.params.permissionKey);
      const result = await roleService.removePermission(context, roleId, permissionKey);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const assignScopedRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const data = scopedRoleAssignmentSchema.parse(req.body);
      const result = await roleService.assignScopedRole(context, data);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const removeScopedRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const assignmentId = getParam(req.params.assignmentId);
      const result = await roleService.removeScopedRole(context, assignmentId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const getUserRoleAssignments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const userId = getParam(req.params.userId);
      const result = await roleService.getUserRoleAssignments(context, userId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const getEffectivePermissions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const query = checkPermissionsQuerySchema.parse(req.query);
      const result = await roleService.getEffectivePermissions(context, query);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const getAvailablePermissions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const result = await roleService.getAvailablePermissions(context);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  return {
    getRoles,
    getRoleById,
    createRole,
    updateRole,
    deleteRole,
    assignPermission,
    removePermission,
    assignScopedRole,
    removeScopedRole,
    getUserRoleAssignments,
    getEffectivePermissions,
    getAvailablePermissions,
  };
};

export type RoleController = ReturnType<typeof createRoleController>;

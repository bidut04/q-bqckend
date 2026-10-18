import { Request, Response, NextFunction } from "express";
import { EmployeeService } from "./employee.service";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  assignBranchSchema,
  assignServiceSchema,
  assignRoleSchema,
  assignCounterSchema,
  employeeQuerySchema,
} from "./employee.validation";

const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param ?? "";
};

export const createEmployeeController = (employeeService: EmployeeService) => {
  const getEmployees = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const query = employeeQuerySchema.parse(req.query);
      const result = await employeeService.getEmployees(context, query);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const getEmployeeById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = getParam(req.params.id);
      const result = await employeeService.getEmployeeById(context, id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const createEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const data = createEmployeeSchema.parse(req.body);
      const result = await employeeService.createEmployee(context, data);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const updateEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = getParam(req.params.id);
      const data = updateEmployeeSchema.parse(req.body);
      const result = await employeeService.updateEmployee(context, id, data);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const deleteEmployee = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = getParam(req.params.id);
      const result = await employeeService.deleteEmployee(context, id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const assignBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const employeeId = getParam(req.params.id);
      const data = assignBranchSchema.parse(req.body);
      const result = await employeeService.assignBranch(context, employeeId, data);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const removeBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const employeeId = getParam(req.params.id);
      const branchId = getParam(req.params.branchId);
      const result = await employeeService.removeBranch(context, employeeId, branchId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const assignService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const employeeId = getParam(req.params.id);
      const data = assignServiceSchema.parse(req.body);
      const result = await employeeService.assignService(context, employeeId, data);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const removeService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const employeeId = getParam(req.params.id);
      const branchId = getParam(req.params.branchId);
      const serviceId = getParam(req.params.serviceId);
      const result = await employeeService.removeService(context, employeeId, branchId, serviceId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const assignRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const employeeId = getParam(req.params.id);
      const data = assignRoleSchema.parse(req.body);
      const result = await employeeService.assignRole(context, employeeId, data);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const removeRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const employeeId = getParam(req.params.id);
      const roleId = getParam(req.params.roleId);
      const result = await employeeService.removeRole(context, employeeId, roleId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const assignCounter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const employeeId = getParam(req.params.id);
      const data = assignCounterSchema.parse(req.body);
      const result = await employeeService.assignCounter(context, employeeId, data.counterId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const removeCounter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const employeeId = getParam(req.params.id);
      const counterId = getParam(req.params.counterId);
      const result = await employeeService.removeCounter(context, employeeId, counterId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
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

export type EmployeeController = ReturnType<typeof createEmployeeController>;


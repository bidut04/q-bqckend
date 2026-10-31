import { Request, Response, NextFunction } from "express";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";
import { BranchRepository } from "../../repository/branch.repository";

const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0];
  return param ?? "";
};

export const createBranchController = (branchRepo: BranchRepository) => {
  const getBranches = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const branches = await branchRepo.findAllForTenant(context);
      res.status(200).json({ success: true, data: branches });
    } catch (error) {
      next(error);
    }
  };

  const getBranchById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = getParam(req.params.id);
      const branch = await branchRepo.findById(context, id);
      res.status(200).json({ success: true, data: branch });
    } catch (error) {
      next(error);
    }
  };

  const createBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const branch = await branchRepo.create(context, req.body);
      res.status(201).json({ success: true, data: branch });
    } catch (error) {
      next(error);
    }
  };

  const updateBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = getParam(req.params.id);
      const branch = await branchRepo.update(context, id, req.body);
      res.status(200).json({ success: true, data: branch });
    } catch (error) {
      next(error);
    }
  };

  const deleteBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = getParam(req.params.id);
      await branchRepo.delete(context, id);
      res.status(200).json({ success: true, message: "Branch deleted successfully" });
    } catch (error) {
      next(error);
    }
  };

  return {
    getBranches,
    getBranchById,
    createBranch,
    updateBranch,
    deleteBranch,
  };
};

export type BranchController = ReturnType<typeof createBranchController>;


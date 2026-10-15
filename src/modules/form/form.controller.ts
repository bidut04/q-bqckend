import { Request, Response, NextFunction } from "express";
import { FormRepository } from "./form.repository";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";

export const createFormController = (deps: {
  formRepository: FormRepository;
}) => {
  const getFormById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const form = await deps.formRepository.findFormById(context, req.params.id as string);
      res.status(200).json({ success: true, data: form });
    } catch (error) {
      next(error);
    }
  };

  const getPublishedForm = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const branchId = req.query.branchId as string;
      const serviceId = req.query.serviceId as string;
      const form = await deps.formRepository.findPublishedFormForBranchAndService(
        context,
        branchId,
        serviceId
      );
      res.status(200).json({ success: true, data: form });
    } catch (error) {
      next(error);
    }
  };

  return {
    getFormById,
    getPublishedForm,
  };
};

export type FormController = ReturnType<typeof createFormController>;

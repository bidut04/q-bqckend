import { Request, Response, NextFunction } from "express";
import { OrganizationService } from "./organization.service";
import { OrganizationRepository } from "../../repository/organization.repository";
import { AuthUser } from "../../common/types";

export const createOrganizationController = (deps: {
  organizationService: OrganizationService;
  organizationRepository: OrganizationRepository;
}) => {
  const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser | undefined = req.user
        ? {
            id: req.user.id,
            email: req.user.email,
            role: req.user.role,
            tenantId: req.user.tenantId,
          }
        : undefined;

      const result = await deps.organizationService.registerOrganization(req.body, actor);

      res.status(201).json({
        success: true,
        message: result.message || "Organization registered successfully. Confirmation email dispatched to admin.",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId, email, otp } = req.body;
      const result = await deps.organizationService.verifyOrganizationEmail({
        organizationId,
        email,
        otp,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser = {
        id: req.user?.id || "anonymous",
        email: req.user?.email,
        role: req.user?.role || "USER",
        tenantId: req.user?.tenantId,
      };

      const result = await deps.organizationService.getOrganizationById(req.params.id as string, actor);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const approve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser = {
        id: req.user?.id || "anonymous",
        email: req.user?.email,
        role: req.user?.role || "USER",
        tenantId: req.user?.tenantId,
      };

      const result = await deps.organizationService.approveOrganization(
        req.params.id as string,
        actor,
        req.body?.notes
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const reject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser = {
        id: req.user?.id || "anonymous",
        email: req.user?.email,
        role: req.user?.role || "USER",
        tenantId: req.user?.tenantId,
      };

      const result = await deps.organizationService.rejectOrganization(
        req.params.id as string,
        actor,
        req.body?.reason
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const listPending = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser = {
        id: req.user?.id || "anonymous",
        email: req.user?.email,
        role: req.user?.role || "USER",
        tenantId: req.user?.tenantId,
      };

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const cursor = req.query.cursor as string | undefined;

      const result = await deps.organizationService.listPendingOrganizations(actor, { limit, cursor });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  return {
    register,
    verifyOtp,
    approve,
    reject,
    listPending,
    getById,
  };
};

export type OrganizationController = ReturnType<typeof createOrganizationController>;
export const OrganizationController = createOrganizationController;

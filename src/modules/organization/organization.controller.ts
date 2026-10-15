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
        message: "Organization registered successfully. Verification OTP dispatched to organization email.",
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

  return {
    register,
    verifyOtp,
    getById,
  };
};

export type OrganizationController = ReturnType<typeof createOrganizationController>;
export const OrganizationController = createOrganizationController;

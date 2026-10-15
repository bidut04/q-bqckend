import { Router } from "express";
import { OrganizationController } from "./organization.controller";
import { requireAuth } from "../../middleware/auth.middleware";

export const createOrganizationRouter = (controller: OrganizationController) => {
  const router = Router();

  // Public / Semi-public: organization admin registers a new organization
  router.post("/", controller.register);
  router.post("/register", controller.register);

  // Verify OTP sent to organization email
  router.post("/verify-otp", controller.verifyOtp);

  // Authenticated: view organization profile
  router.get("/:id", requireAuth, controller.getById);

  return router;
};

export default createOrganizationRouter;

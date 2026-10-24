import { Router } from "express";
import { OrganizationController } from "./organization.controller";
import { requireAuth } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { publicBookingRateLimiter } from "../../middleware/rate-limit.middleware";

export const createOrganizationRouter = (controller: OrganizationController) => {
  const router = Router();

  // Public: Portal list of active organizations
  router.get("/", controller.listPublic);
  router.get("/:id/services", controller.listTenantServices);
  router.get("/:id/branches", controller.listTenantBranches);
  router.post("/:id/book-token", publicBookingRateLimiter, controller.bookPublicToken);

  // Public / Semi-public: organization admin registers a new organization
  router.post("/register", controller.register);

  // Verify OTP sent to organization email (optional verification)
  router.post("/verify-otp", controller.verifyOtp);

  // Super Admin: List organizations pending approval
  router.get("/pending-approval", requireAuth, requireAdmin, controller.listPending);

  // Super Admin: Review decisions (Approve / Reject)
  router.post("/:id/approve", requireAuth, requireAdmin, controller.approve);
  router.post("/:id/reject", requireAuth, requireAdmin, controller.reject);

  // Super Admin / Creator: View immutable review audit logs
  router.get("/:id/review-logs", requireAuth, controller.getReviewLogs);

  // Authenticated: view organization profile
  router.get("/:id", requireAuth, controller.getById);

  return router;
};

export default createOrganizationRouter;

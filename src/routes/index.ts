import { Router } from "express";
import { authRouter } from "./auth.routes";
import mediaRouter from "../modules/media/media.routes";
import { createBookingRouter } from "../modules/booking/booking.routes";
import { createQueueRouter } from "../modules/queue/queue.routes";
import { createFormRouter } from "../modules/form/form.routes";
import { createOrganizationRouter } from "../modules/organization/organization.routes";
import { createPlatformRouter } from "../modules/platform/platform.routes";
import { createEmployeeRouter } from "../modules/employee/employee.routes";
import { createRoleRouter } from "../modules/role/role.routes";
import { createBranchRouter } from "../modules/branch/branch.routes";
import { createDepartmentRouter } from "../modules/department/department.routes";
import { createServiceRouter } from "../modules/service/service.routes";
import { createCategoryRouter } from "../modules/category/category.routes";
import { paymentRouter } from "../modules/payment/payment.routes";
import { webhookRouter } from "../modules/webhook/webhook.routes";
import { container } from "../config/container";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import { tenantShardingMiddleware } from "../middleware/tenant.middleware";

export const apiRouter = Router();

// Public Authentication & Password/OTP routes
apiRouter.use("/auth", authRouter);

// Platform Super Admin / Control Plane routes
apiRouter.use("/platform", createPlatformRouter(container.controllers.platform));

// Organizations routes (Registration & OTP verification)
apiRouter.use("/organizations", createOrganizationRouter(container.controllers.organization));

// Webhooks (Public endpoint with signature / event idempotency)
apiRouter.use("/webhooks", webhookRouter);

// Protected routes: requires Authentication (requireAuth) & Authorization (requireAdmin)
apiRouter.use("/media", requireAuth, requireAdmin, mediaRouter);

// Module routes (Protected: requireAuth & tenantShardingMiddleware)
apiRouter.use("/bookings", requireAuth, tenantShardingMiddleware, createBookingRouter(container.controllers.booking));
apiRouter.use("/payments", requireAuth, tenantShardingMiddleware, paymentRouter);
apiRouter.use("/queue", requireAuth, tenantShardingMiddleware, createQueueRouter(container.controllers.queue));
apiRouter.use("/forms", requireAuth, tenantShardingMiddleware, createFormRouter(container.controllers.form));
apiRouter.use("/employees", requireAuth, tenantShardingMiddleware, createEmployeeRouter(container.controllers.employee));
apiRouter.use("/roles", requireAuth, tenantShardingMiddleware, createRoleRouter(container.controllers.role));
apiRouter.use("/branches", requireAuth, tenantShardingMiddleware, createBranchRouter(container.controllers.branch));
apiRouter.use("/departments", requireAuth, tenantShardingMiddleware, createDepartmentRouter(container.controllers.department));
apiRouter.use("/services", requireAuth, tenantShardingMiddleware, createServiceRouter(container.controllers.service));
apiRouter.use("/categories", requireAuth, tenantShardingMiddleware, createCategoryRouter(container.controllers.category));

export default apiRouter;


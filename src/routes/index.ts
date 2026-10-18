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
import { container } from "../config/container";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin.middleware";

export const apiRouter = Router();

// Public Authentication & Password/OTP routes
apiRouter.use("/auth", authRouter);

// Platform Super Admin / Control Plane routes
apiRouter.use("/platform", createPlatformRouter(container.controllers.platform));

// Organizations routes (Registration & OTP verification)
apiRouter.use("/organizations", createOrganizationRouter(container.controllers.organization));

// Protected routes: requires Authentication (requireAuth) & Authorization (requireAdmin)
apiRouter.use("/media", requireAuth, requireAdmin, mediaRouter);

// Module routes (Protected: requireAuth)
apiRouter.use("/bookings", requireAuth, createBookingRouter(container.controllers.booking));
apiRouter.use("/queue", requireAuth, createQueueRouter(container.controllers.queue));
apiRouter.use("/forms", requireAuth, createFormRouter(container.controllers.form));
apiRouter.use("/employees", requireAuth, createEmployeeRouter(container.controllers.employee));
apiRouter.use("/roles", requireAuth, createRoleRouter(container.controllers.role));

export default apiRouter;


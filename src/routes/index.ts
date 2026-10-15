import { Router } from "express";
import { authRouter } from "./auth.routes";
import mediaRouter from "../modules/media/media.routes";
import { createBookingRouter } from "../modules/booking/booking.routes";
import { createQueueRouter } from "../modules/queue/queue.routes";
import { createFormRouter } from "../modules/form/form.routes";
import { createOrganizationRouter } from "../modules/organization/organization.routes";
import { container } from "../config/container";
import { requireAuth } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin.middleware";

export const apiRouter = Router();

// Public Authentication & Password/OTP routes
apiRouter.use("/auth", authRouter);

// Organizations routes (Registration & OTP verification)
apiRouter.use("/organizations", createOrganizationRouter(container.controllers.organization));

// Protected routes: requires Authentication (requireAuth) & Authorization (requireAdmin)
apiRouter.use("/media", requireAuth, requireAdmin, mediaRouter);

// Module routes (Protected: requireAuth)
apiRouter.use("/bookings", requireAuth, createBookingRouter(container.controllers.booking));
apiRouter.use("/queue", requireAuth, createQueueRouter(container.controllers.queue));
apiRouter.use("/forms", requireAuth, createFormRouter(container.controllers.form));

export default apiRouter;

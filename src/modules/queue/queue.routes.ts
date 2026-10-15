import { Router } from "express";
import { QueueController } from "./queue.controller";

export const createQueueRouter = (controller: QueueController) => {
  const router = Router();

  router.get("/branch/:branchId/active", controller.getActiveByBranch);
  router.get("/entries/:id", controller.getEntryById);
  router.post("/entries/:id/call", controller.callEntry);
  router.post("/entries/:id/start", controller.startService);
  router.post("/entries/:id/complete", controller.completeService);
  router.post("/entries/:id/no-show", controller.markNoShow);
  router.post("/entries/:id/cancel", controller.cancelEntry);

  return router;
};

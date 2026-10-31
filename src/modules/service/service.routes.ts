import { Router } from "express";
import { ServiceController } from "./service.controller";

export const createServiceRouter = (serviceController: ServiceController): Router => {
  const router = Router();

  router.get("/", serviceController.getServices);
  router.post("/", serviceController.createService);
  router.get("/:id", serviceController.getServiceById);
  router.patch("/:id", serviceController.updateService);
  router.delete("/:id", serviceController.deleteService);

  return router;
};


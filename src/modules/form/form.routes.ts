import { Router } from "express";
import { FormController } from "./form.controller";

export const createFormRouter = (controller: FormController) => {
  const router = Router();

  router.get("/published", controller.getPublishedForm);
  router.get("/:id", controller.getFormById);

  return router;
};

import { Router } from "express";
import { DepartmentController } from "./department.controller";

export const createDepartmentRouter = (controller: DepartmentController) => {
  const router = Router();

  router.get("/", controller.getDepartments);
  router.get("/:id", controller.getDepartmentById);
  router.post("/", controller.createDepartment);
  router.patch("/:id", controller.updateDepartment);
  router.delete("/:id", controller.deleteDepartment);

  return router;
};


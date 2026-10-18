import { Router } from "express";
import { EmployeeController } from "./employee.controller";

export const createEmployeeRouter = (controller: EmployeeController) => {
  const router = Router();

  router.get("/", controller.getEmployees);
  router.post("/", controller.createEmployee);

  router.get("/:id", controller.getEmployeeById);
  router.patch("/:id", controller.updateEmployee);
  router.delete("/:id", controller.deleteEmployee);

  // Branch associations
  router.post("/:id/branches", controller.assignBranch);
  router.delete("/:id/branches/:branchId", controller.removeBranch);

  // Service associations
  router.post("/:id/services", controller.assignService);
  router.delete("/:id/branches/:branchId/services/:serviceId", controller.removeService);

  // Role associations
  router.post("/:id/roles", controller.assignRole);
  router.delete("/:id/roles/:roleId", controller.removeRole);

  // Counter associations
  router.post("/:id/counters", controller.assignCounter);
  router.delete("/:id/counters/:counterId", controller.removeCounter);

  return router;
};


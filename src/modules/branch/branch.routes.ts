import { Router } from "express";
import { BranchController } from "./branch.controller";

export const createBranchRouter = (controller: BranchController) => {
  const router = Router();

  router.get("/", controller.getBranches);
  router.get("/:id", controller.getBranchById);
  router.post("/", controller.createBranch);
  router.patch("/:id", controller.updateBranch);
  router.delete("/:id", controller.deleteBranch);

  return router;
};


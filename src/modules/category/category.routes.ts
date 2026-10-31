import { Router } from "express";
import { CategoryController } from "./category.controller";

export const createCategoryRouter = (categoryController: CategoryController): Router => {
  const router = Router();

  router.get("/", categoryController.getCategories);
  router.post("/", categoryController.createCategory);
  router.get("/:id", categoryController.getCategoryById);
  router.patch("/:id", categoryController.updateCategory);
  router.delete("/:id", categoryController.deleteCategory);

  return router;
};


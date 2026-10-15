import { Router } from "express";
import { BookingController } from "./booking.controller";

export const createBookingRouter = (controller: BookingController) => {
  const router = Router();

  router.post("/", controller.create);
  router.get("/:id", controller.getById);
  router.get("/branch/:branchId", controller.getByBranch);

  return router;
};

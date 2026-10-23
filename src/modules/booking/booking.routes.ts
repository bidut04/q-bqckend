import { Router } from "express";
import { BookingController } from "./booking.controller";

export const createBookingRouter = (controller: BookingController) => {
  const router = Router();

  router.post("/", controller.create);
  router.get("/", controller.getAll);
  router.get("/:id", controller.getById);
  router.get("/branch/:branchId", controller.getByBranch);
  router.post("/:id/check-in", controller.checkIn);
  router.post("/:id/cancel", controller.cancel);
  router.post("/:id/complete", controller.complete);

  return router;
};

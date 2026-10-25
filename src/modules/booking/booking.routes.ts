import { Router } from "express";
import { BookingController } from "./booking.controller";
import { enforceIdempotency } from "../../middleware/idempotency";

export const createBookingRouter = (controller: BookingController) => {
  const router = Router();

  router.post("/", enforceIdempotency(), controller.create);
  router.get("/", controller.getAll);
  router.get("/:id", controller.getById);
  router.get("/branch/:branchId", controller.getByBranch);
  router.post("/:id/check-in", controller.checkIn);
  router.post("/:id/cancel", controller.cancel);
  router.post("/:id/complete", controller.complete);

  return router;
};

import { Router } from "express";
import { BookingController } from "./booking.controller";
import { enforceIdempotency } from "../../middleware/idempotency";

export const createBookingRouter = (controller: BookingController) => {
  const router = Router();

  router.post("/", enforceIdempotency({ scope: "BOOKING_CREATE" }), controller.create);
  router.get("/", controller.getAll);
  router.get("/:id", controller.getById);
  router.get("/branch/:branchId", controller.getByBranch);
  router.post("/:id/check-in", controller.checkIn);
  router.post("/:id/cancel", enforceIdempotency({ scope: "BOOKING_CANCEL" }), controller.cancel);
  router.post("/:id/complete", enforceIdempotency({ scope: "BOOKING_COMPLETE" }), controller.complete);

  return router;
};

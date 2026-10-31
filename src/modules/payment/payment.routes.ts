import { Router } from "express";
import { PaymentController, createPaymentController } from "./payment.controller";
import { enforceIdempotency } from "../../middleware/idempotency";

export const createPaymentRouter = (controller: PaymentController = createPaymentController()) => {
  const router = Router();

  // Strict idempotency for financial charges & debits
  router.post(
    "/charge",
    enforceIdempotency({ scope: "PAYMENT_CHARGE", ttlSeconds: 86400 * 7 }),
    controller.charge
  );

  // Strict idempotency for refunds
  router.post(
    "/refund",
    enforceIdempotency({ scope: "PAYMENT_REFUND", ttlSeconds: 86400 * 7 }),
    controller.refund
  );

  return router;
};

export const paymentRouter = createPaymentRouter();


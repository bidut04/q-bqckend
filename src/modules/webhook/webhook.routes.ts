import { Router, Request, Response, NextFunction } from "express";
import { enforceIdempotency } from "../../middleware/idempotency";

export const webhookRouter = Router();

// Middleware to extract provider event ID (e.g. Stripe, Razorpay, Brevo) into Idempotency-Key header if missing
const normalizeWebhookIdempotencyHeader = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.headers["idempotency-key"] && !req.headers["x-idempotency-key"]) {
    const providerEventId =
      req.headers["stripe-event-id"] ||
      req.headers["x-webhook-id"] ||
      req.headers["x-event-id"] ||
      (req.body && typeof req.body.id === "string" ? req.body.id : undefined);

    if (providerEventId && typeof providerEventId === "string") {
      req.headers["idempotency-key"] = providerEventId.trim();
    }
  }
  next();
};

/**
 * Inbound webhook receiver guarded with strict idempotency to prevent duplicate event execution.
 */
webhookRouter.post(
  "/inbound",
  normalizeWebhookIdempotencyHeader,
  enforceIdempotency({ scope: "WEBHOOK_INBOUND", ttlSeconds: 86400 * 3 }),
  async (req: Request, res: Response): Promise<void> => {
    const event = req.body;
    console.log(`[WebhookReceiver] Inbound webhook event processed:`, event?.type || event?.event || "UNKNOWN");

    res.status(200).json({
      success: true,
      received: true,
      eventId: req.headers["idempotency-key"] || "anon",
      processedAt: new Date().toISOString(),
    });
  }
);


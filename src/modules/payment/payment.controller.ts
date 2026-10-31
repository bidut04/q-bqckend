import { Request, Response, NextFunction } from "express";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";

export interface ChargePaymentInput {
  bookingId?: string;
  amount: number;
  currency: string;
  paymentMethod: string;
}

export interface RefundPaymentInput {
  paymentId: string;
  amount?: number;
  reason: string;
}

export const createPaymentController = () => {
  const charge = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const { bookingId, amount, currency, paymentMethod } = req.body as ChargePaymentInput;

      if (!amount || amount <= 0) {
        res.status(400).json({
          success: false,
          code: "INVALID_AMOUNT",
          message: "Payment amount must be greater than zero.",
        });
        return;
      }

      // Simulated payment gateway processing
      const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const result = {
        paymentId,
        bookingId,
        amount,
        currency: currency || "INR",
        paymentMethod: paymentMethod || "CARD",
        status: "SETTLED",
        tenantId: context.tenantId,
        chargedAt: new Date().toISOString(),
      };

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  const refund = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const { paymentId, amount, reason } = req.body as RefundPaymentInput;

      if (!paymentId) {
        res.status(400).json({
          success: false,
          code: "PAYMENT_ID_REQUIRED",
          message: "Payment ID is required for refund processing.",
        });
        return;
      }

      // Simulated refund gateway processing
      const refundId = `ref_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const result = {
        refundId,
        paymentId,
        amount,
        reason: reason || "Customer request",
        status: "REFUNDED",
        tenantId: context.tenantId,
        refundedAt: new Date().toISOString(),
      };

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  return { charge, refund };
};

export type PaymentController = ReturnType<typeof createPaymentController>;


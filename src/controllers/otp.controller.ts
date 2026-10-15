import { Request, Response, NextFunction } from "express";
import { otpService } from "../service/otp.service";
import { AppError } from "../../utils/app-error";

export const otpController = {
  /**
   * POST /api/v1/auth/send-otp
   */
  async sendOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, purpose, name } = req.body;

      if (!email || typeof email !== "string") {
        throw new AppError("A valid email address is required", 400, "VALIDATION_ERROR");
      }

      const result = await otpService.sendOtp({
        email,
        purpose,
        recipientName: name,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/auth/verify-otp
   */
  async verifyOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        throw new AppError("Both email and otp are required", 400, "VALIDATION_ERROR");
      }

      const result = await otpService.verifyOtp({
        email,
        otp: String(otp),
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
};

export type OtpController = typeof otpController;

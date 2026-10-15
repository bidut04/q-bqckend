import { Router } from "express";
import { container } from "../config/container";
import { AuthController } from "../controllers/auth.controller";
import { OtpController } from "../controllers/otp.controller";

export const createAuthRouter = (deps: {
  authController: AuthController;
  otpController: OtpController;
}) => {
  const router = Router();

  router.post("/register", deps.authController.register);
  router.post("/login", deps.authController.login);
  router.post("/refresh", deps.authController.refresh);
  router.post("/logout", deps.authController.logout);
  router.post("/logout-all", deps.authController.logoutAll);
  router.post("/change-password", deps.authController.changePassword);

  // OTP Routes (Powered by Brevo Email)
  router.post("/send-otp", deps.otpController.sendOtp);
  router.post("/verify-otp", deps.otpController.verifyOtp);

  return router;
};

export const authRouter = createAuthRouter({
  authController: container.controllers.auth,
  otpController: container.controllers.otp,
});

export default authRouter;

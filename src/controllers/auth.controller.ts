import { Request, Response, NextFunction } from "express";
import { AuthService } from "../service/auth.service";
import { AppError } from "../../utils/app-error";
import { checkLoginRateLimit } from "../security/rate-limit";

import { AuthenticatedUser } from "../types/express";

export type { AuthenticatedUser };

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const createAuthController = (authService: AuthService) => {
  const setRefreshTokenCookie = (res: Response, token: string) => {
    res.cookie("refreshToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: "/api/v1/auth",
    });
  };

  const clearRefreshTokenCookie = (res: Response) => {
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/api/v1/auth",
    });
  };

  const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password, role } = req.body;

      if (!email || !password) {
        throw new AppError("Email and password are required", 400, "VALIDATION_ERROR");
      }

      if (password.length < 8) {
        throw new AppError("Password must be at least 8 characters long", 400, "INVALID_PASSWORD_LENGTH");
      }

      const ipAddress = req.ip;
      const userAgent = req.headers["user-agent"];

      const user = await authService.register({
        email,
        password,
        role,
        ipAddress,
        userAgent,
      });

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        user,
      });
    } catch (error) {
      next(error);
    }
  };

  const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new AppError("Email and password are required", 400, "VALIDATION_ERROR");
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"];

      // Rate limit check: prevents credential stuffing and brute force
      await checkLoginRateLimit(ipAddress, email.trim().toLowerCase());

      const result = await authService.login({
        email,
        password,
        ipAddress,
        userAgent,
      });

      if (result.requiresMfa) {
        res.status(200).json({
          success: true,
          requiresMfa: true,
          challengeId: result.challengeId,
        });
        return;
      }

      if (result.refreshToken) {
        setRefreshTokenCookie(res, result.refreshToken);
      }

      res.status(200).json({
        success: true,
        requiresMfa: false,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: result.user,
      });
    } catch (error) {
      next(error);
    }
  };

  const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

      if (!refreshToken) {
        throw new AppError("Refresh token is required", 401, "MISSING_REFRESH_TOKEN");
      }

      const ipAddress = req.ip;
      const userAgent = req.headers["user-agent"];

      const result = await authService.refresh({
        refreshToken,
        ipAddress,
        userAgent,
      });

      setRefreshTokenCookie(res, result.refreshToken);

      res.status(200).json({
        success: true,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      });
    } catch (error) {
      clearRefreshTokenCookie(res);
      next(error);
    }
  };

  const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      clearRefreshTokenCookie(res);

      res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      next(error);
    }
  };

  const logoutAll = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        throw new AppError("User authentication required", 401, "UNAUTHORIZED");
      }

      await authService.logoutAll(userId);
      clearRefreshTokenCookie(res);

      res.status(200).json({
        success: true,
        message: "All sessions logged out successfully",
      });
    } catch (error) {
      next(error);
    }
  };

  const changePassword = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      const { currentPassword, newPassword } = req.body;

      if (!userId) {
        throw new AppError("User authentication required", 401, "UNAUTHORIZED");
      }

      if (!currentPassword || !newPassword) {
        throw new AppError("Current password and new password are required", 400, "VALIDATION_ERROR");
      }

      if (newPassword.length < 8) {
        throw new AppError("Password must be at least 8 characters long", 400, "INVALID_PASSWORD_LENGTH");
      }

      const ipAddress = req.ip;
      const userAgent = req.headers["user-agent"];

      await authService.changePassword(userId, currentPassword, newPassword, {
        ipAddress,
        userAgent,
      });

      clearRefreshTokenCookie(res);

      res.status(200).json({
        success: true,
        message: "Password changed successfully. Please log in again.",
      });
    } catch (error) {
      next(error);
    }
  };

  const googleLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authUrl = authService.getGoogleAuthUrl();
      res.redirect(authUrl);
    } catch (error) {
      next(error);
    }
  };

  const googleCallback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      console.log("[Google OAuth Callback] Query params:", req.query);
      const { code, error } = req.query;
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

      if (error || !code) {
        const errorDesc = (req.query.error_description as string) || (error as string) || "OAuth access denied";
        console.warn("[Google OAuth Callback] Denied or missing code:", { error, errorDesc });
        res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(errorDesc)}`);
        return;
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"];

      const result = await authService.handleGoogleCallback({
        code: String(code),
        ipAddress,
        userAgent,
      });

      if (result.refreshToken) {
        setRefreshTokenCookie(res, result.refreshToken);
      }

      const userParam = encodeURIComponent(JSON.stringify(result.user));
      res.redirect(`${frontendUrl}/login?token=${encodeURIComponent(result.accessToken)}&user=${userParam}`);
    } catch (error: any) {
      console.error("[Google OAuth Callback Error]:", error);
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const errorMsg = error?.message || "Google authentication failed";
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(errorMsg)}`);
    }
  };

  const getMe = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
      }
      const userDetails = await authService.getUserProfile(userId);
      res.status(200).json({
        success: true,
        user: userDetails,
      });
    } catch (error) {
      next(error);
    }
  };

  const updateProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
      }
      const { name, email, avatar } = req.body;
      const updatedUser = await authService.updateUserProfile(userId, { name, email, avatar });
      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  };

  return {
    register,
    login,
    refresh,
    logout,
    logoutAll,
    changePassword,
    googleLogin,
    googleCallback,
    getMe,
    updateProfile,
  };
};

export type AuthController = ReturnType<typeof createAuthController>;





import { AuditAction, RevokeReason, Role } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { createAuthRepository } from "../repository/auth.repository";
import { createUserRepository } from "../repository/user.repository";
import { redisSecurityCache } from "./redis.service";
import { redis as redisClient } from "../redis/redis";
import { verifyPassword, hashPassword } from "../security/password";
import {
  generateFamilyId,
  generateId,
  generateRandomToken,
  hashToken,
} from "../security/token";
import { createAccessToken } from "../security/jwt";

export interface AuthServiceDeps {
  userRepository: ReturnType<typeof createUserRepository>;
  authRepository: ReturnType<typeof createAuthRepository>;
  redis: typeof redisClient;
  securityCache: typeof redisSecurityCache;
}

// Roles a client is ever allowed to self-select at registration time.
// Anything privileged (ADMIN, etc.) must be granted out-of-band, never from request input.
const SELF_REGISTERABLE_ROLES: Role[] = [Role.USER];

// A hash of a value nobody could ever have set, used purely to burn constant
// time on the "user not found" path so it matches the "wrong password" path.
const DUMMY_PASSWORD_HASH =
  "$2b$12$CwTycUXWue0Thq9StjUM0uJ8Q9Q8Q9Q8Q9Q8Q9Q8Q9Q8Q9Q8Q9Q8Q";

export const createAuthService = (deps: AuthServiceDeps) => {
  /**
   * --------------------------------------------------------------------------
   * REGISTER
   * --------------------------------------------------------------------------
   */
  const register = async (input: {
    email: string;
    password: string;
    role?: Role;
    ipAddress?: string;
    userAgent?: string;
  }) => {
    const email = input.email.trim().toLowerCase();

    // Only ever allow a caller to self-select from a safe allow-list.
    // Never trust arbitrary role strings from the client — privilege escalation risk.
    if (input.role && !SELF_REGISTERABLE_ROLES.includes(input.role)) {
      throw new AppError("Invalid role", 400, "INVALID_ROLE");
    }
    const role = input.role ?? Role.USER;

    const existingUser = await deps.userRepository.findByEmail(email);

    if (existingUser) {
      // Audit the attempt even though we don't reveal existence to the caller below.
      await deps.authRepository.createAuditLog({
        action: AuditAction.ACCOUNT_CREATED,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        details: { outcome: "DUPLICATE_EMAIL" },
      });
      // Generic message — avoids confirming whether the email is already registered.
      throw new AppError(
        "Unable to complete registration with the provided details",
        409,
        "REGISTRATION_FAILED",
      );
    }

    const passwordHash = await hashPassword(input.password);

    const user = await deps.userRepository.createUser({
      email,
      passwordHash,
      role,
    });

    await deps.authRepository.createAuditLog({
      userId: user.id,
      action: AuditAction.ACCOUNT_CREATED,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };
  };

  /**
   * --------------------------------------------------------------------------
   * LOGIN
   * --------------------------------------------------------------------------
   */
  const login = async (input: {
    email: string;
    password: string;
    ipAddress?: string;
    userAgent?: string;
  }) => {
    const email = input.email.trim().toLowerCase();

    const user = await deps.userRepository.findByEmail(email);

    // Always run a password comparison — even for a nonexistent user — against a
    // fixed dummy hash. This keeps the timing profile identical to the "wrong
    // password" branch below and prevents email enumeration via response timing.
    const passwordValid = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !user.passwordHash || !passwordValid) {
      if (user) {
        const updatedUser = await deps.userRepository.incrementFailedLogin(user.id);

        if (updatedUser.failedLoginAttempts >= 5) {
          await deps.userRepository.lockAccount(
            user.id,
            new Date(Date.now() + 15 * 60 * 1000),
          );
        }
      }

      await deps.authRepository.createAuditLog({
        userId: user?.id,
        action: AuditAction.LOGIN_FAILED,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        details: { reason: "INVALID_CREDENTIALS" },
      });

      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    if (!user.isActive) {
      throw new AppError("Account is disabled", 403, "ACCOUNT_DISABLED");
    }

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      throw new AppError("Account is temporarily locked", 423, "ACCOUNT_LOCKED");
    }

    // Successful credential check — clear any accumulated failed-attempt count
    // so past failures don't contribute to a future lockout.
    if (user.failedLoginAttempts > 0) {
      await deps.userRepository.resetFailedLoginAttempts(user.id);
    }

    if (user.mfaEnabled) {
      const challengeId = generateRandomToken(32);

      // MFA challenge state MUST be persisted for the flow to be completable.
      // If Redis is unavailable, fail loudly rather than returning a
      // challengeId that can never be verified.
      try {
        await deps.redis.set(
          `mfa:challenge:${challengeId}`,
          JSON.stringify({
            userId: user.id,
            createdAt: Date.now(),
          }),
          "EX",
          300,
        );
      } catch (err) {
        await deps.authRepository.createAuditLog({
          userId: user.id,
          action: AuditAction.LOGIN_FAILED,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          details: { reason: "MFA_CHALLENGE_STORE_UNAVAILABLE" },
        });
        throw new AppError(
          "Unable to process login right now, please try again",
          503,
          "MFA_UNAVAILABLE",
        );
      }

      return {
        requiresMfa: true,
        challengeId,
      };
    }

    const sessionId = generateId();
    const familyId = generateFamilyId();
    const refreshToken = generateRandomToken(64);
    const refreshTokenHash = hashToken(refreshToken);

    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await deps.authRepository.createLoginState({
      userId: user.id,
      sessionId,
      familyId,
      refreshTokenId: generateId(),
      refreshTokenHash,
      expiresAt: refreshExpiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    await deps.userRepository.updateLastLogin(user.id);
    await deps.securityCache.setSecurityVersion(user.id, user.securityVersion);

    const accessToken = createAccessToken({
      sub: user.id,
      sid: sessionId,
      role: user.role,
      securityVersion: user.securityVersion,
    });

    await deps.authRepository.createAuditLog({
      userId: user.id,
      action: AuditAction.LOGIN_SUCCESS,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      details: { sessionId },
    });

    return {
      requiresMfa: false,
      accessToken,
      refreshToken,
      expiresIn: 600,
    };
  };

  /**
   * --------------------------------------------------------------------------
   * REFRESH TOKEN ROTATION
   * --------------------------------------------------------------------------
   */
  const refresh = async (input: {
    refreshToken: string;
    ipAddress?: string;
    userAgent?: string;
  }) => {
    const tokenHash = hashToken(input.refreshToken);
    const stored = await deps.authRepository.findRefreshToken(tokenHash);

    if (!stored) {
      throw new AppError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
    }

    if (!stored.user.isActive) {
      throw new AppError("Account is disabled", 403, "ACCOUNT_DISABLED");
    }

    if (stored.session.isRevoked) {
      throw new AppError("Session revoked", 401, "SESSION_REVOKED");
    }

    if (stored.expiresAt <= new Date()) {
      throw new AppError("Refresh token expired", 401, "REFRESH_TOKEN_EXPIRED");
    }

    const newRefreshToken = generateRandomToken(64);
    const newRefreshTokenHash = hashToken(newRefreshToken);
    const newTokenId = generateId();
    const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const result = await deps.authRepository.rotateRefreshToken({
      oldTokenId: stored.id,
      newTokenId,
      newTokenHash: newRefreshTokenHash,
      userId: stored.user.id,
      sessionId: stored.session.id,
      familyId: stored.familyId,
      expiresAt: newExpiry,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    if (!result.success && result.reuseDetected) {
      await deps.authRepository.revokeFamily(stored.familyId, RevokeReason.TOKEN_REUSE);

      await deps.authRepository.createAuditLog({
        userId: stored.user.id,
        action: AuditAction.TOKEN_REUSE_DETECTED,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        details: {
          familyId: stored.familyId,
          sessionId: stored.session.id,
        },
      });

      throw new AppError("Refresh token reuse detected", 401, "TOKEN_REUSE_DETECTED");
    }

    const accessToken = createAccessToken({
      sub: stored.user.id,
      sid: stored.session.id,
      role: stored.user.role,
      securityVersion: stored.user.securityVersion,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 600,
    };
  };

  /**
   * --------------------------------------------------------------------------
   * LOGOUT
   * --------------------------------------------------------------------------
   */
  const logout = async (refreshToken: string) => {
    const tokenHash = hashToken(refreshToken);
    const stored = await deps.authRepository.findRefreshToken(tokenHash);

    if (!stored) {
      return;
    }

    await deps.authRepository.revokeSession(stored.session.id, RevokeReason.LOGOUT);

    await deps.authRepository.createAuditLog({
      userId: stored.user.id,
      action: AuditAction.LOGOUT,
      details: { sessionId: stored.session.id },
    });
  };

  /**
   * --------------------------------------------------------------------------
   * LOGOUT ALL
   * --------------------------------------------------------------------------
   */
  const logoutAll = async (userId: string) => {
    await deps.authRepository.revokeAllUserSessions(userId, RevokeReason.LOGOUT_ALL);
    const result = await deps.userRepository.incrementSecurityVersion(userId);

    await deps.securityCache.setSecurityVersion(userId, result.securityVersion);

    await deps.authRepository.createAuditLog({
      userId,
      action: AuditAction.LOGOUT_ALL,
    });
  };

  /**
   * --------------------------------------------------------------------------
   * CHANGE PASSWORD
   * --------------------------------------------------------------------------
   * Requires proof of the current password (or, for a forgot-password flow, a
   * verified reset token handled by a separate method) before mutating
   * credentials. Never allow a password change from an access token alone.
   */
  const changePassword = async (
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) => {
    const user = await deps.userRepository.findById(userId);

    if (!user || !user.passwordHash) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }

    const currentValid = await verifyPassword(currentPassword, user.passwordHash);

    if (!currentValid) {
      await deps.authRepository.createAuditLog({
        userId,
        action: AuditAction.PASSWORD_CHANGE,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        details: { outcome: "REJECTED_INVALID_CURRENT_PASSWORD" },
      });
      throw new AppError("Current password is incorrect", 401, "INVALID_CURRENT_PASSWORD");
    }

    if (newPassword === currentPassword) {
      throw new AppError(
        "New password must differ from current password",
        400,
        "PASSWORD_REUSE",
      );
    }

    const newPasswordHash = await hashPassword(newPassword);

    await deps.userRepository.updatePassword(userId, newPasswordHash);
    await deps.authRepository.revokeAllUserSessions(userId, RevokeReason.PASSWORD_CHANGED);

    const result = await deps.userRepository.incrementSecurityVersion(userId);
    await deps.securityCache.setSecurityVersion(userId, result.securityVersion);

    await deps.authRepository.createAuditLog({
      userId,
      action: AuditAction.PASSWORD_CHANGE,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  };

  return {
    register,
    login,
    refresh,
    logout,
    logoutAll,
    changePassword,
  };
};

export type AuthService = ReturnType<typeof createAuthService>;
export const AuthService = createAuthService;
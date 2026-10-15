import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { randomBytes, randomUUID, createHash } from "node:crypto";

/**
 * Generate a signed JWT.
 */
export const generateRefreshToken = (
  payload: Record<string, unknown>,
  secret: string,
  expiresIn: SignOptions["expiresIn"] = "1h"
): string => {
  try {
    return jwt.sign(payload, secret, { expiresIn });
  } catch (error) {
    throw new Error(
      `Failed to generate token: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
};

/**
 * Verify and decode a JWT.
 */
export const verifyToken = <T extends object = JwtPayload>(
  token: string,
  secret: string
): T => {
  try {
    return jwt.verify(token, secret) as T;
  } catch (error) {
    throw new Error(
      `Failed to verify token: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
};

/**
 * Generate a unique Refresh Token Family ID.
 */
export const generateFamilyId = (): string => {
  return randomBytes(16).toString("hex");
};

/**
 * Generate a standard unique JWT ID (jti) or entity ID.
 */
export const generateId = (): string => {
  return randomUUID();
};

export const generateJti = (): string => {
  return randomUUID();
};

/**
 * Generate a cryptographically secure random token string.
 */
export const generateRandomToken = (bytes: number = 32): string => {
  return randomBytes(bytes).toString("hex");
};

/**
 * Hash a raw token string using SHA-256.
 */
export const hashToken = (token: string): string => {
  return createHash("sha256").update(token).digest("hex");
};

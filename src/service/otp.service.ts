import crypto from "crypto";
import { redis as redisClient } from "../redis/redis";
import { redisKeys } from "../redis/redis.keys";
import { emailService } from "./email.service";
import { AppError } from "../../utils/app-error";

interface StoredOtpData {
  hash: string;
  attempts: number;
  expiresAt: number;
}

// In-memory fallback cache when Redis is offline
const memoryOtpCache = new Map<string, StoredOtpData>();
const memoryRateLimitCache = new Map<string, number>();

export class OtpService {
  private readonly OTP_TTL_SECONDS = 300; // 5 minutes
  private readonly RATE_LIMIT_SECONDS = 60; // 1 minute between sends
  private readonly MAX_ATTEMPTS = 5;

  /**
   * Hashes the raw OTP using SHA-256
   */
  private hashOtp(otp: string): string {
    return crypto.createHash("sha256").update(otp.trim()).digest("hex");
  }

  /**
   * Generates a 6-digit cryptographically random OTP
   */
  private generateOtp(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Send OTP to the given email
   */
  public async sendOtp(input: {
    email: string;
    purpose?: string;
    recipientName?: string;
  }): Promise<{ success: boolean; message: string; expiresInSeconds: number }> {
    const email = input.email.trim().toLowerCase();
    const purpose = input.purpose || "Verification";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError("Invalid email address format", 400, "INVALID_EMAIL");
    }

    // 1. Enforce cooldown rate limit (1 OTP per 60 seconds)
    const rateLimitKey = redisKeys.emailOtpRateLimit(email);
    let isRateLimited = false;

    try {
      if (redisClient.status === "ready") {
        const remaining = await redisClient.ttl(rateLimitKey);
        if (remaining > 0) {
          isRateLimited = true;
        }
      } else {
        const until = memoryRateLimitCache.get(email);
        if (until && until > Date.now()) {
          isRateLimited = true;
        }
      }
    } catch {
      const until = memoryRateLimitCache.get(email);
      if (until && until > Date.now()) {
        isRateLimited = true;
      }
    }

    if (isRateLimited) {
      throw new AppError(
        "Please wait 60 seconds before requesting a new OTP",
        429,
        "OTP_RATE_LIMITED"
      );
    }

    // 2. Generate and hash OTP
    const rawOtp = this.generateOtp();
    const otpHash = this.hashOtp(rawOtp);
    const otpKey = redisKeys.emailOtp(email);

    // 3. Store in Redis with fallback to in-memory store
    try {
      if (redisClient.status === "ready") {
        const payload = JSON.stringify({
          hash: otpHash,
          attempts: 0,
          expiresAt: Date.now() + this.OTP_TTL_SECONDS * 1000,
        });

        await redisClient
          .multi()
          .set(otpKey, payload, "EX", this.OTP_TTL_SECONDS)
          .set(rateLimitKey, "1", "EX", this.RATE_LIMIT_SECONDS)
          .exec();
      } else {
        this.saveToMemory(email, otpHash);
      }
    } catch (err) {
      console.warn("⚠️ Redis unavailable for OTP, using in-memory store:", (err as Error).message);
      this.saveToMemory(email, otpHash);
    }

    // 4. Dispatch Email via Brevo
    await emailService.sendOtpEmail({
      toEmail: email,
      otp: rawOtp,
      recipientName: input.recipientName,
      purpose,
      expiryMinutes: Math.floor(this.OTP_TTL_SECONDS / 60),
    });

    const isDevPreview = !process.env.BREVO_API_KEY || process.env.BREVO_API_KEY.trim() === "";

    return {
      success: true,
      message: `OTP sent successfully to ${email}`,
      expiresInSeconds: this.OTP_TTL_SECONDS,
      ...(isDevPreview ? { previewOtp: rawOtp } : {}),
    };
  }

  /**
   * Verify an OTP provided by the user
   */
  public async verifyOtp(input: {
    email: string;
    otp: string;
  }): Promise<{ success: boolean; message: string }> {
    const email = input.email.trim().toLowerCase();
    const rawOtp = input.otp ? input.otp.trim() : "";

    if (!email || !rawOtp) {
      throw new AppError("Email and OTP code are required", 400, "VALIDATION_ERROR");
    }

    const otpKey = redisKeys.emailOtp(email);
    let record: StoredOtpData | null = null;
    let usingRedis = false;

    try {
      if (redisClient.status === "ready") {
        const data = await redisClient.get(otpKey);
        if (data) {
          record = JSON.parse(data);
          usingRedis = true;
        }
      }
    } catch (err) {
      console.warn("⚠️ Redis fetch error during OTP verification:", (err as Error).message);
    }

    // Check memory store if not found in Redis
    if (!record) {
      const memoryRecord = memoryOtpCache.get(email);
      if (memoryRecord && memoryRecord.expiresAt > Date.now()) {
        record = memoryRecord;
      }
    }

    if (!record) {
      throw new AppError("OTP has expired or was not requested", 400, "OTP_EXPIRED_OR_INVALID");
    }

    // Check attempt threshold to prevent brute-force attacks
    if (record.attempts >= this.MAX_ATTEMPTS) {
      await this.invalidateOtp(email, usingRedis);
      throw new AppError(
        "Too many failed attempts. This OTP is now invalid. Please request a new one.",
        429,
        "OTP_MAX_ATTEMPTS_EXCEEDED"
      );
    }

    const providedHash = this.hashOtp(rawOtp);
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(record.hash, "hex"),
      Buffer.from(providedHash, "hex")
    );

    if (!isMatch) {
      // Increment attempt counter
      record.attempts += 1;
      if (usingRedis) {
        try {
          const remainingTtl = await redisClient.ttl(otpKey);
          if (remainingTtl > 0) {
            await redisClient.set(otpKey, JSON.stringify(record), "EX", remainingTtl);
          }
        } catch {
          // ignore error
        }
      } else {
        memoryOtpCache.set(email, record);
      }

      const attemptsLeft = this.MAX_ATTEMPTS - record.attempts;
      throw new AppError(
        `Invalid OTP code. ${attemptsLeft} attempt(s) remaining.`,
        400,
        "INVALID_OTP"
      );
    }

    // Verified successfully -> invalidate OTP immediately
    await this.invalidateOtp(email, usingRedis);

    return {
      success: true,
      message: "OTP verified successfully",
    };
  }

  private saveToMemory(email: string, otpHash: string) {
    memoryOtpCache.set(email, {
      hash: otpHash,
      attempts: 0,
      expiresAt: Date.now() + this.OTP_TTL_SECONDS * 1000,
    });
    memoryRateLimitCache.set(email, Date.now() + this.RATE_LIMIT_SECONDS * 1000);
  }

  private async invalidateOtp(email: string, usingRedis: boolean) {
    const otpKey = redisKeys.emailOtp(email);
    if (usingRedis) {
      try {
        await redisClient.del(otpKey);
      } catch {
        // ignore
      }
    }
    memoryOtpCache.delete(email);
  }
}

export const otpService = new OtpService();

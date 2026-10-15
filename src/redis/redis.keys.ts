export const redisKeys = {
  loginRateLimit: (
    ip: string,
  ) => `rl:login:ip:${ip}`,

  loginEmailRateLimit: (
    email: string,
  ) => `rl:login:email:${email}`,

  refreshRateLimit: (
    ip: string,
  ) => `rl:refresh:ip:${ip}`,

  mfaChallenge: (
    challengeId: string,
  ) => `mfa:challenge:${challengeId}`,

  revokedSession: (
    sessionId: string,
  ) => `session:revoked:${sessionId}`,

  emailOtp: (
    email: string,
  ) => `otp:email:${email}`,

  emailOtpRateLimit: (
    email: string,
  ) => `rl:otp:email:${email}`,

  emailOtpAttempts: (
    email: string,
  ) => `otp:attempts:${email}`,
};
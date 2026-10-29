import jwt, { SignOptions } from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: string;
  securityVersion: number;
  jti: string;
}


const getJwtSecret = () =>
  process.env.JWT_ACCESS_SECRET || "super-secret-jwt-access-key-epaper-2026";

const getJwtIssuer = () =>
  process.env.JWT_ISSUER || "http://localhost:8989";

const getJwtAudience = () =>
  process.env.JWT_AUDIENCE || "your-client";

export function createAccessToken(payload: Omit<AccessTokenPayload, "jti">): string {
  const options: SignOptions = {
    algorithm: "HS256",
    expiresIn: "10m",
    issuer: getJwtIssuer(),
    audience: getJwtAudience(),
  };

  return jwt.sign(
    payload,
    getJwtSecret(),
    options,
  );
}

export function veryfyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ["HS256"],
    issuer: getJwtIssuer(),
    audience: getJwtAudience(),
  }) as AccessTokenPayload;
}
export const verifyAccessToken = veryfyAccessToken;
export const verifyJwt = verifyAccessToken;
export const generateAccessToken = createAccessToken;


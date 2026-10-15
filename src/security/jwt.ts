import jwt, { SignOptions } from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: string;
  securityVersion: number;
  jti: string;
}


const JWT_SECRET =
  process.env.JWT_ACCESS_SECRET!;

const JWT_ISSUER =
  process.env.JWT_ISSUER ?? "your-api";

const JWT_AUDIENCE =
  process.env.JWT_AUDIENCE ?? "your-client";


if (!JWT_SECRET) {
  throw new Error(
    "JWT_ACCESS_SECRET is missing",
  );
}

export function createAccessToken(payload:Omit<AccessTokenPayload, "jti">):string {
  const options: SignOptions = {
    algorithm: "HS256",
    expiresIn: "10m",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };

  return jwt.sign(
    payload,
    JWT_SECRET,
    options,
  );

}
export function veryfyAccessToken(token: string): AccessTokenPayload {

  return jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as AccessTokenPayload;
}
export const verifyAccessToken = veryfyAccessToken;
export const verifyJwt = verifyAccessToken;


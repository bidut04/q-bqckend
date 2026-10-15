import {Response} from "express"
const isProduction =process.env.NODE_env==="production";
export const REFRESH_COOKIE ="refresh_token";


export function setRefreshToken(res:Response,token:string){
res.cookie(REFRESH_COOKIE, token,{httpOnly:true, secure:isProduction,
     sameSite:
        isProduction
          ? "strict"
          : "lax",

      path: "/api/v1/auth",

      maxAge:
        30 *
        24 *
        60 *
        60 *
        1000,

 ...(process.env.COOKIE_DOMAIN
        ? {
            domain:
              process.env.COOKIE_DOMAIN,
          }
        : {}),
    },
  );
}


export function clearRefreshCookie(
  res: Response,
) {
  res.clearCookie(
    REFRESH_COOKIE,
    {
      httpOnly: true,

      secure: isProduction,

      sameSite:
        isProduction
          ? "strict"
          : "lax",

      path: "/api/v1/auth",

      ...(process.env.COOKIE_DOMAIN
        ? {
            domain:
              process.env.COOKIE_DOMAIN,
          }
        : {}),
    },
  );
}

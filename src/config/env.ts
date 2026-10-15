import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

config({
    path: resolve(process.cwd(), ".env"),
});


const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8989),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(1),
    JWT_ISSUER: z.string().min(1),
    CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
    COOKIE_DOMAIN: z.string().min(1).default("localhost"),
    IMAGEKIT_PUBLIC_KEY: z.string().default(""),
    IMAGEKIT_PRIVATE_KEY: z.string().default(""),
    IMAGEKIT_URL_ENDPOINT: z.string().default(""),
    BREVO_API_KEY: z.string().default(""),
    BREVO_SENDER_EMAIL: z.string().default("no-reply@epaper.com"),
    BREVO_SENDER_NAME: z.string().default("ePaper"),
});

const parsed=envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error("❌ Invalid environment variables:", parsed.error.format());
   
    console.error (parsed.error.flatten().fieldErrors)
    process.exit(1);
}
export const env = parsed.data;

export const isProduction =
env.NODE_ENV === "production";

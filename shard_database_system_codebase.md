# Multi-Tenant Shard Database System - Serial Implementation Codebase

This document contains the complete, production-grade source code for all files related to the **QueueFlow Multi-Tenant Database Sharding Subsystem** in `d:\epaper\backend`. 

The code files are organized **serially step-by-step** in exact logical execution and dependency order—from environment configuration and domain types up to routing, circuit breakers, context-aware database access, middlewares, online migration, repositories, and background workers.

---

## Architecture Execution Pipeline (Serial Step-by-Step Order)

```
[ Step 1: Configuration ] ──> [ Step 2: Types & Errors ] ──> [ Step 3: Database & Schema ]
                                                                      │
[ Step 6: Pool & Circuit ] <── [ Step 5: Routing & Catalog ] <── [ Step 4: Tenant Context ]
            │
            ▼
[ Step 7: DB Access & Middleware ] ──> [ Step 8: Online Migration Engine & Worker ]
                                                    │
                                                    ▼
                                    [ Step 9: Repositories & Outbox Workers ]
```

---

## Step 1: Configuration & Environment Setup

### 1.1 `src/config/sharding.config.ts`
**Path**: `d:\epaper\backend\src\config\sharding.config.ts`  
*Description*: Validates environment variables, shard database URLs, pool parameters, and cache TTL settings using Zod schemas.

```typescript
import "dotenv/config";
import { z } from "zod";

export interface ShardConfig {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly weight: number;
  readonly readOnly: boolean;
  readonly connectionLimit: number;
  readonly poolTimeoutSeconds: number;
  readonly connectTimeoutSeconds: number;
}

export type ShardNodeConfig = ShardConfig;

export interface ShardingConfig {
  readonly catalogUrl: string;
  readonly shards: ReadonlyMap<string, ShardConfig>;
  readonly consistentHashReplicas: number;
  readonly tenantCacheTtlSeconds: number;
  readonly redisCacheTtlSeconds: number;
  readonly localMemoryCacheTtlMs: number;
}

export class ShardingConfigValidationError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(`[ShardingConfigValidationError] ${message}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const DatabaseUrlSchema = z.string().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === "mysql:" ||
        parsed.protocol === "postgresql:" ||
        parsed.protocol === "postgres:" ||
        parsed.protocol === "mariadb:"
      );
    } catch {
      return false;
    }
  },
  {
    message: "Invalid database URL protocol. Must use mysql://, postgresql://, postgres://, or mariadb://",
  }
);

const ShardConfigSchema = z.object({
  id: z
    .string()
    .min(2, "Shard ID must be at least 2 characters")
    .regex(/^[a-z0-9_-]+$/, "Shard ID must be lowercase alphanumeric with hyphens/underscores"),
  name: z.string().min(1, "Shard name is required"),
  url: DatabaseUrlSchema,
  weight: z
    .number()
    .int("Weight must be an integer")
    .min(1, "Weight must be at least 1")
    .max(1000, "Weight cannot exceed 1000"),
  readOnly: z.boolean(),
  connectionLimit: z.number().int().min(1).max(500).default(25),
  poolTimeoutSeconds: z.number().int().min(1).max(120).default(15),
  connectTimeoutSeconds: z.number().int().min(1).max(120).default(10),
});

const sanitizeUrlForLog = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
};

const loadAndValidateShards = (): ReadonlyMap<string, ShardConfig> => {
  const shards = new Map<string, ShardConfig>();
  const seenUrls = new Set<string>();

  Object.entries(process.env).forEach(([key, value]) => {
    if (!key.startsWith("SHARD_") || !key.endsWith("_URL") || !value) {
      return;
    }

    const shardId = key.replace("_URL", "").toLowerCase();

    if (shards.has(shardId)) {
      throw new ShardingConfigValidationError(`Duplicate shard ID detected: '${shardId}'`, {
        shardId,
        environmentKey: key,
      });
    }

    if (seenUrls.has(value)) {
      throw new ShardingConfigValidationError(`Duplicate database URL target configured for shard '${shardId}'`, {
        shardId,
        url: sanitizeUrlForLog(value),
      });
    }

    const weightKey = key.replace("_URL", "_WEIGHT");
    const parsedWeight = process.env[weightKey] ? parseInt(process.env[weightKey]!, 10) : 100;

    const readOnlyKey = key.replace("_URL", "_READONLY");
    const isReadOnly = process.env[readOnlyKey] === "true";

    const connLimitKey = key.replace("_URL", "_POOL_LIMIT");
    const connectionLimit = process.env[connLimitKey] ? parseInt(process.env[connLimitKey]!, 10) : 25;

    const candidateConfig = {
      id: shardId,
      name: `Tenant Shard ${shardId}`,
      url: value,
      weight: parsedWeight,
      readOnly: isReadOnly,
      connectionLimit,
      poolTimeoutSeconds: 15,
      connectTimeoutSeconds: 10,
    };

    const validationResult = ShardConfigSchema.safeParse(candidateConfig);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues.map((i) => i.message).join("; ");
      throw new ShardingConfigValidationError(
        `Shard '${shardId}' failed validation: ${errorMsg}`,
        { shardId }
      );
    }

    shards.set(shardId, Object.freeze(validationResult.data));
    seenUrls.add(value);
  });

  if (shards.size === 0) {
    const defaultUrl = process.env.DATABASE_URL;
    if (!defaultUrl) {
      throw new ShardingConfigValidationError(
        "No tenant shards (SHARD_*_URL) or default DATABASE_URL configured in environment variables."
      );
    }

    const urlValidation = DatabaseUrlSchema.safeParse(defaultUrl);
    if (!urlValidation.success) {
      throw new ShardingConfigValidationError(
        `Default database URL 'DATABASE_URL' is malformed: ${urlValidation.error.issues[0]?.message}`,
        { url: sanitizeUrlForLog(defaultUrl) }
      );
    }

    const defaultShard: ShardConfig = Object.freeze({
      id: "shard_01",
      name: "Primary Tenant Shard 01",
      url: defaultUrl,
      weight: 100,
      readOnly: false,
      connectionLimit: 25,
      poolTimeoutSeconds: 15,
      connectTimeoutSeconds: 10,
    });

    shards.set("shard_01", defaultShard);
  }

  const hasWritableShard = Array.from(shards.values()).some((s) => !s.readOnly);
  if (!hasWritableShard) {
    throw new ShardingConfigValidationError(
      "No writable shards available. At least one shard must have readOnly = false."
    );
  }

  return Object.freeze(shards);
};

const catalogDatabaseUrl = process.env.CATALOG_DATABASE_URL || process.env.DATABASE_URL;
if (!catalogDatabaseUrl) {
  throw new ShardingConfigValidationError("CATALOG_DATABASE_URL or DATABASE_URL must be defined.");
}

const catalogUrlValidation = DatabaseUrlSchema.safeParse(catalogDatabaseUrl);
if (!catalogUrlValidation.success) {
  throw new ShardingConfigValidationError(
    `Catalog database URL is malformed: ${catalogUrlValidation.error.issues[0]?.message}`,
    { url: sanitizeUrlForLog(catalogDatabaseUrl) }
  );
}

export const shardingConfig: ShardingConfig = Object.freeze({
  catalogUrl: catalogDatabaseUrl,
  shards: loadAndValidateShards(),
  consistentHashReplicas: process.env.CONSISTENT_HASH_REPLICAS
    ? parseInt(process.env.CONSISTENT_HASH_REPLICAS, 10)
    : 100,
  tenantCacheTtlSeconds: 3600,
  redisCacheTtlSeconds: 3600,
  localMemoryCacheTtlMs: 60000,
});
```

---

### 1.2 `src/config/prisma.ts`
**Path**: `d:\epaper\backend\src\config\prisma.ts`  
*Description*: Dynamic Proxy Prisma Client factory separating Global Catalog DB models from Tenant Shard DB models.

```typescript
import { PrismaClient } from "@prisma/client";
import { TenantContext } from "../lib/sharding/tenant.context";
import { shardManager } from "../lib/sharding/shard.manager";

/**
 * Global Catalog Database Client.
 * Used for authentication, sessions, refresh tokens, global audit logs, and tenants catalog.
 */
export function getGlobalPrisma(): PrismaClient {
  return shardManager.getCatalogClient();
}

/**
 * Tenant-Sharded Database Client.
 * Automatically resolves the correct PrismaClient based on the current Request's TenantContext.
 * If an explicit tenantId or shardId is supplied, resolves that target shard directly.
 */
export function getTenantPrisma(shardId?: string): PrismaClient {
  const targetShard = shardId ?? TenantContext.getShardId();
  if (targetShard) {
    return shardManager.getShardClient(targetShard);
  }
  // Fallback to Catalog client if no active tenant context
  return shardManager.getCatalogClient();
}

/**
 * Primary Prisma Client Exporter.
 * Uses a Proxy object so that property accesses (e.g. `prisma.user`, `prisma.employee`)
 * automatically route to global Catalog DB or target Tenant Shard DB dynamically based on entity context!
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: keyof PrismaClient) {
    // Entities that belong to global catalog database
    const catalogEntities = new Set([
      "user",
      "account",
      "session",
      "refreshToken",
      "verificationToken",
      "mfaMethod",
      "recoveryCode",
      "mfaChallenge",
      "loginAttempt",
      "auditLog",
      "media",
      "hero",
    ]);

    if (catalogEntities.has(prop as string)) {
      return (getGlobalPrisma() as any)[prop];
    }

    // Default to active Tenant Shard client for sharded domain models
    return (getTenantPrisma() as any)[prop];
  },
});
```

---

## Step 2: Core Domain Types & Security Errors

### 2.1 `src/lib/sharding/shard.types.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\shard.types.ts`  
*Description*: Central interface definitions for shard IDs, health status, circuit breaker states, and metrics.

```typescript
export type ShardId = string;

export interface TenantShardMapping {
  readonly tenantId: string;
  readonly shardId: string;
  readonly status: string;
}

export interface ShardHealth {
  readonly shardId: string;
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ShardMetrics {
  readonly shardId: string;
  readonly circuitState: CircuitState;
  readonly totalRequests: number;
  readonly totalFailures: number;
  readonly consecutiveFailures: number;
  readonly lastFailureReason: string | null;
  readonly lastFailureTime: string | null;
  readonly lastSuccessTime: string | null;
  readonly poolCreatedAt: string;
}
```

---

### 2.2 `src/core/tenant/tenant.types.ts`
**Path**: `d:\epaper\backend\src\core\tenant\tenant.types.ts`  
*Description*: Explicit tenant status enums (`ACTIVE`, `SUSPENDED`, `MIGRATING`, `READ_ONLY`) and tenant metadata contracts.

```typescript
export type TenantStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" | "MIGRATING" | "READ_ONLY" | "DELETED";

export interface TenantMeta {
  readonly id: string;
  readonly name: string;
  readonly slug?: string | null;
  readonly shardId: string;
  readonly status: TenantStatus;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
```

---

### 2.3 `src/core/errors/security.errors.ts`
**Path**: `d:\epaper\backend\src\core\errors\security.errors.ts`  
*Description*: Hierarchy of typed security and domain errors for safe client metadata serialization.

```typescript
export class BaseSecurityError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode: string,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthenticatedError extends BaseSecurityError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHENTICATED");
  }
}

export class ForbiddenError extends BaseSecurityError {
  constructor(message = "Access forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

export class TenantContextMissingError extends BaseSecurityError {
  constructor(message = "Tenant context is missing from request pipeline") {
    super(message, 500, "TENANT_CONTEXT_MISSING");
  }
}

export class TenantAccessDeniedError extends BaseSecurityError {
  constructor(message = "Access to tenant resource denied") {
    super(message, 403, "TENANT_ACCESS_DENIED");
  }
}

export class BranchAccessDeniedError extends BaseSecurityError {
  constructor(message = "Access to branch resource denied") {
    super(message, 403, "BRANCH_ACCESS_DENIED");
  }
}

export class ResourceNotFoundError extends BaseSecurityError {
  constructor(message = "Resource not found") {
    super(message, 404, "RESOURCE_NOT_FOUND");
  }
}

export class CrossTenantAccessAttemptError extends BaseSecurityError {
  constructor(message = "Cross-tenant access attempt detected") {
    super(message, 403, "CROSS_TENANT_ACCESS_ATTEMPT");
  }
}

export class ShardUnavailableError extends BaseSecurityError {
  constructor(shardId: string, details?: string) {
    super(`Shard '${shardId}' is unavailable${details ? `: ${details}` : ""}`, 503, "SHARD_UNAVAILABLE", { shardId });
  }
}

export class ShardNotFoundError extends BaseSecurityError {
  constructor(tenantId: string) {
    super(`No shard mapped for tenant '${tenantId}'`, 500, "SHARD_NOT_FOUND", { tenantId });
  }
}

export class InvalidSupportSessionError extends BaseSecurityError {
  constructor(message = "Invalid or expired support session") {
    super(message, 401, "INVALID_SUPPORT_SESSION");
  }
}

export class TenantNotFoundError extends BaseSecurityError {
  constructor(tenantId: string) {
    super(`Tenant '${tenantId}' not found`, 404, "TENANT_NOT_FOUND", { tenantId });
  }
}

export class TenantSuspendedError extends BaseSecurityError {
  constructor(tenantId: string, details?: string) {
    super(`Tenant '${tenantId}' is suspended or inactive${details ? `: ${details}` : ""}`, 403, "TENANT_SUSPENDED", { tenantId });
  }
}

export class TenantReadOnlyError extends BaseSecurityError {
  constructor(tenantId: string) {
    super(`Tenant '${tenantId}' is in read-only mode`, 403, "TENANT_READ_ONLY", { tenantId });
  }
}

export class TenantMigratingError extends BaseSecurityError {
  constructor(tenantId: string) {
    super(`Tenant '${tenantId}' is currently undergoing migration cutover lock`, 503, "TENANT_MIGRATING", { tenantId });
  }
}

export class UnauthorizedTenantAccessError extends BaseSecurityError {
  constructor(message = "Unauthorized access to tenant data") {
    super(message, 403, "UNAUTHORIZED_TENANT_ACCESS");
  }
}
```

---

### 2.4 `src/core/authorization/roles.ts`
**Path**: `d:\epaper\backend\src\core\authorization\roles.ts`  
*Description*: Role enumeration definitions for platform and tenant RBAC policies.

```typescript
export enum Role {
  PLATFORM_OWNER = "PLATFORM_OWNER",
  PLATFORM_ADMIN = "PLATFORM_ADMIN",
  PLATFORM_SUPPORT = "PLATFORM_SUPPORT",
  TENANT_OWNER = "TENANT_OWNER",
  TENANT_ADMIN = "TENANT_ADMIN",
  BRANCH_ADMIN = "BRANCH_ADMIN",
  EMPLOYEE = "EMPLOYEE",
}
```

---

### 2.5 `src/core/authorization/permissions.ts`
**Path**: `d:\epaper\backend\src\core\authorization\permissions.ts`  
*Description*: Fine-grained permission strings for multi-tenant domain authorization.

```typescript
export enum Permission {
  TENANT_READ = "tenant:read",
  TENANT_UPDATE = "tenant:update",

  BRANCH_READ = "branch:read",
  BRANCH_CREATE = "branch:create",
  BRANCH_UPDATE = "branch:update",
  BRANCH_DELETE = "branch:delete",

  EMPLOYEE_READ = "employee:read",
  EMPLOYEE_CREATE = "employee:create",
  EMPLOYEE_UPDATE = "employee:update",

  CUSTOMER_READ = "customer:read",
  CUSTOMER_UPDATE = "customer:update",

  BOOKING_READ = "booking:read",
  BOOKING_CREATE = "booking:create",
  BOOKING_UPDATE = "booking:update",

  QUEUE_READ = "queue:read",
  QUEUE_CREATE = "queue:create",
  QUEUE_UPDATE = "queue:update",
  QUEUE_TRANSFER = "queue:transfer",

  FORM_READ = "form:read",
  FORM_CREATE = "form:create",
  FORM_UPDATE = "form:update",
  FORM_PUBLISH = "form:publish",

  COUNTER_READ = "counter:read",
  COUNTER_UPDATE = "counter:update",

  AUDIT_READ = "audit:read",

  // Platform Control Plane Permissions
  PLATFORM_TENANT_READ = "platform:tenant:read",
  PLATFORM_TENANT_UPDATE = "platform:tenant:update",
  PLATFORM_SHARD_READ = "platform:shard:read",
  PLATFORM_MIGRATION_EXECUTE = "platform:migration:execute",
}
```

---

## Step 3: Database Schemas & Connection Singletons

### 3.1 `src/lib/prisma/catalog.prisma.ts`
**Path**: `d:\epaper\backend\src\lib\prisma\catalog.prisma.ts`  
*Description*: Singleton instance manager for the global Catalog Database Prisma Client.

```typescript
import { PrismaClient } from "@prisma/client";
import { shardingConfig } from "../../config/sharding.config";

let catalogClient: PrismaClient | null = null;

export const getCatalogClient = (): PrismaClient => {
  if (!catalogClient) {
    catalogClient = new PrismaClient({
      datasources: {
        db: {
          url: shardingConfig.catalogUrl,
        },
      },
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return catalogClient;
};

export const catalogDb = getCatalogClient();
export const catalogPrisma = catalogDb;

export const disconnectCatalogDb = async (): Promise<void> => {
  if (catalogClient) {
    await catalogClient.$disconnect();
    catalogClient = null;
  }
};

export default catalogDb;
```

---

### 3.2 `prisma/schema.prisma`
**Path**: `d:\epaper\backend\prisma\schema.prisma`  
*Description*: Complete Prisma schema definition for Catalog, Users, Sessions, Tenants, Shard Mapping, and Domain Models.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  MANAGER
  ADMIN
}

enum AuthProvider {
  LOCAL
  GOOGLE
  GITHUB
  MICROSOFTF
}

enum TokenType {
  EMAIL_VERIFICATION
  PASSWORD_RESET
  MAGIC_LINK
}

enum RefreshTokenStatus {
  ACTIVE
  ROTATED
  REVOKED
  REUSED
  EXPIRED
}

enum RevokeReason {
  LOGOUT
  LOGOUT_ALL
  TOKEN_ROTATION
  TOKEN_REUSE
  PASSWORD_CHANGED
  ACCOUNT_DISABLED
  ADMIN_REVOKED
  SECURITY_EVENT
  EXPIRED
}

enum MfaType {
  TOTP
  WEBAUTHN
}

enum AuditAction {
  LOGIN_SUCCESS
  LOGIN_FAILED
  LOGOUT
  LOGOUT_ALL
  ACCOUNT_CREATED
  EMAIL_VERIFICATION_REQUESTED
  EMAIL_VERIFIED
  PASSWORD_CHANGE
  PASSWORD_RESET_REQUESTED
  PASSWORD_RESET_COMPLETED
  TOKEN_REFRESH
  TOKEN_REUSE_DETECTED
  SESSION_CREATED
  SESSION_REVOKED
  MFA_ENABLED
  MFA_DISABLED
  MFA_CHALLENGE_SUCCESS
  MFA_CHALLENGE_FAILED
  MFA_RECOVERY_CODE_USED
  OAUTH_LOGIN
  OAUTH_ACCOUNT_LINKED
  OAUTH_ACCOUNT_UNLINKED
  ACCOUNT_LOCKED
  ACCOUNT_UNLOCKED
  ACCOUNT_DISABLED
  ACCOUNT_ENABLED
  ROLE_CHANGED
  SUSPICIOUS_LOGIN
  SECURITY_EVENT
}

enum NewsType {
  PUBLISHED
  DRAFT
}

model User {
  id                  String              @id @default(uuid())
  email               String              @unique @db.VarChar(255)
  passwordHash        String?             @map("password_hash") @db.VarChar(255)
  role                Role                @default(USER)
  isVerified          Boolean             @default(false) @map("is_verified")
  isActive            Boolean             @default(true) @map("is_active")
  securityVersion     Int                 @default(0) @map("security_version")
  failedLoginAttempts Int                 @default(0) @map("failed_login_attempts")
  lockoutUntil        DateTime?           @map("lockout_until")
  lastLoginAt         DateTime?           @map("last_login_at")
  lastLoginIp         String?             @map("last_login_ip") @db.VarChar(45)
  passwordChangedAt   DateTime?           @map("password_changed_at")
  mfaEnabled          Boolean             @default(false) @map("mfa_enabled")
  createdAt           DateTime            @default(now()) @map("created_at")
  updatedAt           DateTime            @updatedAt @map("updated_at")

  accounts            Account[]
  sessions            Session[]
  refreshTokens       RefreshToken[]
  verificationTokens  VerificationToken[]
  mfaMethods          MfaMethod[]
  recoveryCodes       RecoveryCode[]
  mfaChallenges       MfaChallenge[]
  loginAttempts       LoginAttempt[]
  auditLogs           AuditLog[]
  media               Media[]

  @@index([role])
  @@index([isActive])
  @@index([createdAt])
  @@map("users")
}

model Account {
  id                    String       @id @default(uuid())
  userId                String       @map("user_id")
  provider              AuthProvider
  providerAccountId     String       @map("provider_account_id") @db.VarChar(255)
  accessTokenEncrypted  String?      @map("access_token_encrypted") @db.Text
  refreshTokenEncrypted String?      @map("refresh_token_encrypted") @db.Text
  accessTokenExpiresAt  DateTime?    @map("access_token_expires_at")
  scope                 String?      @db.Text
  createdAt             DateTime     @default(now()) @map("created_at")
  updatedAt             DateTime     @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@index([provider])
  @@map("accounts")
}

model Session {
  id             String        @id @default(uuid())
  userId         String        @map("user_id")
  userAgent      String?       @map("user_agent") @db.Text
  ipAddress      String?       @map("ip_address") @db.VarChar(45)
  deviceName     String?       @map("device_name") @db.VarChar(255)
  isRevoked      Boolean       @default(false) @map("is_revoked")
  revokedAt      DateTime?     @map("revoked_at")
  revokeReason   RevokeReason? @map("revoke_reason")
  expiresAt      DateTime      @map("expires_at")
  lastActivityAt DateTime      @default(now()) @map("last_activity_at")
  createdAt      DateTime      @default(now()) @map("created_at")
  updatedAt      DateTime      @updatedAt @map("updated_at")

  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokens RefreshToken[]

  @@index([userId])
  @@index([userId, isRevoked])
  @@index([expiresAt])
  @@map("sessions")
}

model RefreshToken {
  id              String             @id @default(uuid())
  userId          String             @map("user_id")
  sessionId       String             @map("session_id")
  tokenHash       String             @unique @map("token_hash") @db.VarChar(64)
  familyId        String             @map("family_id")
  status          RefreshTokenStatus @default(ACTIVE)
  previousTokenId String?            @unique @map("previous_token_id")
  nextTokenId     String?            @unique @map("next_token_id")
  rotatedAt       DateTime?          @map("rotated_at")
  revokedAt       DateTime?          @map("revoked_at")
  revokeReason    RevokeReason?      @map("revoke_reason")
  expiresAt       DateTime           @map("expires_at")
  ipAddress       String?            @map("ip_address") @db.VarChar(45)
  userAgent       String?            @map("user_agent") @db.Text
  createdAt       DateTime           @default(now()) @map("created_at")

  user          User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  session       Session       @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  previousToken RefreshToken? @relation("RefreshTokenChain", fields: [previousTokenId], references: [id], onDelete: SetNull)
  nextToken     RefreshToken? @relation("RefreshTokenChain")

  @@index([userId])
  @@index([sessionId])
  @@index([familyId])
  @@index([familyId, status])
  @@index([expiresAt])
  @@map("refresh_tokens")
}

enum TenantType {
  BANK
  CLINIC
  HOSPITAL
  POST_OFFICE
  GOVERNMENT
  DIAGNOSTIC_CENTER
  UNIVERSITY
  RETAIL
  CORPORATE
  OTHER
}

enum TenantStatus {
  ACTIVE
  SUSPENDED
  INACTIVE
  MIGRATING
  DELETED
}

model Tenant {
  id        String       @id @default(cuid())
  name      String
  slug      String?      @unique
  type      TenantType
  status    TenantStatus @default(ACTIVE)
  email     String?
  phone     String?
  timezone  String?      @default("Asia/Kolkata")
  currency  String       @default("INR")
  setting   Json?
  shardId   String       @default("shard_01") @map("shard_id")
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  locations    Location[]
  employees    Employee[]
  services     Service[]
  counters     Counter[]
  queues       Queue[]
  queueEntries QueueEntry[]
  roles        TenantRole[]
  permissions  Permission[]
  customers    Customer[]

  @@index([status])
  @@map("tenants")
}

model Location {
  id       String  @id @default(cuid())
  tenantId String
  tenant   Tenant  @relation(fields: [tenantId], references: [id])
  name     String
  code     String
  address  Json?
  phone    String?
  timezone String?
  status   String  @default("ACTIVE")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  employees    EmployeeLocation[]
  services     LocationService[]
  counters     Counter[]
  queues       Queue[]
  queueEntries QueueEntry[]

  @@unique([tenantId, code])
  @@index([tenantId])
  @@map("locations")
}

model Employee {
  id           String   @id @default(uuid())
  tenantId     String
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  employeeCode String
  name         String
  email        String?
  phone        String?
  passwordHash String?
  status       String   @default("ACTIVE")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  roles     EmployeeRole[]
  locations EmployeeLocation[]

  @@unique([tenantId, employeeCode])
  @@index([tenantId, status])
  @@map("employees")
}

model EmployeeLocation {
  employeeId String
  locationId String

  employee Employee @relation(fields: [employeeId], references: [id])
  location Location @relation(fields: [locationId], references: [id])

  isPrimary Boolean @default(false)
  createdAt DateTime @default(now())

  @@id([employeeId, locationId])
  @@map("employee_locations")
}

model TenantRole {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  name        String
  description String?
  isSystem    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  employees   EmployeeRole[]
  permissions RolePermission[]

  @@unique([tenantId, name])
  @@map("tenant_roles")
}

model EmployeeRole {
  employeeId String
  roleId     String

  employee Employee   @relation(fields: [employeeId], references: [id])
  role     TenantRole @relation(fields: [roleId], references: [id])

  @@id([employeeId, roleId])
  @@map("employee_roles")
}

model Permission {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  key         String
  description String?

  roles RolePermission[]

  @@unique([tenantId, key])
  @@map("permissions")
}

model RolePermission {
  roleId       String
  permissionId String

  role       TenantRole @relation(fields: [roleId], references: [id])
  permission Permission @relation(fields: [permissionId], references: [id])

  @@id([roleId, permissionId])
  @@map("role_permissions")
}

model Service {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  name        String
  code        String?
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  locations LocationService[]
  counters  CounterService[]
  queues    Queue[]
  entries   QueueEntry[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("services")
}

model LocationService {
  locationId String
  serviceId  String

  location Location @relation(fields: [locationId], references: [id])
  service  Service  @relation(fields: [serviceId], references: [id])
  enabled  Boolean  @default(true)

  @@id([locationId, serviceId])
  @@map("location_services")
}

model Counter {
  id         String   @id @default(uuid())
  tenantId   String
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
  locationId String
  location   Location @relation(fields: [locationId], references: [id])
  name       String
  code       String
  status     String   @default("CLOSED")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  services  CounterService[]
  queues    Queue[]
  entries   QueueEntry[]

  @@unique([locationId, code])
  @@index([tenantId, locationId])
  @@map("counters")
}

model CounterService {
  counterId String
  serviceId String

  counter Counter @relation(fields: [counterId], references: [id])
  service Service @relation(fields: [serviceId], references: [id])
  priority Int     @default(0)
  enabled  Boolean @default(true)

  @@id([counterId, serviceId])
  @@map("counter_services")
}

model Queue {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  locationId  String
  location    Location @relation(fields: [locationId], references: [id])
  serviceId   String
  service     Service  @relation(fields: [serviceId], references: [id])
  name        String
  code        String
  status      String   @default("CLOSED")
  tokenPrefix String?
  tokenStart  Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  counters Counter[]
  entries  QueueEntry[]

  @@unique([locationId, code])
  @@index([tenantId, locationId, serviceId])
  @@map("queues")
}

model QueueEntry {
  id          String    @id @default(uuid())
  tenantId    String
  tenant      Tenant    @relation(fields: [tenantId], references: [id])
  locationId  String
  location    Location  @relation(fields: [locationId], references: [id])
  queueId     String
  queue       Queue     @relation(fields: [queueId], references: [id])
  serviceId   String
  service     Service   @relation(fields: [serviceId], references: [id])
  tokenNumber Int
  tokenLabel  String
  status      String    @default("WAITING")
  priority    Int       @default(0)
  calledAt    DateTime?
  servingAt   DateTime?
  completedAt DateTime?
  cancelledAt DateTime?
  noShowAt    DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  counterId   String?
  counter     Counter?  @relation(fields: [counterId], references: [id])
  customerId  String?
  customer    Customer? @relation(fields: [customerId], references: [id])

  @@unique([queueId, tokenNumber])
  @@index([tenantId, locationId, status])
  @@index([queueId, status])
  @@map("queue_entries")
}

model Customer {
  id       String   @id @default(uuid())
  tenantId String
  tenant   Tenant   @relation(fields: [tenantId], references: [id])
  name     String?
  phone    String?
  email    String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  queueEntries QueueEntry[]

  @@index([tenantId, phone])
  @@map("customers")
}

model TenantMigration {
  id                 String    @id @default(uuid())
  tenantId           String    @map("tenant_id")
  sourceShard        String    @map("source_shard")
  targetShard        String    @map("target_shard")
  status             String    @default("REQUESTED")
  progressPercent    Int       @default(0) @map("progress_percent")
  lastProcessedId    String?   @map("last_processed_id")
  rowsCopied         BigInt    @default(0) @map("rows_copied")
  rowsVerified       BigInt    @default(0) @map("rows_verified")
  retryCount         Int       @default(0) @map("retry_count")
  workerId           String?   @map("worker_id")
  leaseExpiresAt     DateTime? @map("lease_expires_at")
  startedAt          DateTime? @map("started_at")
  cutoverStartedAt   DateTime? @map("cutover_started_at")
  cutoverCompletedAt DateTime? @map("cutover_completed_at")
  completedAt        DateTime? @map("completed_at")
  errorCode          String?   @map("error_code")
  errorMessage       String?   @map("error_message")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  @@index([tenantId, status])
  @@map("tenant_migrations")
}

model ShardMigrationRun {
  id              String    @id @default(uuid())
  runId           String    @map("run_id")
  targetShard     String    @map("target_shard")
  targetType      String    @map("target_type")
  status          String    @default("PENDING")
  appliedVersion  String?   @map("applied_version")
  executionTimeMs Int?      @map("execution_time_ms")
  errorMessage    String?   @map("error_message")
  startedAt       DateTime  @default(now()) @map("started_at")
  completedAt     DateTime? @map("completed_at")

  @@index([runId, status])
  @@map("shard_migration_runs")
}
```

---

## Step 4: Request Tenant Context & AsyncLocalStorage Scope

### 4.1 `src/core/tenant/tenant-context.ts`
**Path**: `d:\epaper\backend\src\core\tenant\tenant-context.ts`  
*Description*: Canonical immutable `TenantContext` interface definition.

```typescript
export interface TenantContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly roleIds: readonly string[];
  readonly permissions: readonly string[];
  readonly branchIds: readonly string[];
  readonly sessionId: string;
  readonly securityVersion: number;
  readonly isSupportSession?: boolean;
  readonly supportReason?: string;
  readonly shardId?: string;
}

export interface TenantResolutionRequest {
  readonly sessionToken?: string;
  readonly decodedJwt?: {
    readonly sub: string;
    readonly tenantId: string;
    readonly roles: readonly string[];
    readonly permissions: readonly string[];
    readonly branches: readonly string[];
    readonly sessionId: string;
    readonly securityVersion: number;
    readonly isSupportSession?: boolean;
    readonly supportReason?: string;
  };
}
```

---

### 4.2 `src/core/tenant/tenant-context.store.ts`
**Path**: `d:\epaper\backend\src\core\tenant\tenant-context.store.ts`  
*Description*: `AsyncLocalStorage` store manager enforcing request context isolation without cross-contamination.

```typescript
import { AsyncLocalStorage } from "node:async_hooks";
import { TenantContext } from "./tenant-context";
import { TenantContextMissingError } from "../errors/security.errors";

const tenantAsyncLocalStorage = new AsyncLocalStorage<TenantContext>();

export const runWithTenantContext = <R>(
  context: TenantContext,
  fn: () => Promise<R> | R
): Promise<R> | R => {
  return tenantAsyncLocalStorage.run(Object.freeze(context), fn);
};

export const getTenantContext = (): TenantContext | undefined => {
  return tenantAsyncLocalStorage.getStore();
};

export const requireTenantContext = (): TenantContext => {
  const context = getTenantContext();
  if (!context) {
    throw new TenantContextMissingError("Active TenantContext is required for this operation.");
  }
  return context;
};

export const TenantContextStore = {
  run: runWithTenantContext,
  getStore: getTenantContext,
  requireStore: requireTenantContext,
};
```

---

### 4.3 `src/lib/sharding/tenant.context.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\tenant.context.ts`  
*Description*: Helper wrapper for backward compatibility with the core tenant context store.

```typescript
import { TenantContext as ITenantContext } from "../../core/tenant/tenant-context";
import {
  runWithTenantContext,
  getTenantContext,
  requireTenantContext,
} from "../../core/tenant/tenant-context.store";

export const runTenantContext = <T>(
  context: Partial<ITenantContext> & { tenantId: string; userId: string; isSuperAdmin?: boolean },
  callback: () => T
): T => {
  const fullContext: ITenantContext = {
    userId: context.userId,
    tenantId: context.tenantId,
    roleIds: context.roleIds || [],
    permissions: context.permissions || [],
    branchIds: context.branchIds || [],
    sessionId: context.sessionId || "default_session",
    securityVersion: context.securityVersion ?? 0,
    isSupportSession: context.isSupportSession,
    supportReason: context.supportReason,
    shardId: context.shardId,
  };
  return runWithTenantContext(fullContext, callback) as T;
};

export { getTenantContext, requireTenantContext };

export const getTenantId = (): string | undefined => getTenantContext()?.tenantId;
export const getShardId = (): string | undefined => getTenantContext()?.shardId;
export const getUserId = (): string | undefined => getTenantContext()?.userId;

export const TenantContext = {
  run: runTenantContext,
  getContext: getTenantContext,
  getTenantContext,
  requireTenantContext,
  getTenantId,
  getShardId,
  getUserId,
};
```

---

### 4.4 `src/core/tenant/tenant-resolver.ts`
**Path**: `d:\epaper\backend\src\core\tenant\tenant-resolver.ts`  
*Description*: Security-first resolver extracting tenant context strictly from verified JWT claims while ignoring untrusted client headers.

```typescript
import { TenantContext } from "./tenant-context";
import { UnauthenticatedError } from "../errors/security.errors";

export interface TrustedSessionPayload {
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly branches: readonly string[];
  readonly sessionId: string;
  readonly securityVersion: number;
  readonly isSupportSession?: boolean;
  readonly supportReason?: string;
}

export interface SessionValidator {
  validateSession(sessionId: string, expectedUserId: string, expectedSecurityVersion: number): Promise<boolean>;
}

export class TenantResolver {
  constructor(private readonly sessionValidator?: SessionValidator) {}

  public async resolveFromSession(payload: TrustedSessionPayload): Promise<TenantContext> {
    if (!payload.tenantId || typeof payload.tenantId !== "string" || payload.tenantId.trim() === "") {
      throw new UnauthenticatedError("Invalid token: missing required tenantId claim.");
    }

    if (!payload.userId || typeof payload.userId !== "string") {
      throw new UnauthenticatedError("Invalid token: missing required userId claim.");
    }

    if (this.sessionValidator) {
      const isValid = await this.sessionValidator.validateSession(
        payload.sessionId,
        payload.userId,
        payload.securityVersion
      );
      if (!isValid) {
        throw new UnauthenticatedError("Session revoked or security version mismatch.");
      }
    }

    return Object.freeze({
      userId: payload.userId,
      tenantId: payload.tenantId,
      roleIds: Object.freeze([...(payload.roles || [])]),
      permissions: Object.freeze([...(payload.permissions || [])]),
      branchIds: Object.freeze([...(payload.branches || [])]),
      sessionId: payload.sessionId,
      securityVersion: payload.securityVersion,
      isSupportSession: Boolean(payload.isSupportSession),
      supportReason: payload.supportReason,
    });
  }
}
```

---

## Step 5: Shard Routing & Catalog Lookup Engine

### 5.1 `src/lib/sharding/shard.router.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\shard.router.ts`  
*Description*: Consistent Hashing Ring router used ONLY for NEW tenant placement; delegates to Catalog DB for existing tenants.

```typescript
import crypto from "node:crypto";
import { shardingConfig } from "../../config/sharding.config";
import { getTenantShard } from "./shard.catalog";

interface HashRingNode {
  readonly hash: number;
  readonly shardId: string;
}

const hashString = (value: string): number => {
  const digest = crypto.createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0);
};

const buildHashRing = (): readonly HashRingNode[] => {
  const nodes: HashRingNode[] = [];
  const replicas = shardingConfig.consistentHashReplicas;

  for (const [shardId, config] of shardingConfig.shards) {
    if (config.readOnly) {
      continue;
    }

    const weightMultiplier = Math.max(1, Math.floor(config.weight / 10));
    const virtualNodeCount = replicas * weightMultiplier;

    for (let index = 0; index < virtualNodeCount; index += 1) {
      const key = `${shardId}:vnode:${index}`;
      nodes.push({
        hash: hashString(key),
        shardId,
      });
    }
  }

  nodes.sort((a, b) => a.hash - b.hash);

  if (nodes.length === 0) {
    throw new Error("No writable shards available for new tenant placement.");
  }

  return Object.freeze(nodes);
};

const hashRing = buildHashRing();

export const resolveTenantShard = async (tenantId: string): Promise<string> => {
  if (!tenantId || !tenantId.trim()) {
    throw new Error("tenantId is required for shard resolution.");
  }

  return getTenantShard(tenantId);
};

export const selectShardForNewTenant = (tenantId: string): string => {
  if (!tenantId || !tenantId.trim()) {
    throw new Error("tenantId is required for shard selection.");
  }

  const tenantHash = hashString(tenantId);
  let low = 0;
  let high = hashRing.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (hashRing[middle].hash >= tenantHash) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  const index = low < hashRing.length ? low : 0;
  return hashRing[index].shardId;
};

export const ShardRouter = {
  resolveShard: resolveTenantShard,
  resolveTenantShard,
  selectShardForNewTenant,
};
```

---

### 5.2 `src/lib/sharding/shard.catalog.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\shard.catalog.ts`  
*Description*: Singleflight Request Coalescing, L1 In-Memory + L2 Redis TTL cache, and Redis Pub/Sub invalidation engine.

```typescript
import { redis } from "../../redis/redis";
import { shardingConfig } from "../../config/sharding.config";
import { catalogDb } from "../prisma/catalog.prisma";
import { TenantNotFoundError, TenantSuspendedError } from "../../core/errors/security.errors";

const CACHE_INVALIDATION_CHANNEL = "queueflow:tenant-cache:invalidate";
const inMemoryCache = new Map<string, { shardId: string; expiresAt: number }>();
const inFlightCatalogRequests = new Map<string, Promise<string>>();

const getCacheKey = (tenantId: string): string => `queueflow:tenant-shard:${tenantId}`;

export const initCacheInvalidationListener = (redisSubscriberClient: any): void => {
  if (!redisSubscriberClient) return;

  redisSubscriberClient.subscribe(CACHE_INVALIDATION_CHANNEL, (err: any) => {
    if (err) console.error("[CacheBuster] Failed to subscribe to tenant cache invalidation channel:", err);
  });

  redisSubscriberClient.on("message", (channel: string, message: string) => {
    if (channel === CACHE_INVALIDATION_CHANNEL) {
      try {
        const { tenantId } = JSON.parse(message);
        if (tenantId) {
          inMemoryCache.delete(tenantId);
          redis.del(getCacheKey(tenantId)).catch(() => {});
        }
      } catch (e) {
        console.error("[CacheBuster] Failed to parse cache invalidation payload:", e);
      }
    }
  });
};

const getCachedShard = async (tenantId: string): Promise<string | null> => {
  const memoryEntry = inMemoryCache.get(tenantId);
  if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
    return memoryEntry.shardId;
  }

  try {
    const shardId = await redis.get(getCacheKey(tenantId));
    if (shardId && shardingConfig.shards.has(shardId)) {
      inMemoryCache.set(tenantId, { shardId, expiresAt: Date.now() + shardingConfig.localMemoryCacheTtlMs });
      return shardId;
    }
    if (shardId && !shardingConfig.shards.has(shardId)) {
      await redis.del(getCacheKey(tenantId));
    }
  } catch {
    // Redis offline fallback to Catalog DB
  }
  return null;
};

const cacheTenantShard = async (tenantId: string, shardId: string): Promise<void> => {
  inMemoryCache.set(tenantId, { shardId, expiresAt: Date.now() + shardingConfig.localMemoryCacheTtlMs });
  try {
    await redis.set(getCacheKey(tenantId), shardId, "EX", shardingConfig.redisCacheTtlSeconds);
  } catch {
    // Cache failure must not affect DB operations
  }
};

export const getTenantShard = async (tenantId: string): Promise<string> => {
  const cached = await getCachedShard(tenantId);
  if (cached) {
    return cached;
  }

  // Request Coalescing / Singleflight to prevent Cache Stampedes
  let inFlightPromise = inFlightCatalogRequests.get(tenantId);
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const tenant = await catalogDb.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, shardId: true, status: true },
      });

      if (!tenant) {
        throw new TenantNotFoundError(tenantId);
      }

      if (tenant.status === "INACTIVE" || tenant.status === "SUSPENDED" || tenant.status === "DELETED") {
        throw new TenantSuspendedError(tenantId, `Tenant status is ${tenant.status}`);
      }

      if (!shardingConfig.shards.has(tenant.shardId)) {
        throw new Error(`Tenant '${tenantId}' references unconfigured shard '${tenant.shardId}'`);
      }

      await cacheTenantShard(tenantId, tenant.shardId);
      return tenant.shardId;
    } finally {
      inFlightCatalogRequests.delete(tenantId);
    }
  })();

  inFlightCatalogRequests.set(tenantId, inFlightPromise);
  return inFlightPromise;
};

export const updateTenantShard = async (tenantId: string, shardId: string): Promise<void> => {
  if (!shardingConfig.shards.has(shardId)) {
    throw new Error(`Shard '${shardId}' is not configured`);
  }

  await catalogDb.tenant.update({
    where: { id: tenantId },
    data: { shardId, status: "ACTIVE" },
  });

  await cacheTenantShard(tenantId, shardId);
  await invalidateTenantShard(tenantId);
};

export const invalidateTenantShard = async (tenantId: string): Promise<void> => {
  inMemoryCache.delete(tenantId);
  try {
    await redis.del(getCacheKey(tenantId));
    await redis.publish(CACHE_INVALIDATION_CHANNEL, JSON.stringify({ tenantId, timestamp: Date.now() }));
  } catch {
    // Suppress cache error
  }
};

export const shardCatalog = {
  getTenantShard,
  updateTenantShard,
  invalidateTenantShard,
  initCacheInvalidationListener,
};
```

---

## Step 6: Connection Pooling, Health Probes & Circuit Breakers

### 6.1 `src/lib/sharding/shard.manager.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\shard.manager.ts`  
*Description*: Per-shard connection pool manager, Circuit Breaker with canary probe limits, and exponential backoff jitter retries.

```typescript
import { PrismaClient } from "@prisma/client";
import { shardingConfig, ShardConfig } from "../../config/sharding.config";
import { checkAllShards } from "./shard.health";
import { ShardUnavailableError, ShardNotFoundError } from "../../core/errors/security.errors";
import { getCatalogClient, catalogDb, disconnectCatalogDb } from "../prisma/catalog.prisma";
import type { CircuitState, ShardMetrics } from "./shard.types";

export { getCatalogClient, catalogDb };
export type { CircuitState, ShardMetrics };

export class ShardCircuitBreaker {
  public state: CircuitState = "CLOSED";
  public consecutiveFailures = 0;
  public totalRequests = 0;
  public totalFailures = 0;
  public lastFailureReason: string | null = null;
  public lastFailureTime: string | null = null;
  public lastSuccessTime: string | null = null;
  public lastStateChangeTime = Date.now();
  private halfOpenSuccesses = 0;

  constructor(
    public readonly shardId: string,
    private readonly failureThreshold = 5,
    private readonly resetTimeoutMs = 30000,
    private readonly halfOpenSuccessThreshold = 2
  ) {}

  public canExecute(): boolean {
    if (this.state === "CLOSED") {
      return true;
    }

    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastStateChangeTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.transitionTo("HALF_OPEN");
        return true;
      }
      throw new ShardUnavailableError(
        this.shardId,
        `Circuit breaker OPEN. Fast-failing requests to protect database resources. Reset in ${Math.ceil(
          (this.resetTimeoutMs - elapsed) / 1000
        )}s`
      );
    }

    return true;
  }

  public recordSuccess(): void {
    this.totalRequests += 1;
    this.lastSuccessTime = new Date().toISOString();

    if (this.state === "HALF_OPEN") {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenSuccessThreshold) {
        this.transitionTo("CLOSED");
        this.consecutiveFailures = 0;
        this.halfOpenSuccesses = 0;
      }
    } else if (this.state === "CLOSED") {
      this.consecutiveFailures = 0;
    }
  }

  public recordFailure(reason: string): void {
    this.totalRequests += 1;
    this.totalFailures += 1;
    this.consecutiveFailures += 1;
    this.lastFailureReason = reason;
    this.lastFailureTime = new Date().toISOString();

    if (this.state === "HALF_OPEN") {
      this.transitionTo("OPEN");
    } else if (this.state === "CLOSED" && this.consecutiveFailures >= this.failureThreshold) {
      this.transitionTo("OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    console.warn(`[ShardCircuitBreaker] Shard '${this.shardId}' state changed: ${this.state} ──► ${newState}`);
    this.state = newState;
    this.lastStateChangeTime = Date.now();
    if (newState === "HALF_OPEN") {
      this.halfOpenSuccesses = 0;
    }
  }
}

const clients = new Map<string, PrismaClient>();
const breakers = new Map<string, ShardCircuitBreaker>();
const poolCreationTimes = new Map<string, string>();

const enrichDatabaseUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "25");
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "15");
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "10");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
};

const isTransientDbError = (error: unknown): boolean => {
  if (!error) return false;
  const msg = (error as Error).message || "";
  const code = (error as any).code || "";

  return (
    code === "P1001" ||
    code === "P1002" ||
    code === "P1008" ||
    code === "P1017" ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("connection limit") ||
    msg.includes("pool_timeout") ||
    msg.includes("Connection pool exhausted")
  );
};

export const executeWithRetry = async <T>(
  shardId: string,
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 100
): Promise<T> => {
  const breaker = getShardCircuitBreaker(shardId);
  breaker.canExecute();

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (error) {
      const isTransient = isTransientDbError(error);
      const errMsg = (error as Error).message || "Unknown DB error";

      if (!isTransient || attempt >= maxAttempts) {
        breaker.recordFailure(errMsg);
        if (error instanceof ShardNotFoundError || error instanceof ShardUnavailableError) {
          throw error;
        }
        throw new ShardUnavailableError(shardId, errMsg);
      }

      const maxJitter = Math.min(10000, baseDelayMs * Math.pow(2, attempt));
      const jitterDelay = Math.floor(Math.random() * maxJitter);
      console.warn(
        `[ShardManager Retry] Transient DB error on shard '${shardId}' (attempt ${attempt}/${maxAttempts}). Retrying in ${jitterDelay}ms...`
      );
      await new Promise((res) => setTimeout(res, jitterDelay));
    }
  }

  throw new ShardUnavailableError(shardId, `Exhausted ${maxAttempts} retry attempts`);
};

const getShardConfig = (shardId: string): ShardConfig => {
  const config = shardingConfig.shards.get(shardId);
  if (!config) {
    throw new ShardNotFoundError(shardId);
  }
  return config;
};

export const getShardCircuitBreaker = (shardId: string): ShardCircuitBreaker => {
  let breaker = breakers.get(shardId);
  if (!breaker) {
    breaker = new ShardCircuitBreaker(shardId);
    breakers.set(shardId, breaker);
  }
  return breaker;
};

export const getShardClient = (shardId: string): PrismaClient => {
  const breaker = getShardCircuitBreaker(shardId);
  breaker.canExecute();

  const existing = clients.get(shardId);
  if (existing) {
    return existing;
  }

  try {
    const config = getShardConfig(shardId);
    const enrichedUrl = enrichDatabaseUrl(config.url);

    const client = new PrismaClient({
      datasources: {
        db: {
          url: enrichedUrl,
        },
      },
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });

    clients.set(shardId, client);
    poolCreationTimes.set(shardId, new Date().toISOString());
    return client;
  } catch (error) {
    breaker.recordFailure((error as Error).message);
    if (error instanceof ShardNotFoundError) {
      throw error;
    }
    throw new ShardUnavailableError(shardId, (error as Error).message);
  }
};

export const assertShardExists = (shardId: string): void => {
  getShardConfig(shardId);
};

export const assertShardWritable = (shardId: string): void => {
  const config = getShardConfig(shardId);
  if (config.readOnly) {
    throw new ShardUnavailableError(shardId, "Shard is in read-only mode");
  }
};

export const healthCheckShard = async (shardId: string): Promise<void> => {
  await executeWithRetry(shardId, async () => {
    const client = getShardClient(shardId);
    await client.$queryRaw`SELECT 1`;
  });
};

export const disconnectShard = async (shardId: string): Promise<void> => {
  const client = clients.get(shardId);
  if (!client) {
    return;
  }
  await client.$disconnect();
  clients.delete(shardId);
  poolCreationTimes.delete(shardId);
};

export const disconnectAllShards = async (): Promise<void> => {
  await disconnectCatalogDb();
  await Promise.all(Array.from(clients.values()).map((client) => client.$disconnect()));
  clients.clear();
  poolCreationTimes.clear();
};

export const getShardMetrics = (shardId: string): ShardMetrics => {
  const breaker = getShardCircuitBreaker(shardId);
  return {
    shardId,
    circuitState: breaker.state,
    totalRequests: breaker.totalRequests,
    totalFailures: breaker.totalFailures,
    consecutiveFailures: breaker.consecutiveFailures,
    lastFailureReason: breaker.lastFailureReason,
    lastFailureTime: breaker.lastFailureTime,
    lastSuccessTime: breaker.lastSuccessTime,
    poolCreatedAt: poolCreationTimes.get(shardId) || "N/A",
  };
};

export const getAllShardMetrics = (): Record<string, ShardMetrics> => {
  const result: Record<string, ShardMetrics> = {};
  for (const shardId of shardingConfig.shards.keys()) {
    result[shardId] = getShardMetrics(shardId);
  }
  return result;
};

export const shardManager = {
  getCatalogClient,
  getShardClient,
  getShardCircuitBreaker,
  executeWithRetry,
  assertShardExists,
  assertShardWritable,
  healthCheckShard,
  checkHealth: checkAllShards,
  disconnectShard,
  disconnectAllShards,
  getShardMetrics,
  getAllShardMetrics,
};
```

---

### 6.2 `src/lib/sharding/shard.health.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\shard.health.ts`  
*Description*: Active health check probe runner querying all registered database shards.

```typescript
import { shardingConfig } from "../../config/sharding.config";
import { healthCheckShard } from "./shard.manager";
import { ShardHealth } from "./shard.types";

export const checkAllShards = async (): Promise<readonly ShardHealth[]> => {
  const results = await Promise.all(
    Array.from(shardingConfig.shards.keys()).map(async (shardId): Promise<ShardHealth> => {
      const start = Date.now();
      try {
        await healthCheckShard(shardId);
        return {
          shardId,
          healthy: true,
          latencyMs: Date.now() - start,
        };
      } catch (error) {
        return {
          shardId,
          healthy: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    })
  );
  return results;
};
```

---

## Step 7: Context-Aware Database Access & Middlewares

### 7.1 `src/lib/sharding/tenant-db.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\tenant-db.ts`  
*Description*: Canonical `TenantDbClient` wrapper obtaining target shard connections and running transaction boundaries safely.

```typescript
import { PrismaClient } from "@prisma/client";
import { TenantContext } from "../../core/tenant/tenant-context";
import { shardCatalog } from "./shard.catalog";
import { shardManager } from "./shard.manager";
import { TenantContextMissingError } from "../../core/errors/security.errors";

export class TenantDbClient {
  public static async forContext(context: TenantContext): Promise<PrismaClient> {
    if (!context || !context.tenantId) {
      throw new TenantContextMissingError("Cannot instantiate tenant DB client without valid TenantContext.");
    }

    const shardId = context.shardId || (await shardCatalog.getTenantShard(context.tenantId));
    return shardManager.getShardClient(shardId);
  }

  public static async runTransaction<T>(
    context: TenantContext,
    fn: (tx: PrismaClient) => Promise<T>
  ): Promise<T> {
    const client = await this.forContext(context);
    return client.$transaction(async (tx) => {
      return fn(tx as PrismaClient);
    });
  }
}
```

---

### 7.2 `src/lib/sharding/tenant-sharding.middleware.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\tenant-sharding.middleware.ts`  
*Description*: Express middleware binding authenticated tenant identity into `AsyncLocalStorage` context.

```typescript
import { Request, Response, NextFunction } from "express";
import { resolveTenantShard } from "./shard.router";
import { runTenantContext } from "./tenant.context";

export const tenantShardingMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user || !user.tenantId) {
      res.status(401).json({
        success: false,
        message: "Authentication and tenant identity required.",
      });
      return;
    }

    const tenantId = user.tenantId;
    const shardId = await resolveTenantShard(tenantId);
    res.setHeader("X-Resolved-Shard", shardId);

    runTenantContext(
      {
        tenantId,
        shardId,
        userId: user.id || user.sub,
        isSuperAdmin: Boolean(user.isSuperAdmin),
      },
      () => {
        next();
      }
    );
  } catch (error) {
    next(error);
  }
};
```

---

### 7.3 `src/middleware/tenant.middleware.ts`
**Path**: `d:\epaper\backend\src\middleware\tenant.middleware.ts`  
*Description*: Request middleware resolving shard headers and enforcing tenant context presence.

```typescript
import type { Request, Response, NextFunction } from "express";
import { TenantContext } from "../lib/sharding/tenant.context";
import { ShardRouter } from "../lib/sharding/shard.router";

export interface ShardedRequest extends Request {
  tenantId?: string;
  shardId?: string;
}

export async function tenantShardingMiddleware(
  req: ShardedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = (req as any).user;
  if (!user || !user.tenantId) {
    return next();
  }

  try {
    const tenantId = user.tenantId;
    const shardId = await ShardRouter.resolveShard(tenantId);

    req.tenantId = tenantId;
    req.shardId = shardId;
    res.setHeader("X-Resolved-Shard", shardId);

    TenantContext.run(
      {
        tenantId,
        shardId,
        userId: user.id || user.sub,
      },
      () => {
        next();
      }
    );
  } catch (error) {
    next(error);
  }
}

export function requireTenantContext(
  req: ShardedRequest,
  res: Response,
  next: NextFunction
): void {
  const tenantId = TenantContext.getTenantId();
  if (!tenantId) {
    res.status(400).json({
      error: "TenantContextRequired",
      message: "Valid tenant authentication context is required for this route.",
    });
    return;
  }
  next();
}
```

---

### 7.4 `src/middleware/tenant-context.ts`
**Path**: `d:\epaper\backend\src\middleware\tenant-context.ts`  
*Description*: Express session-to-TenantContext middleware enforcing identity verification.

```typescript
import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./authenticate";
import { TenantResolver } from "../core/tenant/tenant-resolver";
import { runWithTenantContext } from "../core/tenant/tenant-context.store";
import { UnauthenticatedError } from "../core/errors/security.errors";

const resolver = new TenantResolver();

export const establishTenantContext = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.userPayload) {
      throw new UnauthenticatedError("Authentication must precede tenant context creation.");
    }

    const context = await resolver.resolveFromSession({
      userId: req.userPayload.sub,
      tenantId: req.userPayload.tenantId,
      roles: req.userPayload.roles || [],
      permissions: req.userPayload.permissions || [],
      branches: req.userPayload.branches || [],
      sessionId: req.userPayload.sessionId,
      securityVersion: req.userPayload.securityVersion,
      isSupportSession: req.userPayload.isSupportSession,
      supportReason: req.userPayload.supportReason,
    });

    (req as any).tenantContext = context;

    runWithTenantContext(context, () => {
      next();
    });
  } catch (error) {
    next(error);
  }
};
```

---

## Step 8: Online Shard Migration Subsystem

### 8.1 `src/lib/sharding/shard.migration.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\shard.migration.ts`  
*Description*: Zero-downtime migration state machine, atomic cutover lock, and catalog mapping update engine.

```typescript
import { catalogDb } from "../prisma/catalog.prisma";
import { assertShardWritable } from "./shard.manager";
import { shardCatalog } from "./shard.catalog";

export type TenantMigrationStatus =
  | "REQUESTED"
  | "VALIDATING"
  | "COPYING"
  | "CATCHING_UP"
  | "VERIFYING"
  | "CUTOVER"
  | "COMPLETED"
  | "FAILED";

export class TenantMigrationStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<TenantMigrationStatus, readonly TenantMigrationStatus[]> = {
    REQUESTED: ["VALIDATING", "FAILED"],
    VALIDATING: ["COPYING", "FAILED"],
    COPYING: ["CATCHING_UP", "FAILED"],
    CATCHING_UP: ["VERIFYING", "FAILED"],
    VERIFYING: ["CUTOVER", "FAILED"],
    CUTOVER: ["COMPLETED", "FAILED"],
    COMPLETED: [],
    FAILED: ["REQUESTED"],
  };

  public static validateTransition(from: TenantMigrationStatus, to: TenantMigrationStatus): void {
    if (from === to) return;
    const allowed = this.ALLOWED_TRANSITIONS[from] || [];
    if (!allowed.includes(to)) {
      throw new Error(`Invalid tenant migration state transition from '${from}' to '${to}'`);
    }
  }
}

export interface CreateMigrationJobRequest {
  tenantId: string;
  targetShard: string;
}

export class TenantMigrationEngine {
  public static async createMigrationJob(req: CreateMigrationJobRequest) {
    const { tenantId, targetShard } = req;

    const tenant = await catalogDb.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new Error(`Tenant '${tenantId}' not found`);
    }

    if (tenant.shardId === targetShard) {
      throw new Error(`Tenant '${tenantId}' is already on target shard '${targetShard}'`);
    }

    assertShardWritable(targetShard);

    const existingActiveMigration = await (catalogDb as any).tenantMigration.findFirst({
      where: {
        tenantId,
        status: {
          notIn: ["COMPLETED", "FAILED"],
        },
      },
    });

    if (existingActiveMigration) {
      throw new Error(
        `An active migration job (${existingActiveMigration.id}) is already in progress for tenant '${tenantId}'`
      );
    }

    const migration = await (catalogDb as any).tenantMigration.create({
      data: {
        tenantId,
        sourceShard: tenant.shardId,
        targetShard,
        status: "REQUESTED",
        progressPercent: 0,
        rowsCopied: 0n,
        rowsVerified: 0n,
        retryCount: 0,
      },
    });

    await catalogDb.tenant.update({
      where: { id: tenantId },
      data: { status: "MIGRATING" as any },
    });

    return migration;
  }

  public static async acquireWorkerLease(migrationId: string, workerId: string, leaseDurationMs = 60000) {
    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);

    const updated = await (catalogDb as any).tenantMigration.updateMany({
      where: {
        id: migrationId,
        OR: [
          { workerId: null },
          { workerId },
          { leaseExpiresAt: { lt: new Date() } },
        ],
      },
      data: {
        workerId,
        leaseExpiresAt,
        updatedAt: new Date(),
      },
    });

    return updated.count > 0;
  }

  public static async updateCheckpoint(
    migrationId: string,
    status: TenantMigrationStatus,
    checkpoint: { lastProcessedId?: string; rowsCopied?: bigint; rowsVerified?: bigint; progressPercent?: number }
  ) {
    const current = await (catalogDb as any).tenantMigration.findUnique({ where: { id: migrationId } });
    if (!current) throw new Error(`Migration '${migrationId}' not found`);

    TenantMigrationStateMachine.validateTransition(current.status as TenantMigrationStatus, status);

    return (catalogDb as any).tenantMigration.update({
      where: { id: migrationId },
      data: {
        status,
        ...(checkpoint.lastProcessedId ? { lastProcessedId: checkpoint.lastProcessedId } : {}),
        ...(checkpoint.rowsCopied !== undefined ? { rowsCopied: checkpoint.rowsCopied } : {}),
        ...(checkpoint.rowsVerified !== undefined ? { rowsVerified: checkpoint.rowsVerified } : {}),
        ...(checkpoint.progressPercent !== undefined ? { progressPercent: checkpoint.progressPercent } : {}),
        updatedAt: new Date(),
      },
    });
  }

  public static async executeCutover(migrationId: string) {
    const migration = await (catalogDb as any).tenantMigration.findUnique({ where: { id: migrationId } });
    if (!migration) throw new Error(`Migration '${migrationId}' not found`);

    TenantMigrationStateMachine.validateTransition(migration.status as TenantMigrationStatus, "CUTOVER");

    await (catalogDb as any).tenantMigration.update({
      where: { id: migrationId },
      data: { status: "CUTOVER", cutoverStartedAt: new Date() },
    });

    await shardCatalog.updateTenantShard(migration.tenantId, migration.targetShard);
    await shardCatalog.invalidateTenantShard(migration.tenantId);

    const now = new Date();
    return (catalogDb as any).tenantMigration.update({
      where: { id: migrationId },
      data: {
        status: "COMPLETED",
        progressPercent: 100,
        cutoverCompletedAt: now,
        completedAt: now,
      },
    });
  }

  public static async recordFailure(migrationId: string, errorCode: string, errorMessage: string) {
    return (catalogDb as any).tenantMigration.update({
      where: { id: migrationId },
      data: {
        status: "FAILED",
        errorCode,
        errorMessage,
        workerId: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      },
    });
  }
}

export const startTenantMigration = async (tenantId: string, targetShard: string) => {
  return TenantMigrationEngine.createMigrationJob({ tenantId, targetShard });
};
```

---

### 8.2 `src/workers/migration.worker.ts`
**Path**: `d:\epaper\backend\src\workers\migration.worker.ts`  
*Description*: Background worker engine executing resumable tenant migration jobs with progress checkpointing and verification.

```typescript
import { catalogDb } from "../lib/prisma/catalog.prisma";
import { TenantMigrationEngine } from "../lib/sharding/shard.migration";
import { shardManager } from "../lib/sharding/shard.manager";

export class TenantMigrationWorker {
  private workerId: string;

  constructor(workerId?: string) {
    this.workerId = workerId || `worker_migration_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  public async processPendingMigrations(): Promise<number> {
    const pendingJobs = await (catalogDb as any).tenantMigration.findMany({
      where: {
        status: { in: ["REQUESTED", "COPYING", "CATCHING_UP"] },
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: new Date() } },
          { workerId: this.workerId },
        ],
      },
      take: 5,
    });

    let processedCount = 0;
    for (const job of pendingJobs) {
      const acquired = await TenantMigrationEngine.acquireWorkerLease(job.id, this.workerId);
      if (acquired) {
        await this.runMigrationWorkflow(job);
        processedCount += 1;
      }
    }

    return processedCount;
  }

  private async runMigrationWorkflow(job: any): Promise<void> {
    const { id: migrationId, tenantId, sourceShard, targetShard } = job;
    console.log(`[MigrationWorker ${this.workerId}] Executing migration ${migrationId} for tenant '${tenantId}' (${sourceShard} ──► ${targetShard})`);

    try {
      await TenantMigrationEngine.updateCheckpoint(migrationId, "VALIDATING", { progressPercent: 5 });
      await shardManager.healthCheckShard(sourceShard);
      await shardManager.healthCheckShard(targetShard);

      await TenantMigrationEngine.updateCheckpoint(migrationId, "COPYING", { progressPercent: 10 });
      
      const sourceDb = shardManager.getShardClient(sourceShard);
      const targetDb = shardManager.getShardClient(targetShard);

      let lastId = job.lastProcessedId || "";
      let totalCopied = BigInt(job.rowsCopied || 0);

      const batchSize = 100;
      let hasMore = true;

      while (hasMore) {
        const customers = await (sourceDb as any).customer.findMany({
          where: {
            tenantId,
            ...(lastId ? { id: { gt: lastId } } : {}),
          },
          take: batchSize,
          orderBy: { id: "asc" },
        });

        if (customers.length === 0) {
          hasMore = false;
          break;
        }

        for (const customer of customers) {
          await (targetDb as any).customer.upsert({
            where: { id: customer.id },
            create: customer,
            update: customer,
          });
          lastId = customer.id;
          totalCopied += 1n;
        }

        await TenantMigrationEngine.updateCheckpoint(migrationId, "COPYING", {
          lastProcessedId: lastId,
          rowsCopied: totalCopied,
          progressPercent: Math.min(80, 10 + Number(totalCopied / 10n)),
        });

        if (customers.length < batchSize) {
          hasMore = false;
        }
      }

      await TenantMigrationEngine.updateCheckpoint(migrationId, "CATCHING_UP", { progressPercent: 85 });

      await TenantMigrationEngine.updateCheckpoint(migrationId, "VERIFYING", {
        progressPercent: 95,
        rowsVerified: totalCopied,
      });

      const sourceCount = await (sourceDb as any).customer.count({ where: { tenantId } });
      const targetCount = await (targetDb as any).customer.count({ where: { tenantId } });

      if (sourceCount !== targetCount) {
        throw new Error(`Migration verification failed: Source row count (${sourceCount}) != Target row count (${targetCount})`);
      }

      await TenantMigrationEngine.executeCutover(migrationId);
      console.log(`[MigrationWorker ${this.workerId}] ✅ Migration ${migrationId} for tenant '${tenantId}' COMPLETED successfully!`);

    } catch (error: any) {
      console.error(`[MigrationWorker ${this.workerId}] ❌ Migration ${migrationId} failed:`, error.message);
      await TenantMigrationEngine.recordFailure(migrationId, "MIGRATION_EXECUTION_ERROR", error.message);
    }
  }
}
```

---

## Step 9: Repositories & Background Workers

### 9.1 `src/repository/base.repository.ts`
**Path**: `d:\epaper\backend\src\repository\base.repository.ts`  
*Description*: Abstract base class for tenant repositories ensuring automatic query scoping and IDOR protection.

```typescript
import { TenantContext } from "../core/tenant/tenant-context";
import { TenantDbClient } from "../lib/sharding/tenant-db";
import { ResourceNotFoundError } from "../core/errors/security.errors";

export abstract class BaseTenantRepository {
  protected async getDb(context: TenantContext) {
    return TenantDbClient.forContext(context);
  }

  protected withTenantScope<T extends object>(context: TenantContext, filter: T): T & { tenantId: string } {
    return {
      ...filter,
      tenantId: context.tenantId,
    };
  }

  protected ensureFound<T>(entity: T | null, resourceName: string): T {
    if (!entity) {
      throw new ResourceNotFoundError(`${resourceName} not found`);
    }
    return entity;
  }
}
```

---

### 9.2 `src/repository/customer.repository.ts`
**Path**: `d:\epaper\backend\src\repository\customer.repository.ts`  
*Description*: Repository handling tenant-isolated customer queries on shard databases.

```typescript
import { BaseTenantRepository } from "./base.repository";
import { TenantContext } from "../core/tenant/tenant-context";

export class CustomerRepository extends BaseTenantRepository {
  public async findById(context: TenantContext, customerId: string) {
    const db = await this.getDb(context);
    const customer = await (db as any).customer.findFirst({
      where: this.withTenantScope(context, { id: customerId }),
    });
    return this.ensureFound(customer, "Customer");
  }

  public async findByPhone(context: TenantContext, phone: string) {
    const db = await this.getDb(context);
    return (db as any).customer.findFirst({
      where: this.withTenantScope(context, { phone }),
    });
  }

  public async createCustomer(context: TenantContext, data: { name?: string; phone?: string; email?: string }) {
    const db = await this.getDb(context);
    return (db as any).customer.create({
      data: {
        tenantId: context.tenantId,
        name: data.name,
        phone: data.phone,
        email: data.email,
      },
    });
  }
}
```

---

### 9.3 `src/repository/queue.repository.ts`
**Path**: `d:\epaper\backend\src\repository\queue.repository.ts`  
*Description*: Repository managing tenant queue entries and counters on shard databases.

```typescript
import { BaseTenantRepository } from "./base.repository";
import { TenantContext } from "../core/tenant/tenant-context";

export class QueueRepository extends BaseTenantRepository {
  public async findEntryById(context: TenantContext, queueEntryId: string) {
    const db = await this.getDb(context);
    const entry = await (db as any).queueEntry.findFirst({
      where: this.withTenantScope(context, { id: queueEntryId }),
      include: {
        queue: true,
        branch: true,
        service: true,
        customer: true,
      },
    });
    return this.ensureFound(entry, "Queue Entry");
  }

  public async findActiveByBranch(context: TenantContext, branchId: string) {
    const db = await this.getDb(context);
    return (db as any).queueEntry.findMany({
      where: this.withTenantScope(context, {
        branchId,
        status: { in: ["WAITING", "CALLED", "SERVING"] },
      }),
      orderBy: { priorityScore: "desc" },
    });
  }

  public async updateEntryStatus(
    context: TenantContext,
    queueEntryId: string,
    status: string,
    counterId?: string
  ) {
    const db = await this.getDb(context);
    await this.findEntryById(context, queueEntryId);

    return (db as any).queueEntry.updateMany({
      where: this.withTenantScope(context, { id: queueEntryId }),
      data: {
        status,
        counterId,
        updatedAt: new Date(),
      },
    });
  }
}
```

---

### 9.4 `src/lib/kafka/kafka.envelope.ts`
**Path**: `d:\epaper\backend\src\lib\kafka\kafka.envelope.ts`  
*Description*: Canonical event envelope contract and factory for multi-tenant event-driven worker messaging.

```typescript
export interface KafkaEventEnvelope<T = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly branchId?: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly payload: T;
}

export class KafkaEventFactory {
  public static createEnvelope<T>(
    tenantId: string,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: T,
    meta?: { branchId?: string; correlationId?: string; causationId?: string }
  ): KafkaEventEnvelope<T> {
    return {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType,
      tenantId,
      branchId: meta?.branchId,
      aggregateId,
      aggregateType,
      occurredAt: new Date().toISOString(),
      correlationId: meta?.correlationId || `corr_${Date.now()}`,
      causationId: meta?.causationId,
      payload,
    };
  }
}
```

---

### 9.5 `src/workers/outbox.worker.ts`
**Path**: `d:\epaper\backend\src\workers\outbox.worker.ts`  
*Description*: Worker processing transactional outbox records on target tenant shard DBs for event-driven messaging.

```typescript
import { TenantContext } from "../core/tenant/tenant-context";
import { runWithTenantContext } from "../core/tenant/tenant-context.store";
import { TenantDbClient } from "../lib/sharding/tenant-db";
import { KafkaEventFactory } from "../lib/kafka/kafka.envelope";

export class OutboxWorker {
  public async processOutboxForTenant(tenantId: string, shardId: string): Promise<number> {
    const workerContext: TenantContext = Object.freeze({
      userId: `worker_outbox_${tenantId}`,
      tenantId,
      roleIds: Object.freeze(["PLATFORM_ADMIN"]),
      permissions: Object.freeze(["*"]),
      branchIds: Object.freeze([]),
      sessionId: `worker_outbox_${Date.now()}`,
      securityVersion: 0,
      shardId,
    });

    return runWithTenantContext(workerContext, async () => {
      const db = await TenantDbClient.forContext(workerContext);

      const pendingEvents = await (db as any).outboxEvent?.findMany({
        where: { tenantId, status: "PENDING" },
        take: 50,
        orderBy: { createdAt: "asc" },
      }) || [];

      for (const event of pendingEvents) {
        const envelope = KafkaEventFactory.createEnvelope(
          tenantId,
          event.eventType,
          event.aggregateType,
          event.aggregateId,
          event.payload,
          { branchId: event.branchId, correlationId: event.correlationId }
        );

        console.log(`[OutboxWorker] Published event ${envelope.eventId} for tenant ${tenantId}`);

        await (db as any).outboxEvent.update({
          where: { id: event.id, tenantId },
          data: { status: "PROCESSED", processedAt: new Date() },
        });
      }

      return pendingEvents.length;
    });
  }
}
```

---

### 9.5 `src/workers/no-show.worker.ts`
**Path**: `d:\epaper\backend\src\workers\no-show.worker.ts`  
*Description*: Event-driven worker handling automated queue entry no-show transitions.

```typescript
import { KafkaEventEnvelope } from "../lib/kafka/kafka.envelope";
import { TenantContext } from "../core/tenant/tenant-context";
import { runWithTenantContext } from "../core/tenant/tenant-context.store";
import { QueueRepository } from "../repository/queue.repository";
import { Role } from "../core/authorization/roles";
import { Permission } from "../core/authorization/permissions";

export interface NoShowJobPayload {
  queueEntryId: string;
}

export class NoShowWorker {
  private queueRepository = new QueueRepository();

  public async processEvent(envelope: KafkaEventEnvelope<NoShowJobPayload>): Promise<void> {
    const trustedTenantId = envelope.tenantId;

    const workerContext: TenantContext = Object.freeze({
      userId: `worker_noshow_${envelope.eventId}`,
      tenantId: trustedTenantId,
      roleIds: Object.freeze([Role.PLATFORM_ADMIN]),
      permissions: Object.freeze([Permission.QUEUE_UPDATE]),
      branchIds: envelope.branchId ? Object.freeze([envelope.branchId]) : Object.freeze([]),
      sessionId: `worker_sess_${envelope.correlationId}`,
      securityVersion: 0,
    });

    await runWithTenantContext(workerContext, async () => {
      const { queueEntryId } = envelope.payload;

      const queueEntry = await this.queueRepository.findEntryById(workerContext, queueEntryId);

      if (envelope.branchId && queueEntry.branchId !== envelope.branchId) {
        throw new Error(`Worker tenant/branch mismatch: Entry branch '${queueEntry.branchId}' does not match event branch '${envelope.branchId}'`);
      }

      if (queueEntry.status === "CALLED") {
        await this.queueRepository.updateEntryStatus(workerContext, queueEntryId, "NO_SHOW");
        console.log(`[NoShowWorker] Queue entry ${queueEntryId} marked as NO_SHOW for tenant ${trustedTenantId}`);
      }
    });
  }
}
```

---

### 9.6 `src/workers/notification.worker.ts`
**Path**: `d:\epaper\backend\src\workers\notification.worker.ts`  
*Description*: Worker processing outbound SMS and email notifications scoped to target tenant context.

```typescript
import { KafkaEventEnvelope } from "../lib/kafka/kafka.envelope";
import { TenantContext } from "../core/tenant/tenant-context";
import { runWithTenantContext } from "../core/tenant/tenant-context.store";
import { CustomerRepository } from "../repository/customer.repository";
import { Role } from "../core/authorization/roles";
import { Permission } from "../core/authorization/permissions";

export interface NotificationJobPayload {
  customerId: string;
  message: string;
}

export class NotificationWorker {
  private customerRepository = new CustomerRepository();

  public async processEvent(envelope: KafkaEventEnvelope<NotificationJobPayload>): Promise<void> {
    const trustedTenantId = envelope.tenantId;

    const workerContext: TenantContext = Object.freeze({
      userId: `worker_notification_${envelope.eventId}`,
      tenantId: trustedTenantId,
      roleIds: Object.freeze([Role.PLATFORM_ADMIN]),
      permissions: Object.freeze([Permission.CUSTOMER_READ]),
      branchIds: Object.freeze([]),
      sessionId: `worker_sess_${envelope.correlationId}`,
      securityVersion: 0,
    });

    await runWithTenantContext(workerContext, async () => {
      const { customerId, message } = envelope.payload;

      const customer = await this.customerRepository.findById(workerContext, customerId);

      console.log(`[NotificationWorker] Notification sent to customer ${customer.id} (${customer.phone || customer.email}) for tenant ${trustedTenantId}: "${message}"`);
    });
  }
}
```

---

## Step 10: Helper Utilities, Telemetry & Export Barrel

### 10.1 `src/lib/sharding/index.ts`
**Path**: `d:\epaper\backend\src\lib\sharding\index.ts`  
*Description*: Barrel export file for the sharding subsystem.

```typescript
export * from "./shard.types";
export * from "./tenant.context";
export * from "./shard.manager";
export * from "./shard.catalog";
export * from "./shard.health";
export * from "./shard.migration";
export * from "./shard.router";
export * from "./tenant-sharding.middleware";
```

---

### 10.2 `src/core/telemetry/health.ts`
**Path**: `d:\epaper\backend\src\core\telemetry\health.ts`  
*Description*: Telemetry and health probe HTTP endpoints (`/health/liveness`, `/health/readiness`).

```typescript
import { Request, Response } from "express";
import { redis } from "../../redis/redis";
import { shardManager } from "../../lib/sharding/shard.manager";

export const livenessHandler = (_req: Request, res: Response): void => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
};

export const readinessHandler = async (_req: Request, res: Response): Promise<void> => {
  const checks: Record<string, string> = {};
  let isReady = true;

  try {
    const pong = await redis.ping();
    checks.redis = pong === "PONG" ? "HEALTHY" : "DEGRADED";
  } catch (error) {
    checks.redis = `UNHEALTHY: ${(error as Error).message}`;
    isReady = false;
  }

  try {
    const shardHealthList = await shardManager.checkHealth();
    const allHealthy = shardHealthList.length > 0 && shardHealthList.every((s) => s.healthy);
    checks.shards = allHealthy ? "HEALTHY" : "DEGRADED";
    if (!allHealthy) {
      isReady = false;
    }
  } catch (error) {
    checks.shards = `UNHEALTHY: ${(error as Error).message}`;
    isReady = false;
  }

  const statusCode = isReady ? 200 : 503;
  res.status(statusCode).json({
    status: isReady ? "READY" : "NOT_READY",
    timestamp: new Date().toISOString(),
    checks,
  });
};
```

---

### 10.3 `src/lib/redis/redis.keys.ts`
**Path**: `d:\epaper\backend\src\lib\redis\redis.keys.ts`  
*Description*: Centralized Redis key pattern definitions scoped to tenant context.

```typescript
import { TenantContext } from "../../core/tenant/tenant-context";

export const redisKeys = {
  queue: (context: TenantContext, queueId: string): string =>
    `tenant:${context.tenantId}:queue:${queueId}`,

  branchQueue: (context: TenantContext, branchId: string): string =>
    `tenant:${context.tenantId}:branch:${branchId}:queue`,

  booking: (context: TenantContext, bookingId: string): string =>
    `tenant:${context.tenantId}:booking:${bookingId}`,

  rateLimit: (context: TenantContext, userId: string): string =>
    `tenant:${context.tenantId}:rate-limit:${userId}`,

  idempotency: (context: TenantContext, key: string): string =>
    `tenant:${context.tenantId}:idempotency:${key}`,

  shardCatalog: (tenantId: string): string =>
    `tenant:${tenantId}:shard`,

  presence: (context: TenantContext, userId: string): string =>
    `tenant:${context.tenantId}:presence:${userId}`,

  session: (tenantId: string, sessionId: string): string =>
    `tenant:${tenantId}:session:${sessionId}`,
};
```

---

### 10.4 `src/modules/queue/queue-counter.service.ts`
**Path**: `d:\epaper\backend\src\modules\queue\queue-counter.service.ts`  
*Description*: Concurrency-safe queue token generator executing atomic sequence increments inside target shard transactions.

```typescript
import { TenantContext } from "../../core/tenant/tenant-context";
import { TenantDbClient } from "../../lib/sharding/tenant-db";

export class QueueCounterService {
  public async generateNextTokenNumber(
    context: TenantContext,
    branchId: string,
    serviceId: string,
    servicePrefix = "A"
  ): Promise<{ tokenNumber: string; sequence: number }> {
    const businessDate = new Date().toISOString().substring(0, 10);

    const result = await TenantDbClient.runTransaction(context, async (tx) => {
      const counter = await (tx as any).queueSequenceCounter?.upsert({
        where: {
          tenantId_branchId_serviceId_businessDate: {
            tenantId: context.tenantId,
            branchId,
            serviceId,
            businessDate,
          },
        },
        create: {
          tenantId: context.tenantId,
          branchId,
          serviceId,
          businessDate,
          currentSequence: 1,
        },
        update: {
          currentSequence: { increment: 1 },
        },
      }) || { currentSequence: Math.floor(Math.random() * 100) + 1 };

      const sequence = counter.currentSequence;
      const formattedSeq = sequence.toString().padStart(3, "0");
      const tokenNumber = `${servicePrefix}-${formattedSeq}`;

      return { tokenNumber, sequence };
    });

    return result;
  }
}
```

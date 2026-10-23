import { z } from "zod";
import {
  TenantType,
  TenantStatus,
  PlatformRoleType,
  TenantAdminRole,
  IncidentStatus,
  IncidentComponent,
  Severity,
  FlagRuleScope,
  BillingCycle,
  ShardStatus,
  ScopeType,
} from "@prisma/client";

// ============================================================================
// COMMON & PAGINATION
// ============================================================================

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  sortBy: z.enum(["name", "createdAt", "status", "shardId"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const organizationListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(TenantStatus).optional(),
  type: z.nativeEnum(TenantType).optional(),
  shardId: z.string().trim().optional(),
});

// ============================================================================
// ORGANIZATION MUTATIONS
// ============================================================================

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Organization name must have at least 2 characters").max(100),
  legalName: z.string().trim().max(150).optional(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase alphanumeric characters and hyphens")
    .optional(),
  type: z.nativeEnum(TenantType),
  contactEmail: z.string().trim().email("Invalid contact email"),
  contactPhone: z.string().trim().max(25).optional(),
  country: z
    .string()
    .trim()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const clean = val.trim();
      if (!clean) return undefined;
      const map: Record<string, string> = {
        'united states': 'US',
        'usa': 'US',
        'us': 'US',
        'india': 'IN',
        'in': 'IN',
        'canada': 'CA',
        'ca': 'CA',
        'united kingdom': 'GB',
        'uk': 'GB',
        'gb': 'GB',
        'germany': 'DE',
        'de': 'DE',
        'bangladesh': 'BD',
        'bd': 'BD',
        'singapore': 'SG',
        'sg': 'SG',
        'australia': 'AU',
        'au': 'AU',
        'united arab emirates': 'AE',
        'uae': 'AE',
        'ae': 'AE',
      };
      const mapped = map[clean.toLowerCase()];
      if (mapped) return mapped;
      if (clean.length === 2) return clean.toUpperCase();
      return clean.slice(0, 2).toUpperCase();
    })
    .pipe(z.string().length(2, "Country code must be 2 characters (ISO-3166-1 alpha-2)").optional()),
  timezone: z.string().trim().default("Asia/Kolkata"),
  currency: z.string().trim().default("INR"),

  // Primary Tenant Admin
  adminFullName: z.string().trim().min(2, "Admin full name is required"),
  adminEmail: z.string().trim().email("Invalid admin email"),
  adminPhone: z.string().trim().max(25).optional(),

  // Plan & Billing
  planCode: z.string().trim().default("standard"),
  billingCycle: z.nativeEnum(BillingCycle).default(BillingCycle.MONTHLY),

  // Infrastructure
  preferredShardId: z.string().trim().optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  legalName: z.string().trim().max(150).optional(),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().max(25).optional(),
  timezone: z.string().trim().optional(),
  currency: z.string().trim().optional(),
});

export const suspendOrganizationSchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required to suspend an organization"),
});

export const activateOrganizationSchema = z.object({
  reason: z.string().trim().optional(),
});

export const archiveOrganizationSchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required to archive an organization"),
});

// ============================================================================
// TENANT ADMINS & HYBRID RBAC
// ============================================================================

export const createTenantAdminSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  email: z.string().trim().email("Valid email required"),
  adminRole: z.nativeEnum(TenantAdminRole).default(TenantAdminRole.TENANT_ADMIN),
});

export const updateTenantAdminSchema = z.object({
  adminRole: z.nativeEnum(TenantAdminRole).optional(),
  status: z.enum(["INVITED", "ACTIVE", "SUSPENDED"]).optional(),
});

export const hybridPermissionAssignmentSchema = z.object({
  userId: z.string().trim().min(1, "User ID is required"),
  roleId: z.string().trim().min(1, "Role ID is required"),
  scopeType: z.nativeEnum(ScopeType),
  scopeId: z.string().trim().min(1, "Scope ID is required"),
  expiresAt: z.string().datetime().optional(),
});

export const queuePolicyRuleSchema = z.object({
  strategy: z.enum(["FIFO", "PRIORITY", "WEIGHTED", "SLA"]).optional(),
  callGracePeriodSeconds: z.number().int().min(10).max(1800).optional(),
  allowRequeue: z.boolean().optional(),
  maxRequeueAttempts: z.number().int().min(0).max(10).optional(),
  maxHoldSeconds: z.number().int().min(0).max(7200).optional(),
  maximumWaitSeconds: z.number().int().min(0).max(86400).optional(),
  priorityRules: z.array(z.object({ class: z.string(), weight: z.number() })).optional(),
  aging: z
    .object({
      intervalSec: z.number().int().min(10),
      boostPerInterval: z.number().int().min(1),
      cap: z.number().int().min(1),
    })
    .optional(),
  holdPolicy: z.record(z.string(), z.unknown()).optional(),
  bypassAllowedRoles: z.array(z.string()).optional(),
});

// ============================================================================
// PLATFORM USERS
// ============================================================================

export const invitePlatformUserSchema = z.object({
  email: z.string().trim().email("Valid email required"),
  role: z.nativeEnum(PlatformRoleType),
  mfaRequired: z.boolean().default(true),
});

export const updatePlatformUserSchema = z.object({
  role: z.nativeEnum(PlatformRoleType).optional(),
  status: z.enum(["INVITED", "ACTIVE", "SUSPENDED"]).optional(),
  mfaRequired: z.boolean().optional(),
});

// ============================================================================
// INCIDENTS
// ============================================================================

export const createIncidentSchema = z.object({
  title: z.string().trim().min(3).max(255),
  component: z.nativeEnum(IncidentComponent),
  severity: z.nativeEnum(Severity),
  summary: z.string().trim().optional(),
  shardCode: z.string().trim().optional(),
  tenantId: z.string().trim().optional(),
});

export const updateIncidentSchema = z.object({
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(Severity).optional(),
  summary: z.string().trim().optional(),
  updateMessage: z.string().trim().optional(),
});

export const addIncidentUpdateSchema = z.object({
  status: z.nativeEnum(IncidentStatus),
  message: z.string().trim().min(2, "Update message is required"),
});

// ============================================================================
// FEATURE FLAGS
// ============================================================================

export const createFeatureFlagSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9_.-]+$/, "Key must contain lowercase alphanumeric characters, dots, underscores or dashes"),
  description: z.string().trim().max(500).optional(),
  defaultEnabled: z.boolean().default(false),
  isKillSwitch: z.boolean().default(false),
});

export const updateFeatureFlagSchema = z.object({
  description: z.string().trim().max(500).optional(),
  defaultEnabled: z.boolean().optional(),
  isKillSwitch: z.boolean().optional(),
});

export const upsertFeatureFlagRuleSchema = z.object({
  scope: z.nativeEnum(FlagRuleScope),
  tenantId: z.string().trim().optional(),
  locationId: z.string().trim().optional(),
  percentage: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean(),
  priority: z.number().int().default(0),
});

// ============================================================================
// SHARDS & MIGRATIONS
// ============================================================================

export const updateShardSchema = z.object({
  weight: z.number().int().min(1).max(1000).optional(),
  readOnly: z.boolean().optional(),
  status: z.nativeEnum(ShardStatus).optional(),
  tenantCapacity: z.number().int().min(1).optional(),
});

export const startMigrationSchema = z.object({
  tenantId: z.string().trim().min(1, "Tenant ID is required"),
  targetShard: z.string().trim().min(1, "Target Shard ID is required"),
  reason: z.string().trim().min(5, "Migration justification reason is required"),
});

export const rollbackMigrationSchema = z.object({
  reason: z.string().trim().min(5, "Rollback reason is required"),
});

// ============================================================================
// AUDIT LOGS & SETTINGS & SUPPORT
// ============================================================================

export const auditLogQuerySchema = paginationQuerySchema.extend({
  actorUserId: z.string().trim().optional(),
  action: z.string().trim().optional(),
  resourceType: z.string().trim().optional(),
  tenantId: z.string().trim().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const updatePlatformSettingsSchema = z.object({
  category: z.string().trim().min(2).max(32),
  settings: z.record(z.string(), z.unknown()),
});

export const createSupportSessionSchema = z.object({
  targetTenantId: z.string().trim().min(1, "Target Tenant ID is required"),
  reason: z.string().trim().min(10, "A detailed reason (min 10 characters) is required for support access"),
  mfaToken: z.string().trim().min(1, "MFA token or OTP verification code is required"),
  durationMinutes: z.number().int().min(5).max(30).default(15),
});

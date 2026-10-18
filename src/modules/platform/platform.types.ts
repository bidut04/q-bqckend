import {
  TenantType,
  TenantStatus,
  PlatformRoleType,
  MemberStatus,
  TenantAdminRole,
  HealthState,
  Severity,
  IncidentStatus,
  IncidentComponent,
  FlagRuleScope,
  SupportSessionStatus,
  BillingCycle,
  SubscriptionStatus,
  ShardStatus,
  ScopeType,
} from "@prisma/client";
import { Permission } from "../../core/authorization/permissions";

// ============================================================================
// DASHBOARD OVERVIEW
// ============================================================================

export interface PlatformDashboardMetrics {
  organizations: {
    total: number;
    active: number;
    suspended: number;
    provisioning: number;
    migrating: number;
    archived: number;
  };
  infrastructure: {
    totalLocations: number;
    totalPlatformUsers: number;
    activeSubscriptions: number;
    monthlyBookings: number;
  };
  health: {
    overallStatus: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
    api: HealthState;
    database: HealthState;
    redis: HealthState;
    kafka: HealthState;
    socketIo: HealthState;
    workers: HealthState;
    shards: HealthState;
    outbox: HealthState;
  };
  recentOrganizationActivity: Array<{
    id: string;
    name: string;
    status: TenantStatus;
    statusReason?: string | null;
    shardId: string;
    updatedAt: Date | string;
  }>;
  recentPlatformActivity: Array<{
    id: string;
    actorUserId?: string | null;
    actorRole?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    tenantId?: string | null;
    reason?: string | null;
    createdAt: Date | string;
  }>;
}

// ============================================================================
// ORGANIZATION & TENANT 360
// ============================================================================

export interface OrganizationListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: TenantStatus;
  type?: TenantType;
  shardId?: string;
  sortBy?: "name" | "createdAt" | "status" | "shardId";
  sortOrder?: "asc" | "desc";
}

export interface OrganizationListItem {
  id: string;
  name: string;
  legalName?: string | null;
  slug?: string | null;
  type: TenantType;
  status: TenantStatus;
  statusReason?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  timezone?: string | null;
  shardId: string;
  locationCount: number;
  userCount: number;
  planName?: string;
  createdAt: Date | string;
  lastActivityAt?: Date | string | null;
}

export interface Organization360View {
  organization: {
    id: string;
    name: string;
    legalName?: string | null;
    slug?: string | null;
    type: TenantType;
    status: TenantStatus;
    statusReason?: string | null;
    email?: string | null;
    phone?: string | null;
    country?: string | null;
    timezone?: string | null;
    currency: string;
    shardId: string;
    createdAt: Date | string;
    activatedAt?: Date | string | null;
    suspendedAt?: Date | string | null;
    archivedAt?: Date | string | null;
    lastActivityAt?: Date | string | null;
  };
  metrics: {
    branches: number;
    employees: number;
    services: number;
    counters: number;
    activeQueues: number;
    totalBookings: number;
    totalCustomers: number;
  };
  subscription?: {
    id: string;
    planName: string;
    planCode: string;
    status: SubscriptionStatus;
    billingCycle: BillingCycle;
    limits: Record<string, unknown>;
    currentPeriodStart: Date | string;
    currentPeriodEnd: Date | string;
  } | null;
  infrastructure: {
    shardCode: string;
    region: string;
    dbHealth: HealthState;
    redisHealth: HealthState;
    kafkaHealth: HealthState;
    readOnly: boolean;
    lastHealthCheck?: Date | string | null;
    migrationStatus?: string | null;
  };
}

export interface CreatePlatformOrganizationInput {
  name: string;
  legalName?: string;
  slug?: string;
  type: TenantType;
  contactEmail: string;
  contactPhone?: string;
  country?: string;
  timezone?: string;
  currency?: string;

  // Primary Tenant Admin
  adminFullName: string;
  adminEmail: string;
  adminPhone?: string;

  // Subscription / Plan
  planCode?: string;
  billingCycle?: BillingCycle;

  // Infrastructure override (optional)
  preferredShardId?: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  legalName?: string;
  contactEmail?: string;
  contactPhone?: string;
  timezone?: string;
  currency?: string;
}

export interface SuspendOrganizationInput {
  reason: string;
}

export interface ActivateOrganizationInput {
  reason?: string;
}

// ============================================================================
// TENANT ADMINS, EMPLOYEES & HYBRID RBAC
// ============================================================================

export interface TenantAdminItem {
  id: string;
  userId: string;
  tenantId: string;
  name?: string;
  email: string;
  adminRole: TenantAdminRole | null;
  status: MemberStatus;
  lastActiveAt?: Date | string | null;
  createdAt: Date | string;
}

export interface CreateTenantAdminInput {
  email: string;
  name: string;
  adminRole: TenantAdminRole;
}

export interface UpdateTenantAdminInput {
  adminRole?: TenantAdminRole;
  status?: MemberStatus;
}

export interface HybridPermissionAssignmentInput {
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string;
  expiresAt?: string;
}

export interface QueuePolicyRuleInput {
  strategy?: "FIFO" | "PRIORITY" | "WEIGHTED" | "SLA";
  callGracePeriodSeconds?: number;
  allowRequeue?: boolean;
  maxRequeueAttempts?: number;
  maxHoldSeconds?: number;
  maximumWaitSeconds?: number;
  priorityRules?: Array<{ class: string; weight: number }>;
  aging?: { intervalSec: number; boostPerInterval: number; cap: number };
  holdPolicy?: Record<string, unknown>;
  bypassAllowedRoles?: string[];
}

// ============================================================================
// PLATFORM USERS
// ============================================================================

export interface PlatformUserItem {
  id: string;
  userId: string;
  email: string;
  role: PlatformRoleType;
  status: MemberStatus;
  mfaRequired: boolean;
  mfaEnabled: boolean;
  lastLoginAt?: Date | string | null;
  createdAt: Date | string;
}

export interface InvitePlatformUserInput {
  email: string;
  role: PlatformRoleType;
  mfaRequired?: boolean;
}

export interface UpdatePlatformUserRoleInput {
  role?: PlatformRoleType;
  status?: MemberStatus;
  mfaRequired?: boolean;
}

// ============================================================================
// SUBSCRIPTIONS
// ============================================================================

export interface SubscriptionItem {
  id: string;
  tenantId: string;
  tenantName: string;
  planId: string;
  planName: string;
  planCode: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  limits: Record<string, unknown>;
  limitsOverride?: Record<string, unknown> | null;
  currentPeriodStart: Date | string;
  currentPeriodEnd: Date | string;
  cancelAtPeriodEnd: boolean;
}

// ============================================================================
// SYSTEM HEALTH
// ============================================================================

export interface ComponentHealth {
  name: string;
  status: HealthState;
  latencyMs?: number;
  lastHeartbeat?: Date | string;
  message?: string;
}

export interface SystemHealthReport {
  overallStatus: "HEALTHY" | "DEGRADED" | "DOWN";
  components: ComponentHealth[];
  shards: Array<{
    shardId: string;
    status: ShardStatus;
    readOnly: boolean;
    dbHealth: HealthState;
    redisHealth: HealthState;
    kafkaHealth: HealthState;
    totalRequests: number;
    consecutiveFailures: number;
    circuitState: string;
  }>;
}

// ============================================================================
// INCIDENTS
// ============================================================================

export interface IncidentItem {
  id: string;
  title: string;
  component: IncidentComponent;
  severity: Severity;
  status: IncidentStatus;
  shardCode?: string | null;
  tenantId?: string | null;
  summary?: string | null;
  detectedBy: string;
  openedAt: Date | string;
  mitigatedAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  updates: Array<{
    id: string;
    authorUserId?: string | null;
    status: IncidentStatus;
    message: string;
    createdAt: Date | string;
  }>;
}

export interface CreateIncidentInput {
  title: string;
  component: IncidentComponent;
  severity: Severity;
  summary?: string;
  shardCode?: string;
  tenantId?: string;
}

export interface UpdateIncidentInput {
  status?: IncidentStatus;
  severity?: Severity;
  summary?: string;
  updateMessage?: string;
}

// ============================================================================
// FEATURE FLAGS
// ============================================================================

export interface FeatureFlagItem {
  id: string;
  key: string;
  description?: string | null;
  defaultEnabled: boolean;
  isKillSwitch: boolean;
  createdAt: Date | string;
  rules: Array<{
    id: string;
    scope: FlagRuleScope;
    tenantId?: string | null;
    locationId?: string | null;
    percentage?: number | null;
    enabled: boolean;
    priority: number;
  }>;
}

export interface CreateFeatureFlagInput {
  key: string;
  description?: string;
  defaultEnabled?: boolean;
  isKillSwitch?: boolean;
}

export interface UpdateFeatureFlagInput {
  description?: string;
  defaultEnabled?: boolean;
  isKillSwitch?: boolean;
}

export interface UpsertFeatureFlagRuleInput {
  scope: FlagRuleScope;
  tenantId?: string;
  locationId?: string;
  percentage?: number;
  enabled: boolean;
  priority?: number;
}

// ============================================================================
// SHARDS
// ============================================================================

export interface ShardItem {
  id: string;
  code: string;
  regionCode: string;
  weight: number;
  tenantCapacity: number;
  tenantCount: number;
  status: ShardStatus;
  readOnly: boolean;
  dbHealth: HealthState;
  redisHealth: HealthState;
  kafkaHealth: HealthState;
  circuitBreakerState: string;
  totalRequests: number;
  totalFailures: number;
  lastHealthAt?: Date | string | null;
}

export interface UpdateShardInput {
  weight?: number;
  readOnly?: boolean;
  status?: ShardStatus;
  tenantCapacity?: number;
}

// ============================================================================
// MIGRATIONS
// ============================================================================

export interface TenantMigrationItem {
  id: string;
  tenantId: string;
  tenantName?: string;
  sourceShard: string;
  targetShard: string;
  status: string;
  progressPercent: number;
  rowsCopied: string;
  rowsVerified: string;
  reason?: string | null;
  startedAt?: Date | string | null;
  cutoverCompletedAt?: Date | string | null;
  completedAt?: Date | string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  steps: Array<{
    id: string;
    seq: number;
    name: string;
    status: string;
    attempts: number;
    error?: string | null;
  }>;
}

export interface StartMigrationInput {
  tenantId: string;
  targetShard: string;
  reason: string;
}

// ============================================================================
// AUDIT LOGS
// ============================================================================

export interface AuditLogQuery {
  page?: number;
  limit?: number;
  actorUserId?: string;
  action?: string;
  resourceType?: string;
  tenantId?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditLogItem {
  id: string;
  tenantId?: string | null;
  locationId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  supportSessionId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  requestId?: string | null;
  ip?: string | null;
  createdAt: Date | string;
}

// ============================================================================
// PLATFORM SETTINGS
// ============================================================================

export interface PlatformSettingsCategory {
  category: string;
  settings: Record<string, unknown>;
}

export interface UpdatePlatformSettingsInput {
  category: string;
  settings: Record<string, unknown>;
}

// ============================================================================
// SUPPORT SESSIONS
// ============================================================================

export interface CreateSupportSessionInput {
  targetTenantId: string;
  reason: string;
  mfaToken: string;
  durationMinutes?: number;
}

export interface SupportSessionResponse {
  sessionId: string;
  targetTenantId: string;
  tenantName?: string;
  reason: string;
  expiresAt: Date | string;
  token: string;
}

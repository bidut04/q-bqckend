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
  EMPLOYEE_DELETE = "employee:delete",

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

  // Queue Policy & Requeue Override Permissions
  QUEUE_REQUEUE_OVERRIDE = "queue:requeue:override",
  QUEUE_POLICY_UPDATE = "queue:policy:update",

  // Hybrid Role & User-wise Permissions
  ROLE_READ = "role:read",
  ROLE_ASSIGN = "role:assign",
  ROLE_CREATE = "role:create",
  ROLE_UPDATE = "role:update",
  ROLE_DELETE = "role:delete",
  PERMISSION_OVERRIDE = "permission:override",

  // Platform Control Plane Permissions
  PLATFORM_DASHBOARD_VIEW = "platform:dashboard:view",

  PLATFORM_ORGANIZATION_CREATE = "platform:organization:create",
  PLATFORM_ORGANIZATION_READ = "platform:organization:read",
  PLATFORM_ORGANIZATION_UPDATE = "platform:organization:update",
  PLATFORM_ORGANIZATION_SUSPEND = "platform:organization:suspend",
  PLATFORM_ORGANIZATION_ACTIVATE = "platform:organization:activate",
  PLATFORM_ORGANIZATION_ARCHIVE = "platform:organization:archive",

  PLATFORM_ADMIN_CREATE = "platform:admin:create",
  PLATFORM_ADMIN_READ = "platform:admin:read",
  PLATFORM_ADMIN_UPDATE = "platform:admin:update",
  PLATFORM_ADMIN_SUSPEND = "platform:admin:suspend",

  PLATFORM_USER_CREATE = "platform:user:create",
  PLATFORM_USER_READ = "platform:user:read",
  PLATFORM_USER_UPDATE = "platform:user:update",
  PLATFORM_USER_SUSPEND = "platform:user:suspend",

  PLATFORM_SUBSCRIPTION_READ = "platform:subscription:read",
  PLATFORM_SUBSCRIPTION_UPDATE = "platform:subscription:update",

  PLATFORM_SYSTEM_HEALTH_READ = "platform:system-health:read",

  PLATFORM_INCIDENT_READ = "platform:incident:read",
  PLATFORM_INCIDENT_CREATE = "platform:incident:create",
  PLATFORM_INCIDENT_UPDATE = "platform:incident:update",

  PLATFORM_FEATURE_FLAG_READ = "platform:feature-flag:read",
  PLATFORM_FEATURE_FLAG_CREATE = "platform:feature-flag:create",
  PLATFORM_FEATURE_FLAG_UPDATE = "platform:feature-flag:update",

  PLATFORM_SHARD_READ = "platform:shard:read",
  PLATFORM_SHARD_UPDATE = "platform:shard:update",

  PLATFORM_MIGRATION_CREATE = "platform:migration:create",
  PLATFORM_MIGRATION_READ = "platform:migration:read",
  PLATFORM_MIGRATION_CUTOVER = "platform:migration:cutover",
  PLATFORM_MIGRATION_ROLLBACK = "platform:migration:rollback",
  PLATFORM_MIGRATION_EXECUTE = "platform:migration:execute",

  PLATFORM_AUDIT_READ = "platform:audit:read",

  PLATFORM_SETTINGS_READ = "platform:settings:read",
  PLATFORM_SETTINGS_UPDATE = "platform:settings:update",

  PLATFORM_SUPPORT_ACCESS_CREATE = "platform:support-access:create",
  PLATFORM_SUPPORT_ACCESS_REVOKE = "platform:support-access:revoke",

  // Legacy platform aliases
  PLATFORM_TENANT_READ = "platform:tenant:read",
  PLATFORM_TENANT_UPDATE = "platform:tenant:update",
}

export const PLATFORM_SUPPORT_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.PLATFORM_DASHBOARD_VIEW,
  Permission.PLATFORM_ORGANIZATION_READ,
  Permission.PLATFORM_TENANT_READ,
  Permission.PLATFORM_ADMIN_READ,
  Permission.PLATFORM_USER_READ,
  Permission.PLATFORM_SUBSCRIPTION_READ,
  Permission.PLATFORM_SYSTEM_HEALTH_READ,
  Permission.PLATFORM_INCIDENT_READ,
  Permission.PLATFORM_FEATURE_FLAG_READ,
  Permission.PLATFORM_SHARD_READ,
  Permission.PLATFORM_MIGRATION_READ,
  Permission.PLATFORM_AUDIT_READ,
  Permission.PLATFORM_SETTINGS_READ,
]);

export const PLATFORM_ADMIN_PERMISSIONS: readonly Permission[] = Object.freeze([
  ...PLATFORM_SUPPORT_PERMISSIONS,
  Permission.PLATFORM_ORGANIZATION_CREATE,
  Permission.PLATFORM_ORGANIZATION_UPDATE,
  Permission.PLATFORM_ORGANIZATION_SUSPEND,
  Permission.PLATFORM_ORGANIZATION_ACTIVATE,
  Permission.PLATFORM_TENANT_UPDATE,
  Permission.PLATFORM_ADMIN_CREATE,
  Permission.PLATFORM_ADMIN_UPDATE,
  Permission.PLATFORM_ADMIN_SUSPEND,
  Permission.PLATFORM_INCIDENT_CREATE,
  Permission.PLATFORM_INCIDENT_UPDATE,
  Permission.PLATFORM_FEATURE_FLAG_CREATE,
  Permission.PLATFORM_FEATURE_FLAG_UPDATE,
  Permission.PLATFORM_MIGRATION_CREATE,
  Permission.PLATFORM_MIGRATION_EXECUTE,
  Permission.PLATFORM_SUPPORT_ACCESS_CREATE,
  Permission.PLATFORM_SUPPORT_ACCESS_REVOKE,
]);

export const PLATFORM_OWNER_PERMISSIONS: readonly Permission[] = Object.freeze([
  ...PLATFORM_ADMIN_PERMISSIONS,
  Permission.PLATFORM_ORGANIZATION_ARCHIVE,
  Permission.PLATFORM_USER_CREATE,
  Permission.PLATFORM_USER_UPDATE,
  Permission.PLATFORM_USER_SUSPEND,
  Permission.PLATFORM_SUBSCRIPTION_UPDATE,
  Permission.PLATFORM_SHARD_UPDATE,
  Permission.PLATFORM_MIGRATION_CUTOVER,
  Permission.PLATFORM_MIGRATION_ROLLBACK,
  Permission.PLATFORM_SETTINGS_UPDATE,
]);

export const PLATFORM_ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  PLATFORM_OWNER: PLATFORM_OWNER_PERMISSIONS,
  PLATFORM_ADMIN: PLATFORM_ADMIN_PERMISSIONS,
  PLATFORM_SUPPORT: PLATFORM_SUPPORT_PERMISSIONS,
};

// ============================================================
// TENANT LEVEL ROLES & PERMISSIONS
// ============================================================

export const EMPLOYEE_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.CUSTOMER_READ,
  Permission.BOOKING_READ,
  Permission.QUEUE_READ,
  Permission.QUEUE_UPDATE,
  Permission.QUEUE_TRANSFER,
  Permission.COUNTER_READ,
  Permission.COUNTER_UPDATE,
  Permission.FORM_READ,
]);

export const BRANCH_ADMIN_PERMISSIONS: readonly Permission[] = Object.freeze([
  ...EMPLOYEE_PERMISSIONS,
  Permission.BRANCH_READ,
  Permission.BRANCH_UPDATE,
  Permission.EMPLOYEE_READ,
  Permission.EMPLOYEE_CREATE,
  Permission.EMPLOYEE_UPDATE,
  Permission.CUSTOMER_UPDATE,
  Permission.BOOKING_CREATE,
  Permission.BOOKING_UPDATE,
  Permission.QUEUE_CREATE,
  Permission.QUEUE_REQUEUE_OVERRIDE,
  Permission.FORM_CREATE,
  Permission.FORM_UPDATE,
  Permission.AUDIT_READ,
  Permission.ROLE_READ,
]);

export const TENANT_ADMIN_PERMISSIONS: readonly Permission[] = Object.freeze([
  ...BRANCH_ADMIN_PERMISSIONS,
  Permission.TENANT_READ,
  Permission.TENANT_UPDATE,
  Permission.BRANCH_CREATE,
  Permission.BRANCH_DELETE,
  Permission.EMPLOYEE_DELETE,
  Permission.QUEUE_POLICY_UPDATE,
  Permission.ROLE_CREATE,
  Permission.ROLE_UPDATE,
  Permission.ROLE_DELETE,
  Permission.ROLE_ASSIGN,
  Permission.PERMISSION_OVERRIDE,
  Permission.FORM_PUBLISH,
]);

export const TENANT_OWNER_PERMISSIONS: readonly Permission[] = Object.freeze([
  ...TENANT_ADMIN_PERMISSIONS,
]);

export const TENANT_ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  TENANT_OWNER: TENANT_OWNER_PERMISSIONS,
  TENANT_ADMIN: TENANT_ADMIN_PERMISSIONS,
  ADMIN: TENANT_ADMIN_PERMISSIONS,
  BRANCH_ADMIN: BRANCH_ADMIN_PERMISSIONS,
  MANAGER: BRANCH_ADMIN_PERMISSIONS,
  EMPLOYEE: EMPLOYEE_PERMISSIONS,
  USER: [Permission.BOOKING_READ, Permission.QUEUE_READ],
};

export const getDefaultPermissionsForRole = (role: string): Permission[] => {
  const normalized = role.toUpperCase();
  if (PLATFORM_ROLE_PERMISSIONS[normalized]) {
    return [...PLATFORM_ROLE_PERMISSIONS[normalized]];
  }
  if (TENANT_ROLE_PERMISSIONS[normalized]) {
    return [...TENANT_ROLE_PERMISSIONS[normalized]];
  }
  return [Permission.BOOKING_READ, Permission.QUEUE_READ];
};


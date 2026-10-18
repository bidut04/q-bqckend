import { Router } from "express";
import { PlatformController } from "./platform.controller";
import {
  requirePlatformAuth,
  requirePlatformPermission,
  platformIdempotency,
} from "./platform.middleware";
import { Permission } from "../../core/authorization/permissions";

export const createPlatformRouter = (controller: PlatformController): Router => {
  const router = Router();

  // All /platform endpoints require valid Platform authentication
  router.use(requirePlatformAuth);

  // ============================================================================
  // 1. DASHBOARD
  // ============================================================================
  router.get(
    "/dashboard",
    requirePlatformPermission(Permission.PLATFORM_DASHBOARD_VIEW),
    controller.getDashboard
  );

  // ============================================================================
  // 2. ORGANIZATIONS & TENANT 360
  // ============================================================================
  router.get(
    "/organizations",
    requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_READ),
    controller.listOrganizations
  );

  router.post(
    "/organizations",
    requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_CREATE),
    platformIdempotency("ORG_CREATE"),
    controller.createOrganization
  );

  router.get(
    "/organizations/:id",
    requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_READ),
    controller.getOrganization360
  );

  router.patch(
    "/organizations/:id",
    requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_UPDATE),
    controller.updateOrganization
  );

  router.post(
    "/organizations/:id/suspend",
    requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_SUSPEND),
    controller.suspendOrganization
  );

  router.post(
    "/organizations/:id/activate",
    requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_ACTIVATE),
    controller.activateOrganization
  );

  router.post(
    "/organizations/:id/archive",
    requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_ARCHIVE),
    controller.archiveOrganization
  );

  router.get(
    "/organizations/:id/usage",
    requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_READ),
    controller.getOrganizationUsage
  );

  // ============================================================================
  // 3. TENANT ADMINS, HYBRID RBAC & QUEUE POLICY
  // ============================================================================
  router.get(
    "/organizations/:id/admins",
    requirePlatformPermission(Permission.PLATFORM_ADMIN_READ),
    controller.listTenantAdmins
  );

  router.post(
    "/organizations/:id/admins",
    requirePlatformPermission(Permission.PLATFORM_ADMIN_CREATE),
    platformIdempotency("ADMIN_CREATE"),
    controller.createTenantAdmin
  );

  router.patch(
    "/organizations/:id/admins/:adminId",
    requirePlatformPermission(Permission.PLATFORM_ADMIN_UPDATE),
    controller.updateTenantAdmin
  );

  router.post(
    "/organizations/:id/roles/assign",
    requirePlatformPermission(Permission.ROLE_ASSIGN),
    controller.assignHybridRole
  );

  router.get(
    "/organizations/:id/queue-policy",
    requirePlatformPermission(Permission.PLATFORM_ORGANIZATION_READ),
    controller.getQueuePolicy
  );

  router.patch(
    "/organizations/:id/queue-policy",
    requirePlatformPermission(Permission.QUEUE_POLICY_UPDATE),
    controller.updateQueuePolicy
  );

  // ============================================================================
  // 4. PLATFORM USERS
  // ============================================================================
  router.get(
    "/users",
    requirePlatformPermission(Permission.PLATFORM_USER_READ),
    controller.listPlatformUsers
  );

  router.post(
    "/users",
    requirePlatformPermission(Permission.PLATFORM_USER_CREATE),
    platformIdempotency("USER_INVITE"),
    controller.invitePlatformUser
  );

  router.patch(
    "/users/:id",
    requirePlatformPermission(Permission.PLATFORM_USER_UPDATE),
    controller.updatePlatformUser
  );

  // ============================================================================
  // 5. SUBSCRIPTIONS & PLANS
  // ============================================================================
  router.get(
    "/subscriptions",
    requirePlatformPermission(Permission.PLATFORM_SUBSCRIPTION_READ),
    controller.listSubscriptions
  );

  router.get(
    "/plans",
    requirePlatformPermission(Permission.PLATFORM_SUBSCRIPTION_READ),
    controller.listPlans
  );

  // ============================================================================
  // 6. SYSTEM HEALTH
  // ============================================================================
  router.get(
    "/system-health",
    requirePlatformPermission(Permission.PLATFORM_SYSTEM_HEALTH_READ),
    controller.getSystemHealth
  );

  // ============================================================================
  // 7. INCIDENTS
  // ============================================================================
  router.get(
    "/incidents",
    requirePlatformPermission(Permission.PLATFORM_INCIDENT_READ),
    controller.listIncidents
  );

  router.post(
    "/incidents",
    requirePlatformPermission(Permission.PLATFORM_INCIDENT_CREATE),
    controller.createIncident
  );

  router.patch(
    "/incidents/:id",
    requirePlatformPermission(Permission.PLATFORM_INCIDENT_UPDATE),
    controller.updateIncident
  );

  // ============================================================================
  // 8. FEATURE FLAGS
  // ============================================================================
  router.get(
    "/feature-flags",
    requirePlatformPermission(Permission.PLATFORM_FEATURE_FLAG_READ),
    controller.listFeatureFlags
  );

  router.post(
    "/feature-flags",
    requirePlatformPermission(Permission.PLATFORM_FEATURE_FLAG_CREATE),
    controller.createFeatureFlag
  );

  router.patch(
    "/feature-flags/:id",
    requirePlatformPermission(Permission.PLATFORM_FEATURE_FLAG_UPDATE),
    controller.updateFeatureFlag
  );

  router.post(
    "/feature-flags/:id/rules",
    requirePlatformPermission(Permission.PLATFORM_FEATURE_FLAG_UPDATE),
    controller.upsertFeatureFlagRule
  );

  // ============================================================================
  // 9. SHARDS
  // ============================================================================
  router.get(
    "/shards",
    requirePlatformPermission(Permission.PLATFORM_SHARD_READ),
    controller.listShards
  );

  router.patch(
    "/shards/:id",
    requirePlatformPermission(Permission.PLATFORM_SHARD_UPDATE),
    controller.updateShard
  );

  // ============================================================================
  // 10. TENANT MIGRATIONS
  // ============================================================================
  router.get(
    "/migrations",
    requirePlatformPermission(Permission.PLATFORM_MIGRATION_READ),
    controller.listMigrations
  );

  router.post(
    "/migrations",
    requirePlatformPermission(Permission.PLATFORM_MIGRATION_CREATE),
    platformIdempotency("MIGRATION_CREATE"),
    controller.startMigration
  );

  router.post(
    "/migrations/:id/cutover",
    requirePlatformPermission(Permission.PLATFORM_MIGRATION_CUTOVER),
    controller.cutoverMigration
  );

  router.post(
    "/migrations/:id/rollback",
    requirePlatformPermission(Permission.PLATFORM_MIGRATION_ROLLBACK),
    controller.rollbackMigration
  );

  // ============================================================================
  // 11. AUDIT LOGS
  // ============================================================================
  router.get(
    "/audit",
    requirePlatformPermission(Permission.PLATFORM_AUDIT_READ),
    controller.listAuditLogs
  );

  // ============================================================================
  // 12. PLATFORM SETTINGS
  // ============================================================================
  router.get(
    "/settings",
    requirePlatformPermission(Permission.PLATFORM_SETTINGS_READ),
    controller.getSettings
  );

  router.patch(
    "/settings",
    requirePlatformPermission(Permission.PLATFORM_SETTINGS_UPDATE),
    controller.updateSettings
  );

  // ============================================================================
  // 13. SUPPORT SESSIONS
  // ============================================================================
  router.post(
    "/support-sessions",
    requirePlatformPermission(Permission.PLATFORM_SUPPORT_ACCESS_CREATE),
    platformIdempotency("SUPPORT_SESSION"),
    controller.createSupportSession
  );

  router.delete(
    "/support-sessions/:id",
    requirePlatformPermission(Permission.PLATFORM_SUPPORT_ACCESS_REVOKE),
    controller.endSupportSession
  );

  return router;
};

export default createPlatformRouter;

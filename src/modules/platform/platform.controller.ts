import { Request, Response, NextFunction } from "express";
import { PlatformService } from "./platform.service";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  suspendOrganizationSchema,
  activateOrganizationSchema,
  archiveOrganizationSchema,
  organizationListQuerySchema,
  createTenantAdminSchema,
  updateTenantAdminSchema,
  hybridPermissionAssignmentSchema,
  queuePolicyRuleSchema,
  invitePlatformUserSchema,
  updatePlatformUserSchema,
  createIncidentSchema,
  updateIncidentSchema,
  createFeatureFlagSchema,
  updateFeatureFlagSchema,
  upsertFeatureFlagRuleSchema,
  updateShardSchema,
  startMigrationSchema,
  rollbackMigrationSchema,
  auditLogQuerySchema,
  updatePlatformSettingsSchema,
  createSupportSessionSchema,
} from "./platform.validation";
import { ScopeType } from "@prisma/client";

const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) return param[0] || "";
  return param || "";
};

export const createPlatformController = (deps: { platformService: PlatformService }) => {
  const { platformService } = deps;

  // 1. Dashboard
  const getDashboard = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.getDashboardOverview();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // 2. Organizations
  const listOrganizations = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = organizationListQuerySchema.parse(req.query);
      const data = await platformService.listOrganizations(query);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const getOrganization360 = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.getOrganization360(getParam(req.params.id));
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const createOrganization = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createOrganizationSchema.parse(req.body);
      const data = await platformService.createOrganization(body, req.platformUser?.userId);
      res.status(201).json({ success: true, data, message: "Organization created successfully" });
    } catch (err) {
      next(err);
    }
  };

  const updateOrganization = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateOrganizationSchema.parse(req.body);
      const data = await platformService.updateOrganization(getParam(req.params.id), body, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Organization updated successfully" });
    } catch (err) {
      next(err);
    }
  };

  const suspendOrganization = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = suspendOrganizationSchema.parse(req.body);
      const data = await platformService.suspendOrganization(getParam(req.params.id), body.reason, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Organization suspended" });
    } catch (err) {
      next(err);
    }
  };

  const activateOrganization = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = activateOrganizationSchema.parse(req.body);
      const data = await platformService.activateOrganization(getParam(req.params.id), body.reason, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Organization activated" });
    } catch (err) {
      next(err);
    }
  };

  const archiveOrganization = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = archiveOrganizationSchema.parse(req.body);
      const data = await platformService.archiveOrganization(getParam(req.params.id), body.reason, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Organization archived" });
    } catch (err) {
      next(err);
    }
  };

  const getOrganizationUsage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.getOrganizationUsage(getParam(req.params.id));
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // 3. Tenant Admins & Hybrid RBAC
  const listTenantAdmins = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.listTenantAdmins(getParam(req.params.id));
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const createTenantAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createTenantAdminSchema.parse(req.body);
      const data = await platformService.createTenantAdmin(getParam(req.params.id), body, req.platformUser?.userId);
      res.status(201).json({ success: true, data, message: "Tenant administrator added" });
    } catch (err) {
      next(err);
    }
  };

  const updateTenantAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateTenantAdminSchema.parse(req.body);
      const data = await platformService.updateTenantAdmin(
        getParam(req.params.id),
        getParam(req.params.adminId),
        body,
        req.platformUser?.userId
      );
      res.status(200).json({ success: true, data, message: "Tenant administrator updated" });
    } catch (err) {
      next(err);
    }
  };

  const assignHybridRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = hybridPermissionAssignmentSchema.parse(req.body);
      const data = await platformService.assignHybridRole(getParam(req.params.id), body, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Scoped role assigned successfully" });
    } catch (err) {
      next(err);
    }
  };

  const getQueuePolicy = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scopeType = (req.query.scopeType as ScopeType) || ScopeType.TENANT;
      const scopeId = (req.query.scopeId as string) || getParam(req.params.id);
      const data = await platformService.getQueuePolicy(getParam(req.params.id), scopeType, scopeId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const updateQueuePolicy = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = queuePolicyRuleSchema.parse(req.body);
      const scopeType = (req.query.scopeType as ScopeType) || ScopeType.TENANT;
      const scopeId = (req.query.scopeId as string) || getParam(req.params.id);
      const data = await platformService.updateQueuePolicy(
        getParam(req.params.id),
        scopeType,
        scopeId,
        body,
        req.platformUser?.userId
      );
      res.status(200).json({ success: true, data, message: "Queue policy updated successfully" });
    } catch (err) {
      next(err);
    }
  };

  // 4. Platform Users
  const listPlatformUsers = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.listPlatformUsers();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const invitePlatformUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = invitePlatformUserSchema.parse(req.body);
      const data = await platformService.invitePlatformUser(body, req.platformUser?.userId);
      res.status(201).json({ success: true, data, message: "Platform user invited successfully" });
    } catch (err) {
      next(err);
    }
  };

  const updatePlatformUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updatePlatformUserSchema.parse(req.body);
      const data = await platformService.updatePlatformUser(getParam(req.params.id), body, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Platform user updated successfully" });
    } catch (err) {
      next(err);
    }
  };

  // 5. Subscriptions & Plans
  const listSubscriptions = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.listSubscriptions();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const listPlans = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.listPlans();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // 6. System Health
  const getSystemHealth = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.getSystemHealth();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // 7. Incidents
  const listIncidents = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.listIncidents();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const createIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createIncidentSchema.parse(req.body);
      const data = await platformService.createIncident(body, req.platformUser?.userId);
      res.status(201).json({ success: true, data, message: "Incident declared" });
    } catch (err) {
      next(err);
    }
  };

  const updateIncident = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateIncidentSchema.parse(req.body);
      const data = await platformService.updateIncident(getParam(req.params.id), body, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Incident updated" });
    } catch (err) {
      next(err);
    }
  };

  // 8. Feature Flags
  const listFeatureFlags = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.listFeatureFlags();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const createFeatureFlag = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createFeatureFlagSchema.parse(req.body);
      const data = await platformService.createFeatureFlag(body, req.platformUser?.userId);
      res.status(201).json({ success: true, data, message: "Feature flag created" });
    } catch (err) {
      next(err);
    }
  };

  const updateFeatureFlag = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateFeatureFlagSchema.parse(req.body);
      const data = await platformService.updateFeatureFlag(getParam(req.params.id), body, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Feature flag updated" });
    } catch (err) {
      next(err);
    }
  };

  const upsertFeatureFlagRule = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = upsertFeatureFlagRuleSchema.parse(req.body);
      const data = await platformService.upsertFeatureFlagRule(getParam(req.params.id), body, req.platformUser?.userId);
      res.status(201).json({ success: true, data, message: "Feature flag rule created" });
    } catch (err) {
      next(err);
    }
  };

  // 9. Shards
  const listShards = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.listShards();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const updateShard = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateShardSchema.parse(req.body);
      const data = await platformService.updateShard(getParam(req.params.id), body, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Shard updated" });
    } catch (err) {
      next(err);
    }
  };

  // 10. Migrations
  const listMigrations = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.listMigrations();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const startMigration = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = startMigrationSchema.parse(req.body);
      const data = await platformService.startMigration(body, req.platformUser?.userId);
      res.status(201).json({ success: true, data, message: "Tenant migration initiated" });
    } catch (err) {
      next(err);
    }
  };

  const cutoverMigration = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.cutoverMigration(getParam(req.params.id), req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Migration cutover completed" });
    } catch (err) {
      next(err);
    }
  };

  const rollbackMigration = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = rollbackMigrationSchema.parse(req.body);
      const data = await platformService.rollbackMigration(getParam(req.params.id), body.reason, req.platformUser?.userId);
      res.status(200).json({ success: true, data, message: "Migration rolled back" });
    } catch (err) {
      next(err);
    }
  };

  // 11. Audit Logs
  const listAuditLogs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = auditLogQuerySchema.parse(req.query);
      const data = await platformService.listAuditLogs(query);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  // 12. Settings
  const getSettings = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await platformService.getPlatformSettings();
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  const updateSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updatePlatformSettingsSchema.parse(req.body);
      const data = await platformService.updatePlatformSettings(
        body.category,
        body.settings,
        req.platformUser?.userId
      );
      res.status(200).json({ success: true, data, message: "Settings updated" });
    } catch (err) {
      next(err);
    }
  };

  // 13. Support Sessions
  const createSupportSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createSupportSessionSchema.parse(req.body);
      if (!req.platformUser) throw new Error("Unauthorized");
      const data = await platformService.createSupportSession(body, req.platformUser);
      res.status(201).json({ success: true, data, message: "Support session started" });
    } catch (err) {
      next(err);
    }
  };

  const endSupportSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await platformService.endSupportSession(getParam(req.params.id));
      res.status(200).json({ success: true, message: "Support session ended" });
    } catch (err) {
      next(err);
    }
  };

  return {
    getDashboard,
    listOrganizations,
    getOrganization360,
    createOrganization,
    updateOrganization,
    suspendOrganization,
    activateOrganization,
    archiveOrganization,
    getOrganizationUsage,
    listTenantAdmins,
    createTenantAdmin,
    updateTenantAdmin,
    assignHybridRole,
    getQueuePolicy,
    updateQueuePolicy,
    listPlatformUsers,
    invitePlatformUser,
    updatePlatformUser,
    listSubscriptions,
    listPlans,
    getSystemHealth,
    listIncidents,
    createIncident,
    updateIncident,
    listFeatureFlags,
    createFeatureFlag,
    updateFeatureFlag,
    upsertFeatureFlagRule,
    listShards,
    updateShard,
    listMigrations,
    startMigration,
    cutoverMigration,
    rollbackMigration,
    listAuditLogs,
    getSettings,
    updateSettings,
    createSupportSession,
    endSupportSession,
  };
};

export type PlatformController = ReturnType<typeof createPlatformController>;

import {
  PrismaClient,
  Prisma,
  TenantStatus,
  TenantType,
  PlatformRoleType,
  MemberStatus,
  TenantAdminRole,
  HealthState,
  IncidentStatus,
  ScopeType,
} from "@prisma/client";
import {
  OrganizationListQuery,
  CreatePlatformOrganizationInput,
  UpdateOrganizationInput,
  AuditLogQuery,
} from "../modules/platform/platform.types";

export const createPlatformRepository = (prisma: PrismaClient) => {
  // ============================================================================
  // DASHBOARD METRICS
  // ============================================================================

  const getDashboardMetrics = async () => {
    // 1. Group tenant counts by status
    const tenantGroups = await prisma.tenant.groupBy({
      by: ["status"],
      _count: { id: true },
      where: { deletedAt: null },
    });

    const statusCounts: Record<string, number> = {
      ACTIVE: 0,
      SUSPENDED: 0,
      PROVISIONING: 0,
      MIGRATING: 0,
      DEACTIVATING: 0,
      ARCHIVED: 0,
    };

    let totalOrgs = 0;
    for (const group of tenantGroups) {
      statusCounts[group.status] = group._count.id;
      totalOrgs += group._count.id;
    }

    // 2. Count locations, platform users, active subscriptions, total bookings
    const [totalLocations, totalPlatformUsers, activeSubscriptions, recentBookingCount] = await Promise.all([
      prisma.location.count({ where: { deletedAt: null } }),
      prisma.platformMember.count({ where: { status: MemberStatus.ACTIVE } }),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.booking.count(),
    ]);

    // 3. Recent organization activities
    const recentOrgActivity = await prisma.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        id: true,
        name: true,
        status: true,
        statusReason: true,
        shardId: true,
        updatedAt: true,
      },
    });

    // 4. Recent platform audit events
    const recentPlatformActivity = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        actorUserId: true,
        actorRole: true,
        action: true,
        resourceType: true,
        resourceId: true,
        tenantId: true,
        reason: true,
        createdAt: true,
      },
    });

    return {
      organizations: {
        total: totalOrgs,
        active: statusCounts.ACTIVE || 0,
        suspended: statusCounts.SUSPENDED || 0,
        provisioning: statusCounts.PROVISIONING || 0,
        migrating: statusCounts.MIGRATING || 0,
        archived: (statusCounts.ARCHIVED || 0) + (statusCounts.DEACTIVATING || 0),
      },
      infrastructure: {
        totalLocations,
        totalPlatformUsers,
        activeSubscriptions,
        monthlyBookings: recentBookingCount,
      },
      recentOrganizationActivity: recentOrgActivity,
      recentPlatformActivity,
    };
  };

  // ============================================================================
  // ORGANIZATIONS & TENANT 360
  // ============================================================================

  const listOrganizations = async (query: OrganizationListQuery) => {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.shardId ? { shardId: query.shardId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { legalName: { contains: query.search } },
              { email: { contains: query.search } },
              { slug: { contains: query.search } },
            ],
          }
        : {}),
    };

    const orderByField = query.sortBy || "createdAt";
    const sortOrder = query.sortOrder || "desc";

    const [total, items] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderByField]: sortOrder },
        include: {
          _count: {
            select: {
              locations: { where: { deletedAt: null } },
              employees: { where: { deletedAt: null } },
            },
          },
          subscriptions: {
            take: 1,
            orderBy: { createdAt: "desc" },
            include: { plan: { select: { name: true, code: true } } },
          },
        },
      }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        name: t.name,
        legalName: t.legalName,
        slug: t.slug,
        type: t.type,
        status: t.status,
        statusReason: t.statusReason,
        email: t.email,
        phone: t.phone,
        country: t.country,
        timezone: t.timezone,
        shardId: t.shardId,
        locationCount: t._count.locations,
        userCount: t._count.employees,
        planName: t.subscriptions[0]?.plan?.name || "Standard",
        createdAt: t.createdAt,
        lastActivityAt: t.lastActivityAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };

  const getOrganization360 = async (organizationId: string) => {
    const [tenant, totalBookings] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: organizationId },
        include: {
          _count: {
            select: {
              locations: { where: { deletedAt: null } },
              employees: { where: { deletedAt: null } },
              services: { where: { deletedAt: null } },
              counters: true,
              queues: true,
              customers: { where: { deletedAt: null } },
            },
          },
          subscriptions: {
            take: 1,
            orderBy: { createdAt: "desc" },
            include: { plan: true },
          },
        },
      }),
      prisma.booking.count({ where: { tenantId: organizationId } }).catch(() => 0),
    ]);

    if (!tenant) return null;

    // Check Shard Catalog & Region
    const shard = await prisma.shard.findUnique({
      where: { code: tenant.shardId },
      include: { region: true },
    });

    return {
      organization: {
        id: tenant.id,
        name: tenant.name,
        legalName: tenant.legalName,
        slug: tenant.slug,
        type: tenant.type,
        status: tenant.status,
        statusReason: tenant.statusReason,
        email: tenant.email,
        phone: tenant.phone,
        country: tenant.country,
        timezone: tenant.timezone,
        currency: tenant.currency,
        shardId: tenant.shardId,
        createdAt: tenant.createdAt,
        activatedAt: tenant.activatedAt,
        suspendedAt: tenant.suspendedAt,
        archivedAt: tenant.archivedAt,
        lastActivityAt: tenant.lastActivityAt,
      },
      metrics: {
        branches: tenant._count.locations,
        employees: tenant._count.employees,
        services: tenant._count.services,
        counters: tenant._count.counters,
        activeQueues: tenant._count.queues,
        totalBookings,
        totalCustomers: tenant._count.customers,
      },
      subscription: tenant.subscriptions[0]
        ? {
            id: tenant.subscriptions[0].id,
            planName: tenant.subscriptions[0].plan.name,
            planCode: tenant.subscriptions[0].plan.code,
            status: tenant.subscriptions[0].status,
            billingCycle: tenant.subscriptions[0].billingCycle,
            limits: (tenant.subscriptions[0].limitsOverride || tenant.subscriptions[0].plan.limits) as Record<string, unknown>,
            currentPeriodStart: tenant.subscriptions[0].currentPeriodStart,
            currentPeriodEnd: tenant.subscriptions[0].currentPeriodEnd,
          }
        : null,
      infrastructure: {
        shardCode: tenant.shardId,
        region: shard?.region?.name || "Default Region",
        dbHealth: shard?.dbHealth || HealthState.HEALTHY,
        redisHealth: shard?.redisHealth || HealthState.HEALTHY,
        kafkaHealth: shard?.kafkaHealth || HealthState.HEALTHY,
        readOnly: shard?.readOnly ?? false,
        lastHealthCheck: shard?.lastHealthAt,
        migrationStatus: tenant.status === TenantStatus.MIGRATING ? "MIGRATING" : "IDLE",
      },
    };
  };

  const createOrganization = async (
    data: CreatePlatformOrganizationInput,
    assignedShardId: string,
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      // 1. Create or resolve primary Admin user
      let adminUser = await tx.user.findUnique({
        where: { email: data.adminEmail.toLowerCase() },
      });

      if (!adminUser) {
        adminUser = await tx.user.create({
          data: {
            email: data.adminEmail.toLowerCase(),
            role: "USER",
            isVerified: true,
            isActive: true,
          },
        });
      }

      // 2. Create Tenant
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          legalName: data.legalName,
          slug: data.slug || null,
          type: data.type,
          status: TenantStatus.ACTIVE,
          email: data.contactEmail,
          phone: data.contactPhone,
          country: data.country,
          timezone: data.timezone || "Asia/Kolkata",
          currency: data.currency || "INR",
          shardId: assignedShardId,
          activatedAt: new Date(),
          createdById: actorUserId,
          Administrator: data.adminFullName,
          AdministratorEmail: data.adminEmail,
          Assigned_TenantRole: "ADMIN",
        },
      });

      // 3. Create TenantMember as TENANT_OWNER
      await tx.tenantMember.create({
        data: {
          tenantId: tenant.id,
          userId: adminUser.id,
          adminRole: TenantAdminRole.TENANT_OWNER,
          status: MemberStatus.ACTIVE,
          createdById: actorUserId,
        },
      });

      // 4. Resolve Plan & Create Subscription
      const plan = await tx.plan.findUnique({
        where: { code: data.planCode || "standard" },
      });

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + (data.billingCycle === "YEARLY" ? 12 : 1));

      if (plan) {
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            status: "ACTIVE",
            billingCycle: data.billingCycle || "MONTHLY",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        });
      }

      // 5. Update Shard tenant count
      await tx.shard.updateMany({
        where: { code: assignedShardId },
        data: { tenantCount: { increment: 1 } },
      });

      // 6. Record Initial Shard Mapping History
      await tx.tenantShardHistory.create({
        data: {
          tenantId: tenant.id,
          shardCode: assignedShardId,
          version: 1,
          reason: "INITIAL",
        },
      });

      // 7. Write Transactional Outbox Event
      await tx.outboxEvent.create({
        data: {
          tenantId: tenant.id,
          aggregateType: "TENANT",
          aggregateId: tenant.id,
          eventType: "ORGANIZATION_CREATED",
          partitionKey: tenant.id,
          payload: {
            tenantId: tenant.id,
            name: tenant.name,
            shardId: assignedShardId,
            adminEmail: data.adminEmail,
            actorUserId,
          },
        },
      });

      // 8. Write Admin Audit Log
      await tx.adminAuditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId,
          action: "ORGANIZATION_CREATED",
          resourceType: "ORGANIZATION",
          resourceId: tenant.id,
          reason: "Initial platform provisioning",
          metadata: {
            organizationName: tenant.name,
            type: tenant.type,
            shardId: assignedShardId,
          },
        },
      });

      return tenant;
    });
  };

  const updateOrganization = async (id: string, data: UpdateOrganizationInput, actorUserId?: string) => {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id },
        data: {
          ...(data.name ? { name: data.name } : {}),
          ...(data.legalName !== undefined ? { legalName: data.legalName } : {}),
          ...(data.contactEmail ? { email: data.contactEmail } : {}),
          ...(data.contactPhone !== undefined ? { phone: data.contactPhone } : {}),
          ...(data.timezone ? { timezone: data.timezone } : {}),
          ...(data.currency ? { currency: data.currency } : {}),
        },
      });

      await tx.adminAuditLog.create({
        data: {
          tenantId: id,
          actorUserId,
          action: "ORGANIZATION_UPDATED",
          resourceType: "ORGANIZATION",
          resourceId: id,
          metadata: data as unknown as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  };

  const suspendOrganization = async (id: string, reason: string, actorUserId?: string) => {
    return prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id } });
      if (!tenant) throw new Error(`Organization '${id}' not found`);

      if (tenant.status === TenantStatus.MIGRATING) {
        throw new Error("Cannot suspend organization while an active migration is in progress");
      }

      const updated = await tx.tenant.update({
        where: { id },
        data: {
          status: TenantStatus.SUSPENDED,
          statusReason: reason,
          suspendedAt: new Date(),
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: id,
          aggregateType: "TENANT",
          aggregateId: id,
          eventType: "ORGANIZATION_SUSPENDED",
          partitionKey: id,
          payload: { tenantId: id, reason, actorUserId },
        },
      });

      await tx.adminAuditLog.create({
        data: {
          tenantId: id,
          actorUserId,
          action: "ORGANIZATION_SUSPENDED",
          resourceType: "ORGANIZATION",
          resourceId: id,
          reason,
        },
      });

      return updated;
    });
  };

  const activateOrganization = async (id: string, reason?: string, actorUserId?: string) => {
    return prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id } });
      if (!tenant) throw new Error(`Organization '${id}' not found`);

      const updated = await tx.tenant.update({
        where: { id },
        data: {
          status: TenantStatus.ACTIVE,
          statusReason: reason || "Reactivated by platform administrator",
          activatedAt: new Date(),
          suspendedAt: null,
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: id,
          aggregateType: "TENANT",
          aggregateId: id,
          eventType: "ORGANIZATION_ACTIVATED",
          partitionKey: id,
          payload: { tenantId: id, reason, actorUserId },
        },
      });

      await tx.adminAuditLog.create({
        data: {
          tenantId: id,
          actorUserId,
          action: "ORGANIZATION_ACTIVATED",
          resourceType: "ORGANIZATION",
          resourceId: id,
          reason: reason || "Reactivated by administrator",
        },
      });

      return updated;
    });
  };

  const archiveOrganization = async (id: string, reason: string, actorUserId?: string) => {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id },
        data: {
          status: TenantStatus.ARCHIVED,
          statusReason: reason,
          archivedAt: new Date(),
          writeFenced: true,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          tenantId: id,
          actorUserId,
          action: "ORGANIZATION_ARCHIVED",
          resourceType: "ORGANIZATION",
          resourceId: id,
          reason,
        },
      });

      return updated;
    });
  };

  const getOrganizationUsage = async (tenantId: string) => {
    const snapshots = await prisma.usageSnapshot.findMany({
      where: { tenantId },
      orderBy: { day: "desc" },
      take: 30,
    });

    const [tenant, totalBookings] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          _count: {
            select: {
              locations: true,
              employees: true,
              customers: true,
              queues: true,
            },
          },
        },
      }),
      prisma.booking.count({ where: { tenantId } }).catch(() => 0),
    ]);

    return {
      current: {
        locations: tenant?._count.locations || 0,
        employees: tenant?._count.employees || 0,
        bookings: totalBookings,
        customers: tenant?._count.customers || 0,
        activeQueues: tenant?._count.queues || 0,
      },
      history: snapshots,
    };
  };

  // ============================================================================
  // TENANT ADMINS, HYBRID RBAC & QUEUE POLICY
  // ============================================================================

  const listTenantAdmins = async (tenantId: string) => {
    return prisma.tenantMember.findMany({
      where: { tenantId },
      include: {
        user: { select: { id: true, email: true, role: true, mfaEnabled: true, lastLoginAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  };

  const createTenantAdmin = async (
    tenantId: string,
    data: { name: string; email: string; adminRole: TenantAdminRole },
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            email: data.email.toLowerCase(),
            role: "USER",
            isVerified: true,
            isActive: true,
          },
        });
      }

      const member = await tx.tenantMember.upsert({
        where: { tenantId_userId: { tenantId, userId: user.id } },
        update: {
          adminRole: data.adminRole,
          status: MemberStatus.ACTIVE,
        },
        create: {
          tenantId,
          userId: user.id,
          adminRole: data.adminRole,
          status: MemberStatus.ACTIVE,
          createdById: actorUserId,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "ADMIN_CREATED",
          resourceType: "TENANT_MEMBER",
          resourceId: member.id,
          metadata: { email: data.email, adminRole: data.adminRole },
        },
      });

      return member;
    });
  };

  const updateTenantAdmin = async (
    tenantId: string,
    memberId: string,
    data: { adminRole?: TenantAdminRole; status?: MemberStatus },
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.tenantMember.update({
        where: { id: memberId },
        data: {
          ...(data.adminRole ? { adminRole: data.adminRole } : {}),
          ...(data.status ? { status: data.status } : {}),
        },
      });

      await tx.adminAuditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "ADMIN_UPDATED",
          resourceType: "TENANT_MEMBER",
          resourceId: memberId,
          metadata: data as unknown as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  };

  /**
   * Hybrid RBAC: Assign scoped role directly to a user for a tenant, branch, service, or counter.
   */
  const assignUserRole = async (
    tenantId: string,
    data: {
      userId: string;
      roleId: string;
      scopeType: ScopeType;
      scopeId: string;
      expiresAt?: Date;
    },
    grantedById?: string
  ) => {
    return prisma.userRoleAssignment.upsert({
      where: {
        tenantId_userId_roleId_scopeType_scopeId: {
          tenantId,
          userId: data.userId,
          roleId: data.roleId,
          scopeType: data.scopeType,
          scopeId: data.scopeId,
        },
      },
      update: {
        expiresAt: data.expiresAt || null,
        grantedById,
      },
      create: {
        tenantId,
        userId: data.userId,
        roleId: data.roleId,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        expiresAt: data.expiresAt || null,
        grantedById,
      },
    });
  };

  const getQueuePolicyDefaults = async (tenantId: string, scopeType: ScopeType = ScopeType.TENANT, scopeId?: string) => {
    return prisma.queuePolicyDefault.findUnique({
      where: {
        tenantId_scopeType_scopeId: {
          tenantId,
          scopeType,
          scopeId: scopeId || tenantId,
        },
      },
    });
  };

  const upsertQueuePolicyDefault = async (
    tenantId: string,
    scopeType: ScopeType,
    scopeId: string,
    policy: {
      strategy?: any;
      callGracePeriodSeconds?: number;
      allowRequeue?: boolean;
      maxRequeueAttempts?: number;
      maxHoldSeconds?: number;
      maximumWaitSeconds?: number;
      priorityRules?: Prisma.InputJsonValue;
      aging?: Prisma.InputJsonValue;
      holdPolicy?: Prisma.InputJsonValue;
    },
    updatedBy?: string
  ) => {
    return prisma.queuePolicyDefault.upsert({
      where: {
        tenantId_scopeType_scopeId: {
          tenantId,
          scopeType,
          scopeId,
        },
      },
      update: {
        ...policy,
        updatedBy,
        version: { increment: 1 },
      },
      create: {
        tenantId,
        scopeType,
        scopeId,
        callGracePeriodSeconds: policy.callGracePeriodSeconds ?? 180,
        allowRequeue: policy.allowRequeue ?? true,
        maxRequeueAttempts: policy.maxRequeueAttempts ?? 1,
        maxHoldSeconds: policy.maxHoldSeconds,
        maximumWaitSeconds: policy.maximumWaitSeconds,
        priorityRules: policy.priorityRules,
        aging: policy.aging,
        holdPolicy: policy.holdPolicy,
        updatedBy,
      },
    });
  };

  // ============================================================================
  // PLATFORM USERS
  // ============================================================================

  const listPlatformUsers = async () => {
    return prisma.platformMember.findMany({
      include: {
        user: { select: { id: true, email: true, role: true, mfaEnabled: true, lastLoginAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  };

  const findPlatformMemberByUserId = async (userId: string) => {
    return prisma.platformMember.findUnique({
      where: { userId },
      include: { user: true },
    });
  };

  const invitePlatformUser = async (
    data: { email: string; role: PlatformRoleType; mfaRequired?: boolean },
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            email: data.email.toLowerCase(),
            role: "ADMIN",
            isVerified: true,
            isActive: true,
          },
        });
      }

      const member = await tx.platformMember.create({
        data: {
          userId: user.id,
          role: data.role,
          status: MemberStatus.INVITED,
          mfaRequired: data.mfaRequired ?? true,
          createdById: actorUserId,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: "PLATFORM_USER_INVITED",
          resourceType: "PLATFORM_MEMBER",
          resourceId: member.id,
          metadata: { email: data.email, role: data.role },
        },
      });

      return member;
    });
  };

  const updatePlatformUser = async (
    userId: string,
    data: { role?: PlatformRoleType; status?: MemberStatus; mfaRequired?: boolean },
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      // Guard: Cannot suspend or demote the last PLATFORM_OWNER
      if (data.status === MemberStatus.SUSPENDED || (data.role && data.role !== PlatformRoleType.PLATFORM_OWNER)) {
        const ownerCount = await tx.platformMember.count({
          where: { role: PlatformRoleType.PLATFORM_OWNER, status: MemberStatus.ACTIVE },
        });

        const currentMember = await tx.platformMember.findUnique({ where: { userId } });
        if (currentMember?.role === PlatformRoleType.PLATFORM_OWNER && ownerCount <= 1) {
          throw new Error("Cannot demote or suspend the last active PLATFORM_OWNER");
        }
      }

      const updated = await tx.platformMember.update({
        where: { userId },
        data: {
          ...(data.role ? { role: data.role } : {}),
          ...(data.status ? { status: data.status } : {}),
          ...(data.mfaRequired !== undefined ? { mfaRequired: data.mfaRequired } : {}),
        },
      });

      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: "PLATFORM_USER_UPDATED",
          resourceType: "PLATFORM_MEMBER",
          resourceId: updated.id,
          metadata: data as unknown as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  };

  // ============================================================================
  // SUBSCRIPTIONS & PLANS
  // ============================================================================

  const listSubscriptions = async () => {
    return prisma.subscription.findMany({
      include: {
        tenant: { select: { id: true, name: true } },
        plan: true,
      },
      orderBy: { createdAt: "desc" },
    });
  };

  const listPlans = async () => {
    return prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: "asc" },
    });
  };

  // ============================================================================
  // INCIDENTS
  // ============================================================================

  const listIncidents = async () => {
    return prisma.incident.findMany({
      include: {
        updates: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { openedAt: "desc" },
    });
  };

  const createIncident = async (
    data: {
      title: string;
      component: any;
      severity: any;
      summary?: string;
      shardCode?: string;
      tenantId?: string;
    },
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          title: data.title,
          component: data.component,
          severity: data.severity,
          status: IncidentStatus.OPEN,
          summary: data.summary,
          shardCode: data.shardCode,
          tenantId: data.tenantId,
          ownerUserId: actorUserId,
          detectedBy: "MANUAL",
        },
      });

      await tx.incidentUpdate.create({
        data: {
          incidentId: incident.id,
          authorUserId: actorUserId,
          status: IncidentStatus.OPEN,
          message: data.summary || "Incident declared",
        },
      });

      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: "INCIDENT_CREATED",
          resourceType: "INCIDENT",
          resourceId: incident.id,
          metadata: { title: incident.title, severity: incident.severity },
        },
      });

      return incident;
    });
  };

  const updateIncident = async (
    id: string,
    data: { status?: IncidentStatus; severity?: any; summary?: string; updateMessage?: string },
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.incident.update({
        where: { id },
        data: {
          ...(data.status ? { status: data.status } : {}),
          ...(data.severity ? { severity: data.severity } : {}),
          ...(data.summary ? { summary: data.summary } : {}),
          ...(data.status === IncidentStatus.MITIGATED ? { mitigatedAt: now } : {}),
          ...(data.status === IncidentStatus.RESOLVED ? { resolvedAt: now } : {}),
        },
      });

      if (data.updateMessage) {
        await tx.incidentUpdate.create({
          data: {
            incidentId: id,
            authorUserId: actorUserId,
            status: data.status || updated.status,
            message: data.updateMessage,
          },
        });
      }

      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: "INCIDENT_UPDATED",
          resourceType: "INCIDENT",
          resourceId: id,
          metadata: data as unknown as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  };

  // ============================================================================
  // FEATURE FLAGS
  // ============================================================================

  const listFeatureFlags = async () => {
    return prisma.featureFlag.findMany({
      include: {
        rules: { orderBy: { priority: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });
  };

  const createFeatureFlag = async (
    data: { key: string; description?: string; defaultEnabled?: boolean; isKillSwitch?: boolean },
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.create({
        data: {
          key: data.key,
          description: data.description,
          defaultEnabled: data.defaultEnabled ?? false,
          isKillSwitch: data.isKillSwitch ?? false,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: "FEATURE_FLAG_CREATED",
          resourceType: "FEATURE_FLAG",
          resourceId: flag.id,
          metadata: { key: flag.key },
        },
      });

      return flag;
    });
  };

  const updateFeatureFlag = async (
    id: string,
    data: { description?: string; defaultEnabled?: boolean; isKillSwitch?: boolean },
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.featureFlag.update({
        where: { id },
        data,
      });

      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: "FEATURE_FLAG_UPDATED",
          resourceType: "FEATURE_FLAG",
          resourceId: id,
          metadata: data as unknown as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  };

  const upsertFeatureFlagRule = async (
    flagId: string,
    data: { scope: any; tenantId?: string; locationId?: string; percentage?: number; enabled: boolean; priority?: number },
    actorUserId?: string
  ) => {
    return prisma.featureFlagRule.create({
      data: {
        flagId,
        scope: data.scope,
        tenantId: data.tenantId,
        locationId: data.locationId,
        percentage: data.percentage,
        enabled: data.enabled,
        priority: data.priority ?? 0,
        updatedById: actorUserId,
      },
    });
  };

  // ============================================================================
  // SHARDS
  // ============================================================================

  const listShards = async () => {
    return prisma.shard.findMany({
      include: { region: true },
      orderBy: { code: "asc" },
    });
  };

  const updateShard = async (
    code: string,
    data: { weight?: number; readOnly?: boolean; status?: any; tenantCapacity?: number },
    actorUserId?: string
  ) => {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.shard.update({
        where: { code },
        data,
      });

      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: "SHARD_UPDATED",
          resourceType: "SHARD",
          resourceId: code,
          metadata: data as unknown as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  };

  // ============================================================================
  // TENANT MIGRATIONS
  // ============================================================================

  const listMigrations = async () => {
    return prisma.tenantMigration.findMany({
      include: {
        steps: { orderBy: { seq: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
  };

  const findMigrationById = async (id: string) => {
    return prisma.tenantMigration.findUnique({
      where: { id },
      include: { steps: { orderBy: { seq: "asc" } } },
    });
  };

  // ============================================================================
  // AUDIT LOGS
  // ============================================================================

  const listAuditLogs = async (query: AuditLogQuery) => {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.startDate || query.endDate
        ? {
            createdAt: {
              ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
              ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.adminAuditLog.count({ where }),
      prisma.adminAuditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };

  // ============================================================================
  // PLATFORM SETTINGS
  // ============================================================================

  const listPlatformSettings = async () => {
    return prisma.platformSetting.findMany({
      orderBy: { category: "asc" },
    });
  };

  const upsertPlatformSetting = async (
    key: string,
    category: string,
    value: Prisma.InputJsonValue,
    isSecretRef: boolean = false,
    updatedById?: string
  ) => {
    return prisma.platformSetting.upsert({
      where: { key },
      update: {
        category,
        value,
        isSecretRef,
        updatedById,
      },
      create: {
        key,
        category,
        value,
        isSecretRef,
        updatedById,
      },
    });
  };

  // ============================================================================
  // SUPPORT ACCESS SESSIONS
  // ============================================================================

  const createSupportSessionRecord = async (data: {
    userId: string;
    tenantId: string;
    reason: string;
    idempotencyKey: string;
    expiresAt: Date;
    accessLevel?: string;
  }) => {
    return prisma.$transaction(async (tx) => {
      const session = await tx.supportAccessSession.create({
        data: {
          userId: data.userId,
          tenantId: data.tenantId,
          reason: data.reason,
          idempotencyKey: data.idempotencyKey,
          expiresAt: data.expiresAt,
          status: "ACTIVE",
          startedAt: new Date(),
          accessLevel: data.accessLevel || "READ_ONLY",
        },
      });

      await tx.adminAuditLog.create({
        data: {
          tenantId: data.tenantId,
          actorUserId: data.userId,
          actorRole: "PLATFORM_SUPPORT",
          supportSessionId: data.idempotencyKey,
          action: "SUPPORT_SESSION_STARTED",
          resourceType: "TENANT",
          resourceId: data.tenantId,
          reason: data.reason,
          metadata: {
            expiresAt: data.expiresAt.toISOString(),
            accessLevel: data.accessLevel,
          },
        },
      });

      return session;
    });
  };

  const endSupportSessionRecord = async (sessionId: string, reason: string = "Manual exit by administrator") => {
    return prisma.$transaction(async (tx) => {
      const session = await tx.supportAccessSession.update({
        where: { id: sessionId },
        data: {
          status: "ENDED",
          endedAt: new Date(),
          endedReason: reason,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          supportSessionId: sessionId,
          action: "SUPPORT_SESSION_ENDED",
          resourceType: "TENANT",
          resourceId: session.tenantId,
          reason,
        },
      });

      return session;
    });
  };

  // ============================================================================
  // PLATFORM IDEMPOTENCY
  // ============================================================================

  const findIdempotencyKey = async (scope: string, actorId: string, key: string) => {
    return prisma.platformIdempotencyKey.findUnique({
      where: {
        scope_actorId_key: { scope, actorId, key },
      },
    });
  };

  const createIdempotencyKey = async (
    scope: string,
    actorId: string,
    key: string,
    requestHash: string,
    expiresAt: Date
  ) => {
    return prisma.platformIdempotencyKey.create({
      data: {
        scope,
        actorId,
        key,
        requestHash,
        expiresAt,
      },
    });
  };

  const resolveIdempotencyKey = async (
    scope: string,
    actorId: string,
    key: string,
    responseCode: number,
    responseBody: Prisma.InputJsonValue
  ) => {
    return prisma.platformIdempotencyKey.update({
      where: {
        scope_actorId_key: { scope, actorId, key },
      },
      data: {
        responseCode,
        responseBody,
      },
    });
  };

  return {
    getDashboardMetrics,
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
    assignUserRole,
    getQueuePolicyDefaults,
    upsertQueuePolicyDefault,
    listPlatformUsers,
    findPlatformMemberByUserId,
    invitePlatformUser,
    updatePlatformUser,
    listSubscriptions,
    listPlans,
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
    findMigrationById,
    listAuditLogs,
    listPlatformSettings,
    upsertPlatformSetting,
    createSupportSessionRecord,
    endSupportSessionRecord,
    findIdempotencyKey,
    createIdempotencyKey,
    resolveIdempotencyKey,
  };
};

export type PlatformRepository = ReturnType<typeof createPlatformRepository>;

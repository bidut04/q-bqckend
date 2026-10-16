import {
    TenantStatus,
    TenantType,
    TenantAdminRole,
    MemberStatus,
    PlatformRoleType,
    Role,
    ReviewAction,
    TokenType,
    Prisma,
    type PrismaClient,
} from '@prisma/client';
import { createBaseRepository, type DbClient } from '../common/base.repository';
import { PlatformRole, type AuthUser, type CursorPage } from '../common/types';
import { ForbiddenError } from '../lib/errors';

export const OrgStatus = {
    ...TenantStatus,
    PENDING_APPROVAL: TenantStatus.PROVISIONING,
} as const;
export type OrgStatus = TenantStatus;

export const DEFAULT_PENDING_APPROVAL_REASON = 'Pending platform administrator approval';

/**
 * Single source of truth for what an Organization (Tenant) looks like outside the DB layer.
 * Internal infrastructure fields (writeFenced, retentionUntil, deletedAt...) cannot leak.
 */
export const organizationSelect = {
    id: true,
    name: true,
    legalName: true,
    slug: true,
    type: true,
    email: true,
    Administrator: true,
    AdministratorEmail: true,
    phone: true,
    country: true,
    timezone: true,
    status: true,
    statusReason: true,
    shardId: true,
    createdAt: true,
    createdById: true,
    members: {
        select: {
            id: true,
            userId: true,
            adminRole: true,
            status: true,
            user: {
                select: { id: true, email: true, role: true, mfaEnabled: true },
            },
        },
    },
} satisfies Prisma.TenantSelect;

export type OrganizationView = Prisma.TenantGetPayload<{ select: typeof organizationSelect }>;

export interface CreateOrganizationInput {
    name: string;
    type: TenantType;
    Administrator: string;
    Assigned_TenantRole: Role;
    slug?: string | null;
    email?: string | null;
    phone?: string | null;
    country?: string | null;
    timezone?: string | null;
    currency?: string;
    legalName?: string | null;
    AdministratorEmail?: string | null;
    Direct_phone_number?: number | null;
    shardId?: string;
    status?: TenantStatus;
    statusReason?: string | null;
    createdById?: string | null;
    setting?: Prisma.InputJsonValue;
}

export const isPlatformAdminRole = (role?: string | PlatformRole | PlatformRoleType | Role): boolean => {
    if (!role) return false;
    return (
        role === PlatformRole.SUPER_ADMIN ||
        role === PlatformRole.PLATFORM_OWNER ||
        role === PlatformRole.PLATFORM_ADMIN ||
        role === PlatformRoleType.PLATFORM_OWNER ||
        role === PlatformRoleType.PLATFORM_ADMIN ||
        role === Role.ADMIN ||
        role === 'SUPER_ADMIN' ||
        role === 'ADMIN'
    );
};

export const createOrganizationRepository = (db: PrismaClient) => {
    // Integrate with common BaseRepository for standard CRUD & cursor pagination
    const baseRepo = createBaseRepository<
        OrganizationView,
        Prisma.TenantWhereInput,
        Prisma.TenantWhereUniqueInput,
        Prisma.TenantUncheckedCreateInput,
        Prisma.TenantUncheckedUpdateInput,
        Prisma.TenantOrderByWithRelationInput,
        typeof organizationSelect
    >({
        db,
        select: organizationSelect,
        delegate: (client: DbClient) => (client as PrismaClient).tenant as any,
        byId: (id: string) => ({ id }),
    });

    /** Authorisation lives in the query: non-admins can only ever see their own rows (anti-IDOR). */
    const scope = (actor: AuthUser, extra: Prisma.TenantWhereInput = {}): Prisma.TenantWhereInput => {
        const isPlatformAdmin = isPlatformAdminRole(actor.role);

        return {
            deletedAt: null,
            ...(isPlatformAdmin ? {} : { createdById: actor.id }),
            ...extra,
        };
    };

    const isSuperAdmin = (actor?: AuthUser): boolean => {
        return actor ? isPlatformAdminRole(actor.role) : false;
    };

    /**
     * Creates an organization.
     * - Super Admins: Created directly with ACTIVE status (or provided status).
     * - Organization Admins / non-super-admins: Routed to the approval queue with PROVISIONING (PENDING_APPROVAL) status.
     */
    const create = async (
        data: CreateOrganizationInput | Prisma.TenantUncheckedCreateInput,
        actor?: AuthUser,
        tx?: DbClient,
    ): Promise<OrganizationView> => {
        const client = tx ?? db;
        const superAdmin = isSuperAdmin(actor);

        const status: TenantStatus = superAdmin
            ? (data.status ?? TenantStatus.ACTIVE)
            : TenantStatus.PROVISIONING;

        const statusReason: string | null = superAdmin
            ? (data.statusReason ?? null)
            : DEFAULT_PENDING_APPROVAL_REASON;

        const createData: Prisma.TenantUncheckedCreateInput = {
            ...data,
            status,
            statusReason,
            createdById: data.createdById ?? (actor ? actor.id : undefined),
        };

        return client.tenant.create({
            data: createData,
            select: organizationSelect,
        });
    };

    /**
     * Direct creation exclusively for Super Admins.
     * Throws ForbiddenError if the actor is not a super/platform admin.
     */
    const createDirect = async (
        data: CreateOrganizationInput | Prisma.TenantUncheckedCreateInput,
        actor: AuthUser,
        tx?: DbClient,
    ): Promise<OrganizationView> => {
        if (!isSuperAdmin(actor)) {
            throw new ForbiddenError('Only super administrators can create an organization directly');
        }
        return create(
            {
                ...data,
                status: data.status ?? TenantStatus.ACTIVE,
            },
            actor,
            tx,
        );
    };

    /**
     * Organization admin / submitter creation: explicitly routes to approval queue (PROVISIONING).
     */
    const requestCreation = async (
        data: Omit<CreateOrganizationInput, 'status' | 'statusReason' | 'createdById'> | Prisma.TenantUncheckedCreateInput,
        actor: AuthUser,
        tx?: DbClient,
    ): Promise<OrganizationView> => {
        const client = tx ?? db;
        const createData: Prisma.TenantUncheckedCreateInput = {
            ...data,
            status: TenantStatus.PROVISIONING,
            statusReason: DEFAULT_PENDING_APPROVAL_REASON,
            createdById: actor.id,
        };

        return client.tenant.create({
            data: createData,
            select: organizationSelect,
        });
    };

    const findFirst = baseRepo.findFirst;
    const findById = baseRepo.findById;
    const count = baseRepo.count;
    const updateMany = baseRepo.updateMany;
    const paginate = baseRepo.paginate;

    const findVisible = async (id: string, actor: AuthUser, tx?: DbClient): Promise<OrganizationView | null> => {
        return findFirst(scope(actor, { id }), tx);
    };

    const list = async (
        params: { actor: AuthUser; status?: TenantStatus; limit: number; cursor?: string },
        tx?: DbClient,
    ): Promise<CursorPage<OrganizationView>> => {
        return paginate(
            {
                where: scope(params.actor, params.status ? { status: params.status } : {}),
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                limit: params.limit,
                ...(params.cursor ? { cursor: params.cursor } : {}),
            },
            tx,
        );
    };

    /** Includes soft-deleted rows on purpose: slugs are never recycled. */
    const slugExists = async (slug: string, tx?: DbClient): Promise<boolean> => {
        const client = tx ?? db;
        const row = await client.tenant.findUnique({ where: { slug }, select: { id: true } });
        return row !== null;
    };

    const countPendingBySubmitter = async (createdById: string, tx?: DbClient): Promise<number> => {
        return count({ createdById, status: TenantStatus.PROVISIONING, deletedAt: null }, tx);
    };

    /**
     * Optimistic state transition. The `status: from` predicate makes the check and the
     * write one atomic statement, so two super-admins clicking Approve cannot both win.
     */
    const transition = async (
        id: string,
        from: TenantStatus,
        data: Prisma.TenantUncheckedUpdateInput,
        tx?: DbClient,
    ): Promise<boolean> => {
        const affectedCount = await updateMany({ id, status: from, deletedAt: null }, data, tx);
        return affectedCount === 1;
    };

    /**
     * Updates tenant member status to INVITED and persists verification token if details provided.
     */
    const setOwnerInvite = async (
        organizationId: string,
        tokenHashOrDetails?: string | { tokenHash?: string; expiresAt?: Date },
        expiresAtDate?: Date,
        txClient?: DbClient,
    ): Promise<void> => {
        let tokenHash: string | undefined;
        let expiresAt: Date | undefined;
        let tx: DbClient | undefined;

        if (typeof tokenHashOrDetails === 'object' && tokenHashOrDetails !== null) {
            tokenHash = tokenHashOrDetails.tokenHash;
            expiresAt = tokenHashOrDetails.expiresAt;
            tx = txClient ?? (expiresAtDate as DbClient | undefined);
        } else {
            tokenHash = tokenHashOrDetails;
            expiresAt = expiresAtDate;
            tx = txClient;
        }

        const client = tx ?? db;
        const ownerMember = await client.tenantMember.findFirst({
            where: { tenantId: organizationId, adminRole: TenantAdminRole.TENANT_OWNER },
            select: { id: true, userId: true },
        });

        if (ownerMember) {
            await client.tenantMember.update({
                where: { id: ownerMember.id },
                data: { status: MemberStatus.INVITED },
            });

            if (tokenHash && expiresAt) {
                await client.verificationToken.create({
                    data: {
                        userId: ownerMember.userId,
                        tokenHash,
                        type: TokenType.EMAIL_VERIFICATION,
                        expiresAt,
                    },
                });
            }
        }
    };

    /**
     * Appends an immutable audit log entry for organization review (approval, rejection, suspension, reactivation).
     */
    const recordReviewLog = async (
        data: {
            tenantId: string;
            reviewerId: string;
            action: ReviewAction;
            fromStatus: TenantStatus;
            toStatus: TenantStatus;
            reason?: string | null;
        },
        tx?: DbClient,
    ) => {
        const client = tx ?? db;
        return client.tenantReviewLog.create({
            data: {
                tenantId: data.tenantId,
                reviewerId: data.reviewerId,
                action: data.action,
                fromStatus: data.fromStatus,
                toStatus: data.toStatus,
                reason: data.reason ?? null,
            },
        });
    };

    /**
     * Retrieves the immutable audit log history for an organization.
     */
    const getReviewLogs = async (tenantId: string, tx?: DbClient) => {
        const client = tx ?? db;
        return client.tenantReviewLog.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
        });
    };

    return {
        scope,
        isSuperAdmin,
        create,
        createDirect,
        requestCreation,
        createOrganization: create,
        findFirst,
        findById,
        findVisible,
        count,
        updateMany,
        paginate,
        list,
        slugExists,
        countPendingBySubmitter,
        transition,
        setOwnerInvite,
        recordReviewLog,
        getReviewLogs,
    };
};

export const createTenantRepository = createOrganizationRepository;
export const OrganizationRepository = createOrganizationRepository;
export const TenantRepository = createOrganizationRepository;

export type OrganizationRepository = ReturnType<typeof createOrganizationRepository>;
export type TenantRepository = OrganizationRepository;

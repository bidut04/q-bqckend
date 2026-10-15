import { type Prisma, type PrismaClient } from '@prisma/client';
import { type CursorPage } from './types';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface IdentifiableRecord {
    id?: string;
}

export type SelectClause = Record<string, unknown>;

export interface DelegateFindFirstArgs<TWhere, TSelect = SelectClause> {
    where?: TWhere;
    select?: TSelect;
}

export interface DelegateFindUniqueArgs<TWhereUnique, TSelect = SelectClause> {
    where: TWhereUnique;
    select?: TSelect;
}

export interface DelegateFindManyArgs<TWhere, TWhereUnique, TOrderBy, TSelect = SelectClause> {
    where?: TWhere;
    select?: TSelect;
    orderBy?: TOrderBy | TOrderBy[];
    take?: number;
    skip?: number;
    cursor?: TWhereUnique;
}

export interface DelegateCreateArgs<TCreate, TSelect = SelectClause> {
    data: TCreate;
    select?: TSelect;
}

export interface DelegateUpdateArgs<TWhereUnique, TUpdate, TSelect = SelectClause> {
    where: TWhereUnique;
    data: TUpdate;
    select?: TSelect;
}

export interface DelegateUpdateManyArgs<TWhere, TUpdate> {
    where?: TWhere;
    data: TUpdate;
}

export interface DelegateCountArgs<TWhere> {
    where?: TWhere;
}

export interface BatchPayload {
    count: number;
}

export interface ModelDelegate<
    TView extends IdentifiableRecord,
    TWhere,
    TWhereUnique,
    TCreate,
    TUpdate,
    TOrderBy,
    TSelect = SelectClause
> {
    findFirst(args: DelegateFindFirstArgs<TWhere, TSelect>): Promise<TView | null>;
    findUnique(args: DelegateFindUniqueArgs<TWhereUnique, TSelect>): Promise<TView | null>;
    findMany(args: DelegateFindManyArgs<TWhere, TWhereUnique, TOrderBy, TSelect>): Promise<TView[]>;
    create(args: DelegateCreateArgs<TCreate, TSelect>): Promise<TView>;
    update(args: DelegateUpdateArgs<TWhereUnique, TUpdate, TSelect>): Promise<TView>;
    updateMany(args: DelegateUpdateManyArgs<TWhere, TUpdate>): Promise<BatchPayload>;
    count(args?: DelegateCountArgs<TWhere>): Promise<number>;
}

export interface BaseRepositoryConfig<
    TView extends IdentifiableRecord,
    TWhere,
    TWhereUnique,
    TCreate,
    TUpdate,
    TOrderBy,
    TSelect = SelectClause
> {
    db: PrismaClient;
    select?: TSelect;
    delegate: (client: DbClient) => ModelDelegate<
        TView,
        TWhere,
        TWhereUnique,
        TCreate,
        TUpdate,
        TOrderBy,
        TSelect
    >;
    byId: (id: string) => TWhereUnique;
}

export interface PaginateParams<TWhere, TOrderBy> {
    where?: TWhere;
    orderBy?: TOrderBy | TOrderBy[];
    limit: number;
    cursor?: string;
}

export interface BaseRepositoryOperations<
    TView,
    TWhere,
    TCreate,
    TUpdate,
    TOrderBy
> {
    findFirst(where: TWhere, tx?: DbClient): Promise<TView | null>;
    findById(id: string, tx?: DbClient): Promise<TView | null>;
    create(data: TCreate, tx?: DbClient): Promise<TView>;
    update(id: string, data: TUpdate, tx?: DbClient): Promise<TView>;
    count(where?: TWhere, tx?: DbClient): Promise<number>;
    updateMany(where: TWhere, data: TUpdate, tx?: DbClient): Promise<number>;
    paginate(
        params: PaginateParams<TWhere, TOrderBy>,
        tx?: DbClient
    ): Promise<CursorPage<TView>>;
}

export const createBaseRepository = <
    TView extends IdentifiableRecord,
    TWhere,
    TWhereUnique,
    TCreate,
    TUpdate,
    TOrderBy,
    TSelect = SelectClause
>(
    config: BaseRepositoryConfig<TView, TWhere, TWhereUnique, TCreate, TUpdate, TOrderBy, TSelect>
): BaseRepositoryOperations<TView, TWhere, TCreate, TUpdate, TOrderBy> => {
    const { db, select, delegate, byId } = config;

    const findFirst = async (where: TWhere, tx?: DbClient): Promise<TView | null> => {
        return delegate(tx ?? db).findFirst({
            where,
            select,
        });
    };

    const findById = async (id: string, tx?: DbClient): Promise<TView | null> => {
        return delegate(tx ?? db).findUnique({
            where: byId(id),
            select,
        });
    };

    const create = async (data: TCreate, tx?: DbClient): Promise<TView> => {
        return delegate(tx ?? db).create({
            data,
            select,
        });
    };

    const update = async (id: string, data: TUpdate, tx?: DbClient): Promise<TView> => {
        return delegate(tx ?? db).update({
            where: byId(id),
            data,
            select,
        });
    };

    const count = async (where?: TWhere, tx?: DbClient): Promise<number> => {
        return delegate(tx ?? db).count({ where });
    };

    const updateMany = async (where: TWhere, data: TUpdate, tx?: DbClient): Promise<number> => {
        const result = await delegate(tx ?? db).updateMany({ where, data });
        return result.count;
    };

    const paginate = async (
        params: PaginateParams<TWhere, TOrderBy>,
        tx?: DbClient
    ): Promise<CursorPage<TView>> => {
        const limit = params.limit;
        const items = await delegate(tx ?? db).findMany({
            where: params.where,
            select,
            orderBy: params.orderBy,
            take: limit + 1,
            ...(params.cursor ? { cursor: byId(params.cursor), skip: 1 } : {}),
        });

        const hasNextPage = items.length > limit;
        if (hasNextPage) {
            items.pop();
        }

        const lastItem = items[items.length - 1];
        const nextCursor =
            hasNextPage && lastItem?.id
                ? lastItem.id
                : undefined;

        return {
            items,
            nextCursor,
            hasNextPage,
        };
    };

    return {
        findFirst,
        findById,
        create,
        update,
        count,
        updateMany,
        paginate,
    };
};

export const BaseRepository = createBaseRepository;

export type BaseRepository<
    TView extends IdentifiableRecord,
    TWhere,
    TCreate,
    TUpdate,
    TOrderBy,
    TSelect = SelectClause
> = BaseRepositoryOperations<TView, TWhere, TCreate, TUpdate, TOrderBy>;

// ============================================================
// TENANT SHARDED REPOSITORY HELPERS (Unified Base Repository)
// ============================================================

import { TenantContext } from '../core/tenant/tenant-context';
import { TenantDbClient } from '../lib/sharding/tenant-db';
import { ResourceNotFoundError } from '../core/errors/security.errors';

export const getTenantDb = async (context: TenantContext): Promise<PrismaClient> => {
    return TenantDbClient.forContext(context);
};

export const withTenantScope = <T extends object>(
    context: TenantContext,
    filter: T
): T & { tenantId: string } => {
    return {
        ...filter,
        tenantId: context.tenantId,
    };
};

export const ensureFound = <T>(entity: T | null, resourceName: string): T => {
    if (!entity) {
        throw new ResourceNotFoundError(`${resourceName} not found`);
    }
    return entity;
};

export const createTenantRepositoryContext = () => ({
    getDb: getTenantDb,
    withTenantScope,
    ensureFound,
});

export abstract class BaseTenantRepository {
    protected async getDb(context: TenantContext): Promise<PrismaClient> {
        return getTenantDb(context);
    }

    protected withTenantScope<T extends object>(
        context: TenantContext,
        filter: T
    ): T & { tenantId: string } {
        return withTenantScope(context, filter);
    }

    protected ensureFound<T>(entity: T | null, resourceName: string): T {
        return ensureFound(entity, resourceName);
    }
}


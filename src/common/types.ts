export enum PlatformRole {
    SUPER_ADMIN = 'PLATFORM_OWNER',
    PLATFORM_OWNER = 'PLATFORM_OWNER',
    PLATFORM_ADMIN = 'PLATFORM_ADMIN',
    PLATFORM_SUPPORT = 'PLATFORM_SUPPORT',
}

export interface AuthUser {
    id: string;
    email?: string;
    role: string | PlatformRole;
    tenantId?: string;
}

export interface CursorPage<T> {
    items: T[];
    nextCursor?: string;
    hasNextPage: boolean;
}

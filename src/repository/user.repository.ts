import { PrismaClient, Role, User } from "@prisma/client";

export const createUserRepository = (prisma: PrismaClient) => {
    const findById = async (id: string): Promise<User | null> => {
        return prisma.user.findUnique({
            where: { id },
        });
    };

    const findByEmail = async (email: string): Promise<User | null> => {
        return prisma.user.findUnique({
            where: { email },
        });
    };

    const createUser = async (data: { email: string; passwordHash: string; role?: Role }): Promise<User> => {
        return prisma.user.create({
            data: {
                email: data.email,
                passwordHash: data.passwordHash,
                role: data.role ?? Role.USER,
            },
        });
    };

    const updateLastLogin = async (userId: string): Promise<User> => {
        return prisma.user.update({
            where: { id: userId },
            data: {
                lastLoginAt: new Date(),
                failedLoginAttempts: 0,
                lockoutUntil: null,
            },
        });
    };

    const incrementFailedLogin = async (userId: string): Promise<User> => {
        return prisma.user.update({
            where: { id: userId },
            data: {
                failedLoginAttempts: { increment: 1 },
            },
        });
    };

    const resetFailedLoginAttempts = async (userId: string): Promise<User> => {
        return prisma.user.update({
            where: { id: userId },
            data: {
                failedLoginAttempts: 0,
                lockoutUntil: null,
            },
        });
    };

    const lockAccount = async (userId: string, lockoutUntil: Date): Promise<User> => {
        return prisma.user.update({
            where: { id: userId },
            data: {
                lockoutUntil,
            },
        });
    };

    const incrementSecurityVersion = async (userId: string): Promise<User> => {
        return prisma.user.update({
            where: { id: userId },
            data: {
                securityVersion: { increment: 1 },
            },
        });
    };

    const updatePassword = async (userId: string, passwordHash: string): Promise<User> => {
        return prisma.user.update({
            where: { id: userId },
            data: {
                passwordHash,
                passwordChangedAt: new Date(),
            },
        });
    };

    const getUserAuthorities = async (userId: string) => {
        try {
            return await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    role: true,
                    platformMember: {
                        select: {
                            role: true,
                            status: true,
                        },
                    },
                    tenantMemberships: {
                        where: { status: "ACTIVE" },
                        select: {
                            tenantId: true,
                            adminRole: true,
                            tenant: {
                                select: {
                                    id: true,
                                    name: true,
                                    slug: true,
                                    status: true,
                                },
                            },
                        },
                    },
                },
            });
        } catch {
            return null;
        }
    };

    return {
        findById,
        findByEmail,
        createUser,
        updateLastLogin,
        incrementFailedLogin,
        resetFailedLoginAttempts,
        lockAccount,
        incrementSecurityVersion,
        updatePassword,
        getUserAuthorities,
    };
};

export type UserRepository = ReturnType<typeof createUserRepository>;

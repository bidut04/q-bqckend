import { AuthProvider, PrismaClient, Role, User } from "@prisma/client";

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

    const findOrCreateGoogleUser = async (data: {
        email: string;
        googleId: string;
        name?: string;
    }): Promise<User> => {
        let user = await prisma.user.findUnique({
            where: { email: data.email },
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: data.email,
                    isVerified: true,
                    role: Role.USER,
                },
            });
        } else if (!user.isVerified) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: { isVerified: true },
            });
        }

        const existingAccount = await prisma.account.findUnique({
            where: {
                provider_providerAccountId: {
                    provider: AuthProvider.GOOGLE,
                    providerAccountId: data.googleId,
                },
            },
        });

        if (!existingAccount) {
            await prisma.account.create({
                data: {
                    userId: user.id,
                    provider: AuthProvider.GOOGLE,
                    providerAccountId: data.googleId,
                },
            });
        }

        return user;
    };

    const updateUser = async (userId: string, data: { email?: string; role?: Role }): Promise<User> => {
        return prisma.user.update({
            where: { id: userId },
            data,
        });
    };

    return {
        findById,
        findByEmail,
        createUser,
        updateUser,
        updateLastLogin,
        incrementFailedLogin,
        resetFailedLoginAttempts,
        lockAccount,
        incrementSecurityVersion,
        updatePassword,
        getUserAuthorities,
        findOrCreateGoogleUser,
    };
};

export type UserRepository = ReturnType<typeof createUserRepository>;

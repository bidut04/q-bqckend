import {
  AuditAction,
  PrismaClient,
  RefreshTokenStatus,
  RevokeReason,
} from "@prisma/client";

export const createAuthRepository = (prisma: PrismaClient) => {
  const createSession = async (data: {
    id: string;
    userId: string;
    ipAddress?: string;
    expiresAt: Date;
    userAgent?: string;
  }) => {
    return prisma.session.create({
      data: {
        id: data.id,
        userId: data.userId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        expiresAt: data.expiresAt,
        lastActivityAt: new Date(),
      },
    });
  };

  const findSession = async (sessionId: string) => {
    return prisma.session.findFirst({
      where: { id: sessionId },
    });
  };

  const revokeSession = async (sessionId: string, reason: RevokeReason) => {
    return prisma.session.update({
      where: { id: sessionId },
      data: {
        isRevoked: true,
        revokeReason: reason,
        revokedAt: new Date(),
      },
    });
  };

  const revokeAllUserSessions = async (userId: string, reason: RevokeReason) => {
    return prisma.session.updateMany({
      where: {
        userId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokeReason: reason,
      },
    });
  };

  const revokeFamily = async (familyId: string, reason: RevokeReason) => {
    return prisma.refreshToken.updateMany({
      where: {
        familyId,
        status: RefreshTokenStatus.ACTIVE,
      },
      data: {
        status: RefreshTokenStatus.REVOKED,
        revokedAt: new Date(),
        revokeReason: reason,
      },
    });
  };

  const touchSession = async (sessionId: string) => {
    return prisma.session.update({
      where: { id: sessionId },
      data: {
        lastActivityAt: new Date(),
      },
    });
  };

  const createRefreshToken = async (data: {
    id: string;
    userId: string;
    sessionId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
    previousTokenId?: string;
  }) => {
    return prisma.refreshToken.create({
      data: {
        id: data.id,
        userId: data.userId,
        sessionId: data.sessionId,
        familyId: data.familyId,
        tokenHash: data.tokenHash,
        status: RefreshTokenStatus.ACTIVE,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        previousTokenId: data.previousTokenId,
      },
    });
  };

  const findRefreshTokenByHash = async (tokenHash: string) => {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            securityVersion: true,
          },
        },
        session: true,
      },
    });
  };

  const rotateRefreshToken = async (data: {
    oldTokenId: string;
    newTokenId: string;
    newTokenHash: string;
    userId: string;
    sessionId: string;
    familyId: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }) => {
    return prisma.$transaction(async (tx) => {
      const update = await tx.refreshToken.updateMany({
        where: {
          id: data.oldTokenId,
          status: RefreshTokenStatus.ACTIVE,
        },
        data: {
          status: RefreshTokenStatus.ROTATED,
          rotatedAt: new Date(),
          revokeReason: RevokeReason.TOKEN_ROTATION,
          nextTokenId: data.newTokenId,
        },
      });

      if (update.count !== 1) {
        return {
          success: false as const,
          reuseDetected: true as const,
        };
      }

      const newToken = await tx.refreshToken.create({
        data: {
          id: data.newTokenId,
          userId: data.userId,
          sessionId: data.sessionId,
          familyId: data.familyId,
          tokenHash: data.newTokenHash,
          expiresAt: data.expiresAt,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          previousTokenId: data.oldTokenId,
          status: RefreshTokenStatus.ACTIVE,
        },
      });

      await tx.session.update({
        where: { id: data.sessionId },
        data: { lastActivityAt: new Date() },
      });

      return {
        success: true as const,
        token: newToken,
      };
    });
  };

  const createAuditLog = async (data: {
    userId?: string;
    action: AuditAction;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    details?: Record<string, unknown>;
  }) => {
    return prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        requestId: data.requestId,
        details: data.details ? JSON.parse(JSON.stringify(data.details)) : undefined,
      },
    });
  };

  const createLoginState = async (data: {
    userId: string;
    sessionId: string;
    familyId: string;
    refreshTokenId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }) => {
    return prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: {
          id: data.sessionId,
          userId: data.userId,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          expiresAt: data.expiresAt,
          lastActivityAt: new Date(),
        },
      });

      const refreshToken = await tx.refreshToken.create({
        data: {
          id: data.refreshTokenId,
          userId: data.userId,
          sessionId: data.sessionId,
          familyId: data.familyId,
          tokenHash: data.refreshTokenHash,
          status: RefreshTokenStatus.ACTIVE,
          expiresAt: data.expiresAt,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
        },
      });

      return { session, refreshToken };
    });
  };

  return {
    createSession,
    findSession,
    revokeSession,
    revokeAllUserSessions,
    revokeFamily,
    touchSession,
    createRefreshToken,
    findRefreshTokenByHash,
    findRefreshToken: findRefreshTokenByHash,
    rotateRefreshToken,
    rotateRefreshtoken: rotateRefreshToken,
    createAuditLog,
    createLoginState,
  };
};

export type AuthRepository = ReturnType<typeof createAuthRepository>;

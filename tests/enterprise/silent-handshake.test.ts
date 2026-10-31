import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { createAccessToken, verifyAccessToken } from '../../src/security/jwt';
import { hashToken } from '../../src/security/token';
import { createAuthService, AuthService } from '../../src/service/auth.service';
import { AppError } from '../../utils/app-error';
import { AuditAction, RevokeReason } from '@prisma/client';

describe('Enterprise Security: The Silent Handshake (10-minute Token & Silent Refresh)', () => {
  const mockJwtSecret = 'super-secret-jwt-access-key-epaper-2026';

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = mockJwtSecret;
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.JWT_ACCESS_EXPIRES_IN;
  });

  describe('1. 10-Minute Access Token Lifespan', () => {
    it('should generate an access token with exactly 10 minutes (600 seconds) lifespan by default', () => {
      const payload = {
        sub: 'user-emp-1002',
        sid: 'sess-abc-xyz',
        role: 'RECEPTIONIST',
        securityVersion: 1,
      };

      const token = createAccessToken(payload);
      expect(typeof token).toBe('string');

      const decoded = jwt.decode(token) as any;
      expect(decoded).toBeDefined();
      expect(decoded.sub).toBe('user-emp-1002');
      expect(decoded.sid).toBe('sess-abc-xyz');
      expect(decoded.role).toBe('RECEPTIONIST');

      // Check lifespan: exp - iat must be 600 seconds (10 minutes)
      const lifespanSeconds = decoded.exp - decoded.iat;
      expect(lifespanSeconds).toBe(600);
    });

    it('should reject an expired access token with TokenExpiredError', () => {
      const expiredToken = jwt.sign(
        {
          sub: 'user-emp-1002',
          sid: 'sess-abc-xyz',
          role: 'RECEPTIONIST',
          securityVersion: 1,
        },
        mockJwtSecret,
        {
          algorithm: 'HS256',
          expiresIn: '-10s', // Expired 10 seconds ago
          issuer: 'http://localhost:8989',
          audience: 'your-client',
        }
      );

      expect(() => verifyAccessToken(expiredToken)).toThrow();
    });
  });

  describe('2. Silent Refresh and Cryptographic Family Token Rotation', () => {
    let mockAuthRepo: any;
    let mockUserRepo: any;
    let mockSecurityCache: any;
    let authService: AuthService;

    const refreshTokensDb = new Map<string, any>();
    const familyDb = new Map<string, { revoked: boolean; reason?: string }>();

    beforeEach(() => {
      refreshTokensDb.clear();
      familyDb.clear();

      mockAuthRepo = {
        findRefreshToken: vi.fn().mockImplementation(async (hash: string) => {
          return refreshTokensDb.get(hash) || null;
        }),
        rotateRefreshToken: vi.fn().mockImplementation(async (params: any) => {
          const family = familyDb.get(params.familyId);
          if (family?.revoked) {
            return { success: false, reuseDetected: true };
          }

          // Invalidate old token and store new one
          let oldKey: string | null = null;
          for (const [hash, record] of refreshTokensDb.entries()) {
            if (record.id === params.oldTokenId) {
              oldKey = hash;
              break;
            }
          }
          if (oldKey) {
            refreshTokensDb.delete(oldKey);
          }

          refreshTokensDb.set(params.newTokenHash, {
            id: params.newTokenId,
            familyId: params.familyId,
            user: { id: params.userId, isActive: true, role: 'RECEPTIONIST', securityVersion: 1 },
            session: { id: params.sessionId, isRevoked: false },
            expiresAt: params.expiresAt,
          });

          return { success: true, reuseDetected: false };
        }),
        revokeFamily: vi.fn().mockImplementation(async (familyId: string, reason: string) => {
          familyDb.set(familyId, { revoked: true, reason });
        }),
        createAuditLog: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      };

      mockUserRepo = {
        getUserAuthorities: vi.fn().mockResolvedValue({
          platformMember: null,
          tenantMemberships: [{ tenantId: 'tenant-1', adminRole: null }],
        }),
      };

      mockSecurityCache = {
        getSecurityVersion: vi.fn().mockResolvedValue(1),
        setSecurityVersion: vi.fn().mockResolvedValue(true),
      };

      authService = createAuthService({
        authRepository: mockAuthRepo,
        userRepository: mockUserRepo,
        securityCache: mockSecurityCache,
        emailService: {} as any,
        smsService: {} as any,
      });
    });

    it('should rotate refresh token and issue a fresh 10-minute access token during silent handshake', async () => {
      const initialRefreshToken = 'initial-secure-refresh-token-emp-1002';
      const initialTokenHash = hashToken(initialRefreshToken);

      refreshTokensDb.set(initialTokenHash, {
        id: 'token-rec-1',
        familyId: 'family-emp-1',
        user: { id: 'user-emp-1002', isActive: true, role: 'RECEPTIONIST', securityVersion: 1 },
        session: { id: 'sess-emp-1', isRevoked: false },
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
      });

      // Execute silent refresh
      const refreshResult = await authService.refresh({
        refreshToken: initialRefreshToken,
        ipAddress: '127.0.0.1',
        userAgent: 'QueFlow-Client/2.0',
      });

      expect(refreshResult).toBeDefined();
      expect(refreshResult.expiresIn).toBe(600);
      expect(refreshResult.accessToken).toBeDefined();
      expect(refreshResult.refreshToken).toBeDefined();
      expect(refreshResult.refreshToken).not.toBe(initialRefreshToken);

      // Verify the new access token is valid and has 600s expiration
      const decodedNew = verifyAccessToken(refreshResult.accessToken);
      expect(decodedNew.sub).toBe('user-emp-1002');
      expect(decodedNew.sid).toBe('sess-emp-1');
      expect(decodedNew.role).toBe('RECEPTIONIST');
    });

    it('should detect token reuse and revoke the session family when an already rotated refresh token is presented', async () => {
      mockAuthRepo.rotateRefreshToken.mockResolvedValueOnce({
        success: false,
        reuseDetected: true,
      });

      const stolenToken = 'stolen-refresh-token';
      const stolenTokenHash = hashToken(stolenToken);

      refreshTokensDb.set(stolenTokenHash, {
        id: 'token-stolen-1',
        familyId: 'family-compromised-1',
        user: { id: 'user-emp-1002', isActive: true, role: 'RECEPTIONIST', securityVersion: 1 },
        session: { id: 'sess-emp-1', isRevoked: false },
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      });

      await expect(
        authService.refresh({
          refreshToken: stolenToken,
          ipAddress: '192.168.1.100',
          userAgent: 'Attacker-Browser',
        })
      ).rejects.toThrow('Refresh token reuse detected');

      expect(mockAuthRepo.revokeFamily).toHaveBeenCalledWith(
        'family-compromised-1',
        RevokeReason.TOKEN_REUSE
      );
      expect(mockAuthRepo.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.TOKEN_REUSE_DETECTED,
        })
      );
    });
  });
});

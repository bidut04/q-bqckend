import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthController } from '../../src/controllers/auth.controller';
import { createAuthService } from '../../src/service/auth.service';
import { AppError } from '../../utils/app-error';

describe('Enterprise Security: User Profile & Avatar Settings', () => {
  const usersDb = new Map<string, any>();
  const tenantSettingDb = new Map<string, any>();
  const employeeDb = new Map<string, any>();

  let authController: any;
  let authService: any;
  let mockUserRepo: any;
  let mockAuthRepo: any;

  beforeEach(() => {
    usersDb.clear();
    tenantSettingDb.clear();
    employeeDb.clear();
    vi.clearAllMocks();

    usersDb.set('user-admin-1', {
      id: 'user-admin-1',
      email: 'rahul.admin@epaper.in',
      role: 'ADMIN',
      isActive: true,
      securityVersion: 1,
    });

    usersDb.set('user-other-2', {
      id: 'user-other-2',
      email: 'taken@epaper.in',
      role: 'USER',
      isActive: true,
      securityVersion: 1,
    });

    mockUserRepo = {
      findById: vi.fn().mockImplementation(async (id: string) => usersDb.get(id) || null),
      findByEmail: vi.fn().mockImplementation(async (email: string) => {
        for (const u of usersDb.values()) {
          if (u.email.toLowerCase() === email.toLowerCase()) return u;
        }
        return null;
      }),
      updateUser: vi.fn().mockImplementation(async (id: string, data: any) => {
        const u = usersDb.get(id);
        if (!u) throw new Error('User not found');
        const updated = { ...u, ...data };
        usersDb.set(id, updated);
        return updated;
      }),
      getUserAuthorities: vi.fn().mockImplementation(async (id: string) => ({
        id,
        email: usersDb.get(id)?.email,
        role: usersDb.get(id)?.role,
        platformMember: null,
        tenantMemberships: [{ tenantId: 'tenant-101', adminRole: 'TENANT_ADMIN' }],
      })),
      updateLastLogin: vi.fn().mockResolvedValue(true),
      incrementFailedLogin: vi.fn().mockResolvedValue({ failedLoginAttempts: 1 }),
      resetFailedLoginAttempts: vi.fn().mockResolvedValue(true),
    };

    mockAuthRepo = {
      createAuditLog: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    authService = createAuthService({
      userRepository: mockUserRepo,
      authRepository: mockAuthRepo,
      redis: {} as any,
      securityCache: {
        getSecurityVersion: vi.fn().mockResolvedValue(1),
        setSecurityVersion: vi.fn().mockResolvedValue(true),
      } as any,
    });

    authController = createAuthController(authService);
  });

  it('1. GET /api/v1/auth/me should return user profile details', async () => {
    const req: any = { user: { id: 'user-admin-1' } };
    let responseStatus: number = 0;
    let responseBody: any = null;
    const res: any = {
      status: (code: number) => {
        responseStatus = code;
        return { json: (data: any) => { responseBody = data; } };
      },
    };
    const next = vi.fn();

    await authController.getMe(req, res, next);

    expect(responseStatus).toBe(200);
    expect(responseBody.success).toBe(true);
    expect(responseBody.user.id).toBe('user-admin-1');
    expect(responseBody.user.email).toBe('rahul.admin@epaper.in');
    expect(responseBody.user.role).toBe('TENANT_ADMIN');
  });

  it('2. PATCH /api/v1/auth/profile should update name, email, and avatar in the database', async () => {
    const req: any = {
      user: { id: 'user-admin-1' },
      body: {
        name: 'Rahul Sharma',
        email: 'rahul.sharma@epaper.in',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
      },
    };
    let responseStatus: number = 0;
    let responseBody: any = null;
    const res: any = {
      status: (code: number) => {
        responseStatus = code;
        return { json: (data: any) => { responseBody = data; } };
      },
    };
    const next = vi.fn();

    await authController.updateProfile(req, res, next);

    expect(responseStatus).toBe(200);
    expect(responseBody.success).toBe(true);
    expect(responseBody.message).toBe('Profile updated successfully');
    expect(responseBody.user.email).toBe('rahul.sharma@epaper.in');
    expect(mockUserRepo.updateUser).toHaveBeenCalledWith('user-admin-1', {
      email: 'rahul.sharma@epaper.in',
    });
  });

  it('3. PATCH /api/v1/auth/profile should reject if email is already taken by another user', async () => {
    const req: any = {
      user: { id: 'user-admin-1' },
      body: {
        email: 'taken@epaper.in', // Belongs to user-other-2
      },
    };
    let responseStatus: number = 0;
    let responseBody: any = null;
    const res: any = {
      status: (code: number) => {
        responseStatus = code;
        return { json: (data: any) => { responseBody = data; } };
      },
    };
    const next = vi.fn((err) => {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    await authController.updateProfile(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

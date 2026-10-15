import { describe, it, expect, vi } from "vitest";
import { TenantType, TenantStatus, Role } from "@prisma/client";
import { createOrganizationRepository } from "../../src/repository/organization.repository";
import { createOrganizationService } from "../../src/modules/organization/organization.service";
import { AuthUser } from "../../src/common/types";

describe("Organization Registration by Organization Admin Test Suite", () => {
  // 1. Mock DB data store for tenants
  const tenantStore = new Map<string, any>();

  const mockPrisma = {
    tenant: {
      create: vi.fn().mockImplementation(async ({ data, select }: any) => {
        const id = `tenant_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const record = {
          id,
          createdAt: new Date(),
          members: [],
          ...data,
        };
        tenantStore.set(id, record);
        return record;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const tenant of tenantStore.values()) {
          if (where.deletedAt === null && tenant.deletedAt !== undefined && tenant.deletedAt !== null) {
            continue;
          }
          if (where.id && tenant.id !== where.id) continue;
          if (where.createdById && tenant.createdById !== where.createdById) continue;
          return tenant;
        }
        return null;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where.id) return tenantStore.get(where.id) || null;
        if (where.slug) {
          for (const t of tenantStore.values()) {
            if (t.slug === where.slug) return t;
          }
        }
        return null;
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
        let count = 0;
        for (const [id, t] of tenantStore.entries()) {
          if (where.id && t.id !== where.id) continue;
          if (where.status && t.status !== where.status) continue;
          tenantStore.set(id, { ...t, ...data, updatedAt: new Date() });
          count += 1;
        }
        return { count };
      }),
      count: vi.fn().mockImplementation(async ({ where }: any) => {
        let c = 0;
        for (const t of tenantStore.values()) {
          if (where.createdById && t.createdById !== where.createdById) continue;
          if (where.status && t.status !== where.status) continue;
          c += 1;
        }
        return c;
      }),
    },
    tenantMember: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    verificationToken: {
      create: vi.fn().mockResolvedValue({}),
    },
  };

  const organizationRepo = createOrganizationRepository(mockPrisma as any);

  // 2. Mock OTP Service
  const sentOtps = new Map<string, string>();

  const mockOtpService = {
    sendOtp: vi.fn().mockImplementation(async ({ email, purpose, recipientName }) => {
      const generatedOtp = "123456";
      sentOtps.set(email.toLowerCase(), generatedOtp);
      return {
        success: true,
        message: `OTP sent successfully to ${email}`,
        expiresInSeconds: 300,
        previewOtp: generatedOtp,
      };
    }),
    verifyOtp: vi.fn().mockImplementation(async ({ email, otp }) => {
      const stored = sentOtps.get(email.toLowerCase());
      if (!stored || stored !== otp) {
        throw new Error("Invalid or expired OTP");
      }
      return { success: true, message: "OTP verified successfully" };
    }),
  };

  const organizationService = createOrganizationService({
    organizationRepo,
    otpService: mockOtpService as any,
  });

  const orgAdminActor: AuthUser = {
    id: "usr_org_admin_01",
    email: "admin@hospital.org",
    role: "USER", // Non-super admin actor (Organization Admin submitter)
  };

  it("Test 1: Organization Admin registers organization -> created in PROVISIONING state and OTP sent to organization email", async () => {
    const input = {
      name: "Apollo Healthcare Trust",
      type: TenantType.HOSPITAL,
      Administrator: "Dr. Rajesh Sharma",
      Assigned_TenantRole: Role.ADMIN,
      email: "contact@apollo-trust.org",
      AdministratorEmail: "rajesh.sharma@apollo-trust.org",
      country: "IN",
      currency: "INR",
    };

    const result = await organizationService.registerOrganization(input, orgAdminActor);

    // Assert organization created
    expect(result.organization).toBeDefined();
    expect(result.organization.name).toBe("Apollo Healthcare Trust");
    expect(result.organization.email).toBe("contact@apollo-trust.org");

    // Enforce that organization admin registrations are routed to PROVISIONING (Pending Approval)
    expect(result.organization.status).toBe(TenantStatus.PROVISIONING);
    expect(result.organization.statusReason).toBe("Pending platform administrator approval");
    expect(result.organization.createdById).toBe("usr_org_admin_01");

    // Enforce OTP was dispatched to the organization's email address
    expect(result.otpSent).toBe(true);
    expect(result.previewOtp).toBe("123456");
    expect(mockOtpService.sendOtp).toHaveBeenCalledWith({
      email: "contact@apollo-trust.org",
      purpose: "Organization Registration Verification",
      recipientName: "Apollo Healthcare Trust",
    });
  });

  it("Test 2: Verifying the OTP successfully validates the organization email", async () => {
    const verifyResult = await organizationService.verifyOrganizationEmail({
      organizationId: "tenant_any",
      email: "contact@apollo-trust.org",
      otp: "123456",
    });

    expect(verifyResult.success).toBe(true);
    expect(verifyResult.message).toContain("verified successfully");
    expect(mockOtpService.verifyOtp).toHaveBeenCalledWith({
      email: "contact@apollo-trust.org",
      otp: "123456",
    });
  });

  it("Test 3: Incorrect OTP rejection", async () => {
    await expect(
      organizationService.verifyOrganizationEmail({
        organizationId: "tenant_any",
        email: "contact@apollo-trust.org",
        otp: "999999",
      })
    ).rejects.toThrow("Invalid or expired OTP");
  });

  it("Test 4: Organization Admin cannot bypass approval using createDirect", async () => {
    const input = {
      name: "Rogue Clinic",
      type: TenantType.CLINIC,
      Administrator: "Sneaky Admin",
      Assigned_TenantRole: Role.ADMIN,
      email: "sneaky@rogue.org",
    };

    // Calling createDirect as a non-super-admin must throw ForbiddenError
    await expect(organizationRepo.createDirect(input as any, orgAdminActor)).rejects.toThrow(
      "Only super administrators can create an organization directly"
    );
  });

  it("Test 5: Anti-IDOR scoping ensures Organization Admin only sees their own registered organization", async () => {
    // Org Admin 1 registered "Apollo Healthcare Trust" (createdById: "usr_org_admin_01")
    const orgAdmin1: AuthUser = { id: "usr_org_admin_01", role: "USER" };
    const orgAdmin2: AuthUser = { id: "usr_org_admin_02", role: "USER" };

    // Get the created organization from tenantStore
    const createdOrg = Array.from(tenantStore.values())[0];
    expect(createdOrg).toBeDefined();

    // Org Admin 1 CAN view their organization
    const visibleToAdmin1 = await organizationRepo.findVisible(createdOrg.id, orgAdmin1);
    expect(visibleToAdmin1).not.toBeNull();
    expect(visibleToAdmin1?.id).toBe(createdOrg.id);

    // Org Admin 2 CANNOT view Org Admin 1's organization (returns null)
    const visibleToAdmin2 = await organizationRepo.findVisible(createdOrg.id, orgAdmin2);
    expect(visibleToAdmin2).toBeNull();
  });

  it("Test 6: Super admin approves organization and transitions status from PROVISIONING to ACTIVE", async () => {
    const createdOrg = Array.from(tenantStore.values())[0];

    // Atomically transition status from PROVISIONING to ACTIVE
    const transitioned = await organizationRepo.transition(
      createdOrg.id,
      TenantStatus.PROVISIONING,
      { status: TenantStatus.ACTIVE, statusReason: "Approved by Platform Admin" }
    );

    expect(transitioned).toBe(true);

    const updated = tenantStore.get(createdOrg.id);
    expect(updated.status).toBe(TenantStatus.ACTIVE);
    expect(updated.statusReason).toBe("Approved by Platform Admin");
  });
});

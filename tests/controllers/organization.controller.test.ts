import { describe, it, expect, vi } from "vitest";
import { Request, Response } from "express";
import { AuthenticatedUser } from "../../src/types/express";
import { createOrganizationController } from "../../src/modules/organization/organization.controller";

interface MockRequestOptions extends Partial<Request> {
  user?: Partial<AuthenticatedUser> | any;
}

const createMockReqRes = (overrides: MockRequestOptions = {}) => {
  const req = {
    headers: {},
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  const next = vi.fn();

  return { req, res, next };
};

describe("Organization Controller Unit Test Suite", () => {
  const mockOrgService = {
    registerOrganization: vi.fn(),
    verifyOrganizationEmail: vi.fn(),
    getOrganizationById: vi.fn(),
  };

  const mockOrgRepository = {
    findVisible: vi.fn(),
    create: vi.fn(),
  };

  const controller = createOrganizationController({
    organizationService: mockOrgService as any,
    organizationRepository: mockOrgRepository as any,
  });

  it("should register organization and return 201 with confirmation email notification", async () => {
    const fakeResult = {
      organization: { id: "org_123", name: "Care Clinic", email: "care@clinic.com" },
      mailSent: true,
      adminEmail: "dpur3545@gmail.com",
      message: "Organization created. Confirmation email sent to admin at dpur3545@gmail.com.",
    };
    mockOrgService.registerOrganization.mockResolvedValueOnce(fakeResult);

    const { req, res, next } = createMockReqRes({
      user: { id: "usr_org_admin", email: "dpur3545@gmail.com", role: "USER" as any, securityVersion: 1, sessionId: "s_1" },
      body: { name: "Care Clinic", email: "dpur3545@gmail.com" },
    });

    await controller.register(req, res, next);

    expect(mockOrgService.registerOrganization).toHaveBeenCalledWith(
      req.body,
      expect.objectContaining({ id: "usr_org_admin" })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: fakeResult,
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should verify organization OTP code and return 200", async () => {
    const fakeResult = { success: true, message: "Verified", organizationId: "org_123" };
    mockOrgService.verifyOrganizationEmail.mockResolvedValueOnce(fakeResult);

    const { req, res, next } = createMockReqRes({
      body: { organizationId: "org_123", email: "care@clinic.com", otp: "123456" },
    });

    await controller.verifyOtp(req, res, next);

    expect(mockOrgService.verifyOrganizationEmail).toHaveBeenCalledWith({
      organizationId: "org_123",
      email: "care@clinic.com",
      otp: "123456",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeResult });
  });

  it("should pass registration errors to next()", async () => {
    const error = new Error("Invalid organization email");
    mockOrgService.registerOrganization.mockRejectedValueOnce(error);

    const { req, res, next } = createMockReqRes({
      body: { name: "Bad Clinic" },
    });

    await controller.register(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it("should approve organization and return 200 with notification dispatch confirmation", async () => {
    const fakeApproval = {
      organization: { id: "org_123", name: "Care Clinic", status: "ACTIVE" },
      status: "ACTIVE",
      mailSent: true,
      adminEmail: "admin@careclinic.org",
      message: "Organization Care Clinic has been approved. Confirmation email sent to admin@careclinic.org.",
    };
    (mockOrgService as any).approveOrganization = vi.fn().mockResolvedValueOnce(fakeApproval);

    const { req, res, next } = createMockReqRes({
      user: { id: "usr_super_admin", email: "super@platform.org", role: "ADMIN" as any },
      params: { id: "org_123" },
      body: { notes: "Verified documents" },
    });

    await controller.approve(req, res, next);

    expect((mockOrgService as any).approveOrganization).toHaveBeenCalledWith(
      "org_123",
      expect.objectContaining({ id: "usr_super_admin" }),
      "Verified documents"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: fakeApproval,
      })
    );
  });

  it("should reject organization with reason and return 200 with notification dispatch", async () => {
    const fakeRejection = {
      organization: { id: "org_123", name: "Care Clinic", status: "SUSPENDED" },
      status: "SUSPENDED",
      mailSent: true,
      adminEmail: "admin@careclinic.org",
      reason: "Missing tax documentation",
      message: "Organization Care Clinic registration was rejected. Notification email sent to admin@careclinic.org.",
    };
    (mockOrgService as any).rejectOrganization = vi.fn().mockResolvedValueOnce(fakeRejection);

    const { req, res, next } = createMockReqRes({
      user: { id: "usr_super_admin", email: "super@platform.org", role: "ADMIN" as any },
      params: { id: "org_123" },
      body: { reason: "Missing tax documentation" },
    });

    await controller.reject(req, res, next);

    expect((mockOrgService as any).rejectOrganization).toHaveBeenCalledWith(
      "org_123",
      expect.objectContaining({ id: "usr_super_admin" }),
      "Missing tax documentation"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: fakeRejection,
      })
    );
  });

  it("should list pending organizations and return 200", async () => {
    const fakePage = {
      items: [{ id: "org_123", name: "Pending Clinic", status: "PROVISIONING" }],
      nextCursor: null,
    };
    (mockOrgService as any).listPendingOrganizations = vi.fn().mockResolvedValueOnce(fakePage);

    const { req, res, next } = createMockReqRes({
      user: { id: "usr_super_admin", email: "super@platform.org", role: "ADMIN" as any },
      query: { limit: "15" },
    });

    await controller.listPending(req, res, next);

    expect((mockOrgService as any).listPendingOrganizations).toHaveBeenCalledWith(
      expect.objectContaining({ id: "usr_super_admin" }),
      { limit: 15, cursor: undefined }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakePage });
  });
});

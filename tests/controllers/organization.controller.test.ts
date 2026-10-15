import { describe, it, expect, vi } from "vitest";
import { Request, Response } from "express";
import { createOrganizationController } from "../../src/modules/organization/organization.controller";

const createMockReqRes = (overrides: Partial<Request> = {}) => {
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

  it("should register organization and return 201 with otpSent notification", async () => {
    const fakeResult = {
      organization: { id: "org_123", name: "Care Clinic", email: "care@clinic.com" },
      otpSent: true,
      expiresInSeconds: 300,
    };
    mockOrgService.registerOrganization.mockResolvedValueOnce(fakeResult);

    const { req, res, next } = createMockReqRes({
      user: { id: "usr_org_admin", email: "admin@clinic.com", role: "USER" as any, securityVersion: 1, sessionId: "s_1" },
      body: { name: "Care Clinic", email: "care@clinic.com" },
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
});

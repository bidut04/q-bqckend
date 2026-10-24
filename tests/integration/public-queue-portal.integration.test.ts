import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response } from "express";
import { createOrganizationController } from "../../src/modules/organization/organization.controller";
import { prisma } from "../../src/config/prisma";

vi.mock("../../src/config/prisma", () => ({
  prisma: {
    tenant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    location: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    service: {
      findFirst: vi.fn(),
    },
    queue: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    queueEntry: {
      create: vi.fn(),
    },
  },
}));

describe("Public Queue Portal Integration Test Suite", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/organizations/public/discovery", () => {
    it("should return public active organizations with branch and service counts", async () => {
      const mockTenants = [
        {
          id: "tenant-sbi",
          name: "State Bank of India",
          slug: "sbi",
          status: "ACTIVE",
          locations: [
            {
              id: "loc-1",
              name: "Park Street Branch",
              address: "12 Park Street",
              _count: { services: 5, counters: 3 },
            },
          ],
          services: [
            { id: "srv-1", name: "Account Opening", code: "ACC" },
            { id: "srv-2", name: "Cash Deposit", code: "CSH" },
          ],
        },
      ];

      (prisma.tenant.findMany as any).mockResolvedValueOnce(mockTenants);

      const { req, res, next } = createMockReqRes();
      await controller.listPublic(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: "tenant-sbi",
            name: "State Bank of India",
          }),
        ]),
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should handle database error and pass to next", async () => {
      (prisma.tenant.findMany as any).mockRejectedValueOnce(new Error("Database connection timeout"));

      const { req, res, next } = createMockReqRes();
      await controller.listPublic(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("GET /api/organizations/:id/branches", () => {
    it("should return active branches for a valid organization", async () => {
      const mockBranches = [
        {
          id: "branch-01",
          name: "Salt Lake Counter",
          code: "SL-01",
          address: "Sector V, Salt Lake",
          phone: "+91 9876543210",
          status: "ACTIVE",
          tenantId: "tenant-sbi",
          _count: { counters: 4, services: 3 },
        },
      ];

      (prisma.location.findMany as any).mockResolvedValueOnce(mockBranches);

      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-sbi" },
      });

      await controller.listTenantBranches(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockBranches,
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/organizations/:id/book-token", () => {
    beforeEach(() => {
      (prisma.tenant.findFirst as any).mockResolvedValue({
        id: "tenant-sbi",
        name: "State Bank of India",
        status: "ACTIVE",
      });
      (prisma.location.findFirst as any).mockResolvedValue({
        id: "branch-01",
        tenantId: "tenant-sbi",
        name: "Connaught Place Branch",
        status: "ACTIVE",
      });
      (prisma.service.findFirst as any).mockResolvedValue({
        id: "srv-01",
        tenantId: "tenant-sbi",
        name: "General Banking",
        status: "ACTIVE",
      });
    });

    it("should atomically book a public queue slot and return token number", async () => {
      const mockQueue = {
        id: "queue-101",
        locationId: "branch-01",
        serviceId: "srv-01",
        lastTokenNumber: 25,
        tokenPrefix: "SB",
      };

      (prisma.queue.findFirst as any).mockResolvedValueOnce(mockQueue);
      (prisma.queue.update as any).mockResolvedValueOnce({
        ...mockQueue,
        lastTokenNumber: 26,
      });

      const mockCreatedEntry = {
        id: "entry-999",
        tenantId: "tenant-sbi",
        locationId: "branch-01",
        queueId: "queue-101",
        serviceId: "srv-01",
        tokenNumber: 26,
        tokenLabel: "SB26",
        status: "WAITING",
        createdAt: new Date("2026-10-24T18:00:00Z"),
        metadata: {
          customerName: "Rahul Sharma",
          customerPhone: "+91 9876543210",
          timeSlot: "11:30 AM",
          bookedVia: "QueuePortal",
        },
      };

      (prisma.queueEntry.create as any).mockResolvedValueOnce(mockCreatedEntry);

      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-sbi" },
        body: {
          branchId: "branch-01",
          serviceId: "srv-01",
          timeSlot: "11:30 AM",
          customerName: "Rahul Sharma",
          customerPhone: "+91 9876543210",
        },
      });

      await controller.bookPublicToken(req, res, next);

      expect(prisma.queue.update).toHaveBeenCalledWith({
        where: { id: "queue-101" },
        data: { lastTokenNumber: 26 },
      });

      expect(prisma.queueEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: "tenant-sbi",
          locationId: "branch-01",
          tokenNumber: 26,
          tokenLabel: "SB26",
          status: "WAITING",
          metadata: expect.objectContaining({
            customerName: "Rahul Sharma",
            timeSlot: "11:30 AM",
          }),
        }),
      });

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: "entry-999",
          tokenNumber: "SB26",
          status: "WAITING",
          timeSlot: "11:30 AM",
        }),
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should provision queue automatically if branch has no pre-existing queue", async () => {
      (prisma.location.findFirst as any).mockResolvedValueOnce({
        id: "branch-new",
        tenantId: "tenant-sbi",
        status: "ACTIVE",
      });
      (prisma.queue.findFirst as any).mockResolvedValue(null);

      const mockNewQueue = {
        id: "queue-auto-gen",
        tenantId: "tenant-sbi",
        locationId: "branch-new",
        serviceId: "srv-01",
        name: "Queue-branch",
        code: "Q-BRANCH",
        lastTokenNumber: 20,
        tokenPrefix: "K0",
      };

      (prisma.queue.create as any).mockResolvedValueOnce(mockNewQueue);
      (prisma.queue.update as any).mockResolvedValueOnce({
        ...mockNewQueue,
        lastTokenNumber: 21,
      });

      (prisma.queueEntry.create as any).mockResolvedValueOnce({
        id: "entry-auto-01",
        tenantId: "tenant-sbi",
        locationId: "branch-new",
        queueId: "queue-auto-gen",
        serviceId: "srv-01",
        tokenNumber: 21,
        tokenLabel: "K021",
        status: "WAITING",
        createdAt: new Date(),
      });

      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-sbi" },
        body: {
          branchId: "branch-new",
          serviceId: "srv-01",
        },
      });

      await controller.bookPublicToken(req, res, next);

      expect(prisma.queue.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            tokenNumber: "K021",
          }),
        })
      );
    });

    it("should strictly reject cross-tenant IDOR attack when branch belongs to another tenant", async () => {
      (prisma.location.findFirst as any).mockResolvedValueOnce(null);

      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-sbi" },
        body: {
          branchId: "branch-foreign-hdfc",
          serviceId: "srv-01",
        },
      });

      await controller.bookPublicToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "Invalid branch for this organization",
        })
      );
    });

    it("should sanitize malicious script tags to prevent Stored XSS in customer metadata", async () => {
      const mockQueue = {
        id: "queue-101",
        locationId: "branch-01",
        serviceId: "srv-01",
        lastTokenNumber: 30,
        tokenPrefix: "SB",
      };
      (prisma.queue.findFirst as any).mockResolvedValueOnce(mockQueue);
      (prisma.queue.update as any).mockResolvedValueOnce({ ...mockQueue, lastTokenNumber: 31 });
      (prisma.queueEntry.create as any).mockResolvedValueOnce({
        id: "entry-clean-1",
        status: "WAITING",
      });

      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-sbi" },
        body: {
          branchId: "branch-01",
          serviceId: "srv-01",
          customerName: "<script>alert('pwned')</script>John Doe",
          customerPhone: "<img src=x onerror=alert(1)>9876543210",
        },
      });

      await controller.bookPublicToken(req, res, next);

      expect(prisma.queueEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            customerName: "John Doe",
            customerPhone: "9876543210",
          }),
        }),
      });
    });
  });
});

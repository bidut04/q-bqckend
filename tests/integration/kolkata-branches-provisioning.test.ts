import { describe, it, expect, beforeAll } from "vitest";
import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../src/config/prisma";
import { createOrganizationController } from "../../src/modules/organization/organization.controller";
import { TenantType } from "@prisma/client";

describe("Kolkata Real Organizations & Turn Booking Integration Test Suite", () => {
  const controller = createOrganizationController({
    organizationService: {} as any,
    organizationRepository: {} as any,
  });

  const createMockReqRes = (overrides: Partial<Request> = {}) => {
    const headers: Record<string, string> = {};
    const req = {
      headers,
      params: {},
      query: {},
      body: {},
      get: (headerName: string) => headers[headerName.toLowerCase()],
      header: (headerName: string) => headers[headerName.toLowerCase()],
      ...overrides,
    } as unknown as Request;

    const res = {
      statusCode: 200,
      headersSent: false,
      _responseData: null as any,
      status: function (code: number) {
        this.statusCode = code;
        return this;
      },
      json: function (data: any) {
        this._responseData = data;
        return this;
      },
      setHeader: function (name: string, val: any) {
        return this;
      },
    } as unknown as Response & { statusCode: number; _responseData: any };

    const next = () => {};

    return { req, res, next };
  };

  beforeAll(async () => {
    // Ensure shard and region exist
    const region = await prisma.region.upsert({
      where: { code: "ap-south-1" },
      update: {},
      create: { code: "ap-south-1", name: "Asia Pacific (Mumbai)", isActive: true },
    });

    await prisma.shard.upsert({
      where: { code: "shard_01" },
      update: {},
      create: {
        code: "shard_01",
        regionId: region.id,
        connectionRef: "DATABASE_URL",
        status: "ACTIVE",
        dbHealth: "HEALTHY",
        weight: 100,
        tenantCapacity: 500,
      },
    });
  });

  describe("1. Verify & Provision Real Kolkata Organizations in Live Database", () => {
    it("should verify Punjab National Bank (Baguiati) and its banking services in MySQL", async () => {
      const pnb = await prisma.tenant.findUnique({
        where: { id: "tenant-pnb" },
        include: { locations: true, services: true },
      });

      expect(pnb).not.toBeNull();
      expect(pnb?.name).toBe("Punjab National Bank");
      expect(pnb?.type).toBe(TenantType.BANK);

      const baguiatiBranch = pnb?.locations.find((l) => l.code === "PNB-BAG-01");
      expect(baguiatiBranch).toBeDefined();
      expect(baguiatiBranch?.name).toBe("Baguiati Branch");

      const address = baguiatiBranch?.address as any;
      expect(address?.ifsc).toBe("PUNB0012620");
      expect(address?.postalCode).toBe("700059");
      expect(address?.locality).toBe("Baguiati");

      // Verify services
      const serviceNames = pnb?.services.map((s) => s.name);
      expect(serviceNames).toContain("Account Opening & KYC");
      expect(serviceNames).toContain("Cash Deposits & Withdrawals");
      expect(serviceNames).toContain("Cheque Services & Clearing");
      expect(serviceNames).toContain("Fund Transfers (NEFT/RTGS)");
      expect(serviceNames).toContain("Retail & SME Loans");
    });

    it("should verify Bandhan Bank (Baguiati) and its services in MySQL", async () => {
      const bandhan = await prisma.tenant.findUnique({
        where: { id: "tenant-bandhan" },
        include: { locations: true, services: true },
      });

      expect(bandhan).not.toBeNull();
      expect(bandhan?.name).toBe("Bandhan Bank");
      const branch = bandhan?.locations.find((l) => l.code === "BDBL-BAG-01");
      expect(branch).toBeDefined();
      const addr = branch?.address as any;
      expect(addr?.street).toContain("DC-114/1, Narayantala (West)");
      expect(addr?.postalCode).toBe("700059");

      const srvNames = bandhan?.services.map((s) => s.name);
      expect(srvNames).toContain("Savings & Current Accounts");
      expect(srvNames).toContain("Cash Deposits & Counter Service");
      expect(srvNames).toContain("Loan-Related Assistance");
    });

    it("should verify Axis Bank (Baguiati & Phoolbagan branches) in MySQL", async () => {
      const axis = await prisma.tenant.findUnique({
        where: { id: "tenant-axis" },
        include: { locations: true, services: true },
      });

      expect(axis).not.toBeNull();
      expect(axis?.locations.length).toBeGreaterThanOrEqual(2);

      const baguiati = axis?.locations.find((l) => l.code === "AXIS-BAG-01");
      expect((baguiati?.address as any)?.ifsc).toBe("UTIB0000026");

      const phoolbagan = axis?.locations.find((l) => l.code === "AXIS-PHL-02");
      expect(phoolbagan).toBeDefined();
      expect((phoolbagan?.address as any)?.locality).toBe("Phoolbagan");
    });

    it("should verify HDFC Bank branches across VIP Road, Joramandir, Narkeldanga, and CIT Road Scheme 6M", async () => {
      const hdfc = await prisma.tenant.findUnique({
        where: { id: "tenant-hdfc" },
        include: { locations: true, services: true },
      });

      expect(hdfc).not.toBeNull();
      expect(hdfc?.locations.length).toBeGreaterThanOrEqual(4);

      const citBranch = hdfc?.locations.find((l) => l.code === "HDFC-CIT-04");
      expect((citBranch?.address as any)?.ifsc).toBe("HDFC0001224");
      expect((citBranch?.address as any)?.postalCode).toBe("700054");
    });

    it("should verify India Post Department (Phoolbagan Sub Post Office & Ram Krishna Samadhi Road)", async () => {
      const post = await prisma.tenant.findUnique({
        where: { id: "tenant-post" },
        include: { locations: true, services: true },
      });

      expect(post).not.toBeNull();
      expect(post?.type).toBe(TenantType.POST_OFFICE);
      const phlSub = post?.locations.find((l) => l.code === "POST-PHL-01");
      expect(phlSub).toBeDefined();
      expect((phlSub?.address as any)?.postalCode).toBe("700085");
    });

    it("should verify Healthcare Facilities: Revive (HOSPITAL), Apollo Clinic (CLINIC), Spandan & Theism (DIAGNOSTIC_CENTER)", async () => {
      const revive = await prisma.tenant.findUnique({
        where: { id: "tenant-revive-hospital" },
        include: { locations: true, services: true },
      });
      expect(revive?.type).toBe(TenantType.HOSPITAL);
      expect(revive?.name).toBe("REVIVE NURSING HOME");

      const apollo = await prisma.tenant.findUnique({
        where: { id: "tenant-apollo-baguiati" },
        include: { locations: true, services: true },
      });
      expect(apollo?.type).toBe(TenantType.CLINIC);
      expect(apollo?.name).toBe("Apollo Clinic Baguiati");

      const spandan = await prisma.tenant.findUnique({
        where: { id: "tenant-spandan-diagnostics" },
        include: { locations: true, services: true },
      });
      expect(spandan?.type).toBe(TenantType.DIAGNOSTIC_CENTER);
      expect(spandan?.name).toBe("Spandan Diagnostic Center");

      const theism = await prisma.tenant.findUnique({
        where: { id: "tenant-theism-diagnostics" },
        include: { locations: true, services: true },
      });
      expect(theism?.type).toBe(TenantType.DIAGNOSTIC_CENTER);
      expect(theism?.name).toBe("Theism Diagnostics");
    });
  });

  describe("2. End-to-End Real Turn Booking Across Kolkata Facilities", () => {
    it("should book a turn at Punjab National Bank Baguiati Branch and receive a valid queue token", async () => {
      const pnb = await prisma.tenant.findUnique({
        where: { id: "tenant-pnb" },
        include: { locations: true, services: true },
      });
      const branch = pnb!.locations[0];
      const service = pnb!.services.find((s) => s.name === "Account Opening & KYC") || pnb!.services[0];

      const idempotencyKey = `pnb-turn-${crypto.randomUUID()}`;
      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-pnb" },
        headers: { "idempotency-key": idempotencyKey },
        body: {
          branchId: branch.id,
          serviceId: service.id,
          customerName: "Sourav Ganguly",
          customerPhone: "+91 98300 12345",
          timeSlot: "11:30 AM",
        },
      });

      await controller.bookPublicToken(req, res, next);

      expect(res.statusCode).toBe(201);
      const data = res._responseData?.data;
      expect(data).toBeDefined();
      expect(data.tokenLabel).toMatch(/^[A-Z0-9]{2,}\d+$/);
      expect(data.locationId).toBe(branch.id);
      expect(data.serviceId).toBe(service.id);
      expect(data.status).toBe("WAITING");

      // Verify the turn exists in database
      const queueEntry = await prisma.queueEntry.findUnique({
        where: { id: data.id },
      });
      expect(queueEntry).not.toBeNull();
      expect((queueEntry?.metadata as any)?.customerName).toBe("Sourav Ganguly");
      expect((queueEntry?.metadata as any)?.customerPhone).toBe("+91 98300 12345");
      expect(queueEntry?.tenantId).toBe("tenant-pnb");
    });

    it("should book a doctor consultation turn at Apollo Clinic Baguiati", async () => {
      const apollo = await prisma.tenant.findUnique({
        where: { id: "tenant-apollo-baguiati" },
        include: { locations: true, services: true },
      });
      const branch = apollo!.locations[0];
      const docService = apollo!.services.find((s) => s.name === "Specialist Doctor Consultation") || apollo!.services[0];

      const idempotencyKey = `apollo-turn-${crypto.randomUUID()}`;
      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-apollo-baguiati" },
        headers: { "idempotency-key": idempotencyKey },
        body: {
          branchId: branch.id,
          serviceId: docService.id,
          customerName: "Ananya Mukherjee",
          customerPhone: "+91 98311 55667",
          timeSlot: "04:30 PM",
        },
      });

      await controller.bookPublicToken(req, res, next);

      expect(res.statusCode).toBe(201);
      const data = res._responseData?.data;
      expect(data).toBeDefined();
      expect(data.status).toBe("WAITING");
      expect(data.serviceId).toBe(docService.id);

      const dbEntry = await prisma.queueEntry.findUnique({ where: { id: data.id } });
      expect((dbEntry?.metadata as any)?.customerName).toBe("Ananya Mukherjee");
    });

    it("should book a blood diagnostic turn at Spandan Diagnostic Center", async () => {
      const spandan = await prisma.tenant.findUnique({
        where: { id: "tenant-spandan-diagnostics" },
        include: { locations: true, services: true },
      });
      const branch = spandan!.locations[0];
      const pathService = spandan!.services.find((s) => s.name === "Pathology & Routine Blood Tests") || spandan!.services[0];

      const idempotencyKey = `spandan-turn-${crypto.randomUUID()}`;
      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-spandan-diagnostics" },
        headers: { "idempotency-key": idempotencyKey },
        body: {
          branchId: branch.id,
          serviceId: pathService.id,
          customerName: "Debashis Roy",
          customerPhone: "+91 98322 77889",
          timeSlot: "08:00 AM",
        },
      });

      await controller.bookPublicToken(req, res, next);

      expect(res.statusCode).toBe(201);
      const data = res._responseData?.data;
      expect(data).toBeDefined();
      expect(data.tokenLabel).toBeDefined();
    });

    it("should book an OPD turn at REVIVE NURSING HOME Baguiati", async () => {
      const revive = await prisma.tenant.findUnique({
        where: { id: "tenant-revive-hospital" },
        include: { locations: true, services: true },
      });
      const branch = revive!.locations[0];
      const opdService = revive!.services.find((s) => s.name === "Outpatient Consultations (OPD)") || revive!.services[0];

      const idempotencyKey = `revive-turn-${crypto.randomUUID()}`;
      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-revive-hospital" },
        headers: { "idempotency-key": idempotencyKey },
        body: {
          branchId: branch.id,
          serviceId: opdService.id,
          customerName: "Rina Ghosh",
          customerPhone: "+91 98333 99001",
          timeSlot: "10:15 AM",
        },
      });

      await controller.bookPublicToken(req, res, next);

      expect(res.statusCode).toBe(201);
      const data = res._responseData?.data;
      expect(data).toBeDefined();
      expect(data.status).toBe("WAITING");
    });

    it("should enforce Idempotency: re-booking with the same key returns the exact same turn token without incrementing queue", async () => {
      const pnb = await prisma.tenant.findUnique({
        where: { id: "tenant-pnb" },
        include: { locations: true, services: true },
      });
      const branch = pnb!.locations[0];
      const service = pnb!.services[0];
      const repeatIdempotencyKey = `idemp-test-${crypto.randomUUID()}`;

      // First call
      const firstCall = createMockReqRes({
        params: { id: "tenant-pnb" },
        headers: { "idempotency-key": repeatIdempotencyKey },
        body: {
          branchId: branch.id,
          serviceId: service.id,
          customerName: "Priyanka Sen",
          customerPhone: "+91 98300 00111",
          timeSlot: "02:00 PM",
        },
      });
      await controller.bookPublicToken(firstCall.req, firstCall.res, firstCall.next);
      expect(firstCall.res.statusCode).toBe(201);
      const firstTokenId = firstCall.res._responseData?.data?.id;
      const firstTokenLabel = firstCall.res._responseData?.data?.tokenLabel;

      // Second call with same idempotency key
      const secondCall = createMockReqRes({
        params: { id: "tenant-pnb" },
        headers: { "idempotency-key": repeatIdempotencyKey },
        body: {
          branchId: branch.id,
          serviceId: service.id,
          customerName: "Priyanka Sen",
          customerPhone: "+91 98300 00111",
          timeSlot: "02:00 PM",
        },
      });
      await controller.bookPublicToken(secondCall.req, secondCall.res, secondCall.next);

      expect(secondCall.res.statusCode).toBe(201);
      expect(secondCall.res._responseData?.data?.id).toBe(firstTokenId);
      expect(secondCall.res._responseData?.data?.tokenLabel).toBe(firstTokenLabel);
    });

    it("should reject cross-tenant booking attempts with 400 Bad Request", async () => {
      // Branch from PNB, but booking under Axis Bank
      const pnb = await prisma.tenant.findUnique({
        where: { id: "tenant-pnb" },
        include: { locations: true },
      });
      const pnbBranch = pnb!.locations[0];

      const { req, res, next } = createMockReqRes({
        params: { id: "tenant-axis" },
        headers: { "idempotency-key": `idor-${crypto.randomUUID()}` },
        body: {
          branchId: pnbBranch.id, // belongs to PNB, not Axis!
          customerName: "Hacker Attempt",
        },
      });

      await controller.bookPublicToken(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res._responseData?.message).toBe("Invalid branch for this organization");
    });
  });
});

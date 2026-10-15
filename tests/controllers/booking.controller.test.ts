import { describe, it, expect, vi } from "vitest";
import { Request, Response } from "express";
import { createBookingController } from "../../src/modules/booking/booking.controller";

const createMockReqRes = (overrides: Partial<Request> = {}) => {
  const req = {
    headers: { "x-tenant-id": "tenant_test" },
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

describe("Booking Controller Unit Test Suite", () => {
  const mockBookingService = {
    createBooking: vi.fn(),
  };

  const mockBookingRepository = {
    findById: vi.fn(),
    findByBranch: vi.fn(),
    createBooking: vi.fn(),
  };

  const controller = createBookingController({
    bookingService: mockBookingService as any,
    bookingRepository: mockBookingRepository as any,
  });

  it("should create booking and return 201 with created record", async () => {
    const fakeBooking = { id: "bk_123", bookingNo: "BK-001", customerId: "c_1" };
    mockBookingService.createBooking.mockResolvedValueOnce(fakeBooking);

    const { req, res, next } = createMockReqRes({
      body: { branchId: "b_1", serviceId: "s_1", customerId: "c_1" },
    });

    await controller.create(req, res, next);

    expect(mockBookingService.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      req.body
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeBooking });
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next with error when booking creation fails", async () => {
    const error = new Error("Creation failed");
    mockBookingService.createBooking.mockRejectedValueOnce(error);

    const { req, res, next } = createMockReqRes({
      body: { branchId: "b_1" },
    });

    await controller.create(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it("should fetch booking by ID and return 200", async () => {
    const fakeBooking = { id: "bk_999", bookingNo: "BK-999" };
    mockBookingRepository.findById.mockResolvedValueOnce(fakeBooking);

    const { req, res, next } = createMockReqRes({
      params: { id: "bk_999" },
    });

    await controller.getById(req, res, next);

    expect(mockBookingRepository.findById).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "bk_999"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeBooking });
  });

  it("should fetch bookings by branch ID and return 200", async () => {
    const branchBookings = [{ id: "bk_1" }, { id: "bk_2" }];
    mockBookingRepository.findByBranch.mockResolvedValueOnce(branchBookings);

    const { req, res, next } = createMockReqRes({
      params: { branchId: "branch_kolkata" },
    });

    await controller.getByBranch(req, res, next);

    expect(mockBookingRepository.findByBranch).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "branch_kolkata"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: branchBookings });
  });
});

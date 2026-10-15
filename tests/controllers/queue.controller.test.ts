import { describe, it, expect, vi } from "vitest";
import { Request, Response } from "express";
import { createQueueController } from "../../src/modules/queue/queue.controller";

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

describe("Queue Controller Unit Test Suite", () => {
  const mockQueueService = {
    callEntry: vi.fn(),
    startService: vi.fn(),
    completeService: vi.fn(),
    markNoShow: vi.fn(),
    cancelEntry: vi.fn(),
  };

  const mockQueueRepository = {
    findActiveByBranch: vi.fn(),
    findEntryById: vi.fn(),
    updateEntryStatus: vi.fn(),
  };

  const controller = createQueueController({
    queueService: mockQueueService as any,
    queueRepository: mockQueueRepository as any,
  });

  it("should get active entries by branch and return 200", async () => {
    const fakeEntries = [{ id: "entry_1", tokenNumber: 101 }];
    mockQueueRepository.findActiveByBranch.mockResolvedValueOnce(fakeEntries);

    const { req, res, next } = createMockReqRes({
      params: { branchId: "branch_main" },
    });

    await controller.getActiveByBranch(req, res, next);

    expect(mockQueueRepository.findActiveByBranch).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "branch_main"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeEntries });
  });

  it("should get queue entry by id and return 200", async () => {
    const fakeEntry = { id: "entry_1", tokenNumber: 101, status: "WAITING" };
    mockQueueRepository.findEntryById.mockResolvedValueOnce(fakeEntry);

    const { req, res, next } = createMockReqRes({
      params: { id: "entry_1" },
    });

    await controller.getEntryById(req, res, next);

    expect(mockQueueRepository.findEntryById).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "entry_1"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeEntry });
  });

  it("should call entry and return 200 with result", async () => {
    const fakeResult = { result: { id: "entry_1", status: "CALLED" } };
    mockQueueService.callEntry.mockResolvedValueOnce(fakeResult);

    const { req, res, next } = createMockReqRes({
      params: { id: "entry_1" },
      body: { counterId: "counter_5" },
    });

    await controller.callEntry(req, res, next);

    expect(mockQueueService.callEntry).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "entry_1",
      "counter_5"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeResult });
  });

  it("should start service and return 200 with result", async () => {
    const fakeResult = { result: { id: "entry_1", status: "SERVING" } };
    mockQueueService.startService.mockResolvedValueOnce(fakeResult);

    const { req, res, next } = createMockReqRes({
      params: { id: "entry_1" },
    });

    await controller.startService(req, res, next);

    expect(mockQueueService.startService).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "entry_1"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeResult });
  });

  it("should complete service and return 200 with result", async () => {
    const fakeResult = { result: { id: "entry_1", status: "COMPLETED" } };
    mockQueueService.completeService.mockResolvedValueOnce(fakeResult);

    const { req, res, next } = createMockReqRes({
      params: { id: "entry_1" },
    });

    await controller.completeService(req, res, next);

    expect(mockQueueService.completeService).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "entry_1"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeResult });
  });

  it("should mark entry as no-show and return 200", async () => {
    const fakeResult = { result: { id: "entry_1", status: "NO_SHOW" } };
    mockQueueService.markNoShow.mockResolvedValueOnce(fakeResult);

    const { req, res, next } = createMockReqRes({
      params: { id: "entry_1" },
    });

    await controller.markNoShow(req, res, next);

    expect(mockQueueService.markNoShow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "entry_1"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeResult });
  });

  it("should cancel entry and return 200 with reason", async () => {
    const fakeResult = { result: { id: "entry_1", status: "CANCELLED" } };
    mockQueueService.cancelEntry.mockResolvedValueOnce(fakeResult);

    const { req, res, next } = createMockReqRes({
      params: { id: "entry_1" },
      body: { reason: "Customer left premises" },
    });

    await controller.cancelEntry(req, res, next);

    expect(mockQueueService.cancelEntry).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "entry_1",
      "Customer left premises"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeResult });
  });

  it("should pass caught errors to next()", async () => {
    const error = new Error("Database error");
    mockQueueRepository.findEntryById.mockRejectedValueOnce(error);

    const { req, res, next } = createMockReqRes({
      params: { id: "entry_err" },
    });

    await controller.getEntryById(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

import { describe, it, expect, vi } from "vitest";
import { Request, Response } from "express";
import { createFormController } from "../../src/modules/form/form.controller";

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

describe("Form Controller Unit Test Suite", () => {
  const mockFormRepository = {
    findFormById: vi.fn(),
    findPublishedFormForBranchAndService: vi.fn(),
  };

  const controller = createFormController({
    formRepository: mockFormRepository as any,
  });

  it("should get form by ID and return 200 with form data", async () => {
    const fakeForm = { id: "form_123", name: "Patient Intake", versions: [] };
    mockFormRepository.findFormById.mockResolvedValueOnce(fakeForm);

    const { req, res, next } = createMockReqRes({
      params: { id: "form_123" },
    });

    await controller.getFormById(req, res, next);

    expect(mockFormRepository.findFormById).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "form_123"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeForm });
    expect(next).not.toHaveBeenCalled();
  });

  it("should get published form for branch and service and return 200", async () => {
    const fakePublished = { id: "form_123", publishedVersionId: "v_1" };
    mockFormRepository.findPublishedFormForBranchAndService.mockResolvedValueOnce(fakePublished);

    const { req, res, next } = createMockReqRes({
      query: { branchId: "b_1", serviceId: "s_1" },
    });

    await controller.getPublishedForm(req, res, next);

    expect(mockFormRepository.findPublishedFormForBranchAndService).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_test" }),
      "b_1",
      "s_1"
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakePublished });
  });

  it("should pass error to next if form query throws", async () => {
    const error = new Error("Form not found");
    mockFormRepository.findFormById.mockRejectedValueOnce(error);

    const { req, res, next } = createMockReqRes({
      params: { id: "invalid_id" },
    });

    await controller.getFormById(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

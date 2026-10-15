import { TenantContext } from "../../core/tenant/tenant-context";
import { BookingRepository } from "../../repository/booking.repository";
import { BranchRepository } from "../../repository/branch.repository";
import { FormRepository } from "../../repository/form.repository";
import { CustomerRepository } from "../../repository/customer.repository";
import { Authorizer } from "../../core/authorization/authorizer";
import { Permission } from "../../core/authorization/permissions";
import { TenantAccessDeniedError } from "../../core/errors/security.errors";

export interface CreateBookingRequest {
  branchId: string;
  serviceId: string;
  customerId: string;
  formId: string;
  scheduledAt: Date;
  notes?: string;
}

export interface BookingServiceDeps {
  bookingRepo?: BookingRepository;
  branchRepo?: BranchRepository;
  formRepo?: FormRepository;
  customerRepo?: CustomerRepository;
}

export const createBookingService = (deps: BookingServiceDeps = {}) => {
  const bookingRepo = deps.bookingRepo ?? new BookingRepository();
  const branchRepo = deps.branchRepo ?? new BranchRepository();
  const formRepo = deps.formRepo ?? new FormRepository();
  const customerRepo = deps.customerRepo ?? new CustomerRepository();

  const createBooking = async (context: TenantContext, req: CreateBookingRequest) => {
    // 1. Check permission
    Authorizer.authorize(context, Permission.BOOKING_CREATE);

    // 2. Load branch and verify tenant ownership
    const branch = await branchRepo.findById(context, req.branchId);

    // 3. Load customer and verify tenant ownership
    const customer = await customerRepo.findById(context, req.customerId);

    // 4. Load form and verify tenant & branch & service ownership
    const form = await formRepo.findFormById(context, req.formId);

    // Enforce Tenant & Resource ownership invariants
    if (
      branch.tenantId !== context.tenantId ||
      customer.tenantId !== context.tenantId ||
      form.tenantId !== context.tenantId
    ) {
      throw new TenantAccessDeniedError("Cross-tenant resource mismatch detected in booking pipeline");
    }

    const formVersionId = form.publishedVersionId ?? form.versions?.[0]?.id ?? form.id;

    // 5. Create booking scoped to context.tenantId
    return bookingRepo.createBooking(context, {
      branchId: req.branchId,
      serviceId: req.serviceId,
      customerId: req.customerId,
      formVersionId,
      scheduledAt: req.scheduledAt,
      notes: req.notes,
    });
  };

  return {
    createBooking,
  };
};

export type BookingService = ReturnType<typeof createBookingService>;
export const BookingService = createBookingService;

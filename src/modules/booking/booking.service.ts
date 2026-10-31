import { TenantContext } from "../../core/tenant/tenant-context";
import { BookingRepository } from "../../repository/booking.repository";
import { BranchRepository } from "../../repository/branch.repository";
import { FormRepository } from "../../repository/form.repository";
import { CustomerRepository } from "../../repository/customer.repository";
import { Authorizer } from "../../core/authorization/authorizer";
import { Permission } from "../../core/authorization/permissions";
import { TenantAccessDeniedError } from "../../core/errors/security.errors";
import { RealtimeEmitter, realtimeEmitter } from "../../lib/socket/socket.emitter";
import { RealtimeCacheService, realtimeCacheService } from "../../lib/redis/realtime-cache.service";
import { RealtimeEventType } from "../../lib/socket/socket.types";
import { BookingStatus } from "@prisma/client";

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
  emitter?: RealtimeEmitter;
  cache?: RealtimeCacheService;
}

export const createBookingService = (deps: BookingServiceDeps = {}) => {
  const bookingRepo = deps.bookingRepo ?? new BookingRepository();
  const branchRepo = deps.branchRepo ?? new BranchRepository();
  const formRepo = deps.formRepo ?? new FormRepository();
  const customerRepo = deps.customerRepo ?? new CustomerRepository();
  const emitter = deps.emitter ?? realtimeEmitter;
  const cache = deps.cache ?? realtimeCacheService;

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

    // 5. Create booking scoped to context.tenantId with atomic idempotency persistence
    const booking = await bookingRepo.createBooking(
      context,
      {
        branchId: req.branchId,
        serviceId: req.serviceId,
        customerId: req.customerId,
        formVersionId,
        scheduledAt: req.scheduledAt,
        notes: req.notes,
        idempotencyKey: (req as any).idempotencyKey,
      },
      (req as any).idempotencyKey
        ? {
            scope: "BOOKING_CREATE",
            actorId: context.userId || "ANONYMOUS",
          }
        : undefined
    );

    // 6. Cache booking in Redis
    await cache.cacheBooking(context.tenantId, booking.id, booking);

    // 7. Emit real-time event
    emitter.emitBookingEvent(context.tenantId, req.branchId, RealtimeEventType.BOOKING_CREATED, {
      bookingId: booking.id,
      bookingNo: booking.bookingNo,
      branchId: req.branchId,
      serviceId: req.serviceId,
      customerId: req.customerId,
      status: booking.status,
      scheduledAt: booking.scheduledAt,
      createdAt: booking.createdAt,
    });

    return booking;
  };

  const checkInBooking = async (context: TenantContext, bookingId: string) => {
    Authorizer.authorize(context, Permission.BOOKING_UPDATE);
    const booking = await bookingRepo.findById(context, bookingId);
    Authorizer.authorize(context, Permission.BOOKING_UPDATE, {
      tenantId: booking.tenantId,
      branchId: booking.locationId,
    });

    const result = await bookingRepo.checkInAndCreateQueueEntry(context, bookingId);
    const branchId = booking.locationId;

    // Invalidate caches
    await cache.invalidateBooking(context.tenantId, bookingId);
    await cache.invalidateBranchQueue(context.tenantId, branchId);

    // Emit real-time events for both Booking arrived & Queue entry created
    emitter.emitBookingEvent(context.tenantId, branchId, RealtimeEventType.BOOKING_CHECKED_IN, {
      bookingId,
      status: "ARRIVED",
      branchId,
      queueEntryId: result.queueEntry.id,
      tokenLabel: result.queueEntry.tokenLabel,
      tokenNumber: result.queueEntry.tokenNumber,
      updatedAt: new Date().toISOString(),
    });

    emitter.emitQueueEvent(context.tenantId, branchId, RealtimeEventType.QUEUE_ENTRY_CREATED, {
      queueEntryId: result.queueEntry.id,
      bookingId,
      tokenLabel: result.queueEntry.tokenLabel,
      tokenNumber: result.queueEntry.tokenNumber,
      status: result.queueEntry.status,
      branchId,
      serviceId: result.queueEntry.serviceId,
      source: "BOOKING",
      createdAt: result.queueEntry.createdAt,
    });

    return result;
  };

  const cancelBooking = async (context: TenantContext, bookingId: string, reason?: string) => {
    Authorizer.authorize(context, Permission.BOOKING_UPDATE);
    const booking = await bookingRepo.findById(context, bookingId);
    Authorizer.authorize(context, Permission.BOOKING_UPDATE, {
      tenantId: booking.tenantId,
      branchId: booking.locationId,
    });

    const updated = await bookingRepo.updateStatus(context, bookingId, BookingStatus.CANCELLED);
    const branchId = booking.locationId;

    await cache.invalidateBooking(context.tenantId, bookingId);

    emitter.emitBookingEvent(context.tenantId, branchId, RealtimeEventType.BOOKING_CANCELLED, {
      bookingId,
      status: "CANCELLED",
      reason,
      branchId,
      updatedAt: new Date().toISOString(),
    });

    return updated;
  };

  const completeBooking = async (context: TenantContext, bookingId: string) => {
    Authorizer.authorize(context, Permission.BOOKING_UPDATE);
    const booking = await bookingRepo.findById(context, bookingId);
    Authorizer.authorize(context, Permission.BOOKING_UPDATE, {
      tenantId: booking.tenantId,
      branchId: booking.locationId,
    });

    const updated = await bookingRepo.updateStatus(context, bookingId, BookingStatus.COMPLETED);
    const branchId = booking.locationId;

    await cache.invalidateBooking(context.tenantId, bookingId);

    emitter.emitBookingEvent(context.tenantId, branchId, RealtimeEventType.BOOKING_COMPLETED, {
      bookingId,
      status: "COMPLETED",
      branchId,
      updatedAt: new Date().toISOString(),
    });

    return updated;
  };

  return {
    createBooking,
    checkInBooking,
    cancelBooking,
    completeBooking,
  };
};

export type BookingService = ReturnType<typeof createBookingService>;
export const BookingService = createBookingService;

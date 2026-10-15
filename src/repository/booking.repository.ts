import crypto from "crypto";
import { BookingStatus } from "@prisma/client";
import { TenantContext } from "../core/tenant/tenant-context";
import { getTenantDb, withTenantScope, ensureFound } from "../common/base.repository";

export interface CreateBookingData {
  branchId?: string;
  locationId?: string;
  serviceId: string;
  customerId: string;
  scheduledAt: Date;
  notes?: string;
  formVersionId?: string;
  bookingNo?: string;
  idempotencyKey?: string;
  status?: BookingStatus;
  slotId?: string;
}

export const createBookingRepository = () => {
  const findById = async (context: TenantContext, bookingId: string) => {
    const db = await getTenantDb(context);
    const booking = await db.booking.findFirst({
      where: withTenantScope(context, { id: bookingId }),
      include: {
        location: true,
        service: true,
        customer: true,
      },
    });
    return ensureFound(booking, "Booking");
  };

  const findByBranch = async (context: TenantContext, branchId: string) => {
    const db = await getTenantDb(context);
    return db.booking.findMany({
      where: withTenantScope(context, { locationId: branchId }),
      orderBy: { createdAt: "desc" },
    });
  };

  const createBooking = async (
    context: TenantContext,
    data: CreateBookingData
  ) => {
    const db = await getTenantDb(context);
    const locationId = data.locationId ?? data.branchId;
    if (!locationId) {
      throw new Error("locationId or branchId is required to create a booking");
    }

    if (!data.serviceId) {
      throw new Error("serviceId is required to create a booking");
    }

    const bookingNo =
      data.bookingNo ??
      `BK-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const idempotencyKey = data.idempotencyKey ?? crypto.randomUUID();
    const formVersionId = data.formVersionId ?? crypto.randomUUID();
    const status = data.status ?? BookingStatus.CONFIRMED;

    return db.booking.create({
      data: {
        tenantId: context.tenantId,
        bookingNo,
        locationId,
        serviceId: data.serviceId,
        customerId: data.customerId,
        scheduledAt: data.scheduledAt,
        status,
        formVersionId,
        idempotencyKey,
        slotId: data.slotId,
      },
    });
  };

  return {
    findById,
    findByBranch,
    createBooking,
  };
};

export type BookingRepository = ReturnType<typeof createBookingRepository>;

export class BookingRepositoryAdapter {
  private repo = createBookingRepository();
  findById = this.repo.findById;
  findByBranch = this.repo.findByBranch;
  createBooking = this.repo.createBooking;
}

export const BookingRepository = BookingRepositoryAdapter as unknown as typeof BookingRepositoryAdapter &
  typeof createBookingRepository;

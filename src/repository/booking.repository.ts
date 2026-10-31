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

  const findAll = async (context: TenantContext) => {
    const db = await getTenantDb(context);
    return db.booking.findMany({
      where: withTenantScope(context, {}),
      include: {
        location: true,
        service: true,
        customer: true,
      },
      orderBy: { createdAt: "desc" },
    });
  };

  const findByBranch = async (context: TenantContext, branchId: string) => {
    const db = await getTenantDb(context);
    return db.booking.findMany({
      where: withTenantScope(context, { locationId: branchId }),
      include: {
        location: true,
        service: true,
        customer: true,
      },
      orderBy: { createdAt: "desc" },
    });
  };

  const createBooking = async (
    context: TenantContext,
    data: CreateBookingData,
    idempotencyMeta?: {
      scope?: string;
      actorId?: string;
      requestHash?: string;
    }
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

    // Atomically write business record and idempotency state in a single transaction
    return db.$transaction(async (tx) => {
      const booking = await tx.booking.create({
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

      if (data.idempotencyKey || idempotencyMeta) {
        const scope = idempotencyMeta?.scope || "BOOKING_CREATE";
        const actorId = idempotencyMeta?.actorId || context.userId || "ANONYMOUS";
        const requestHash =
          idempotencyMeta?.requestHash ||
          crypto.createHash("sha256").update(idempotencyKey).digest("hex");

        const idempotencyPayload = {
          tenantId: context.tenantId,
          scope,
          actorId,
          key: idempotencyKey,
          requestHash,
          status: "COMPLETED",
          responseStatus: 201,
          responseBody: { success: true, data: booking },
          expiresAt: new Date(Date.now() + 86400 * 1000),
        };

        await (tx.idempotencyKey as any).upsert({
          where: {
            tenantId_scope_actorId_key: {
              tenantId: context.tenantId,
              scope,
              actorId,
              key: idempotencyKey,
            },
          },
          create: idempotencyPayload,
          update: {
            status: "COMPLETED",
            responseStatus: 201,
            responseBody: { success: true, data: booking },
            lockOwnerToken: null,
            lockedUntil: null,
            expiresAt: new Date(Date.now() + 86400 * 1000),
          },
        });
      }

      return booking;
    });
  };

  const updateStatus = async (
    context: TenantContext,
    bookingId: string,
    status: BookingStatus
  ) => {
    const db = await getTenantDb(context);
    await findById(context, bookingId);

    return db.booking.update({
      where: { id: bookingId },
      data: {
        status,
        updatedAt: new Date(),
      },
    });
  };

  const checkInAndCreateQueueEntry = async (
    context: TenantContext,
    bookingId: string
  ) => {
    const db = await getTenantDb(context);
    const booking = await findById(context, bookingId);

    // Update booking status to ARRIVED
    const updatedBooking = await db.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.ARRIVED,
        updatedAt: new Date(),
      },
    });

    // Find or create queue for the location and service
    let queue = await db.queue.findFirst({
      where: withTenantScope(context, {
        locationId: booking.locationId,
        serviceId: booking.serviceId,
      }),
    });

    if (!queue) {
      queue = await db.queue.create({
        data: {
          tenantId: context.tenantId,
          locationId: booking.locationId,
          serviceId: booking.serviceId,
          name: `Queue-${booking.locationId.substring(0, 4)}`,
          code: `Q-${booking.serviceId.substring(0, 6).toUpperCase()}`,
        },
      });
    }

    const tokenNumber = Math.floor(100 + Math.random() * 900);
    const tokenLabel = `B-${tokenNumber}`;

    const queueEntry = await db.queueEntry.create({
      data: {
        tenantId: context.tenantId,
        locationId: booking.locationId,
        queueId: queue.id,
        serviceId: booking.serviceId,
        customerId: booking.customerId,
        bookingId: booking.id,
        tokenNumber,
        tokenLabel,
        status: "WAITING",
        source: "BOOKING",
      },
    });

    return {
      booking: updatedBooking,
      queueEntry,
    };
  };

  return {
    findById,
    findAll,
    findByBranch,
    createBooking,
    updateStatus,
    checkInAndCreateQueueEntry,
  };
};

export type BookingRepository = ReturnType<typeof createBookingRepository>;

export const createBookingRepositoryAdapter = () => createBookingRepository();

export const BookingRepositoryAdapter = function (this: unknown) {
  return createBookingRepository();
} as unknown as {
  new(): ReturnType<typeof createBookingRepository>;
};

export const BookingRepository = BookingRepositoryAdapter as unknown as typeof BookingRepositoryAdapter &
  typeof createBookingRepository;



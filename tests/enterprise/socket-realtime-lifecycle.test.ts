import "dotenv/config";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantContext } from "../../src/core/tenant/tenant-context";
import { Role } from "../../src/core/authorization/roles";
import { Permission } from "../../src/core/authorization/permissions";
import { SocketAuthorizer } from "../../src/lib/socket/socket.authorizer";
import { RealtimeCacheService } from "../../src/lib/redis/realtime-cache.service";
import { RealtimeEmitter } from "../../src/lib/socket/socket.emitter";
import { RealtimeEventType } from "../../src/lib/socket/socket.types";
import { QueueService } from "../../src/modules/queue/queue.service";
import { createBookingService } from "../../src/modules/booking/booking.service";
import { BookingStatus } from "@prisma/client";

// Test Tenant Contexts
const tenantA_Context: TenantContext = {
  tenantId: "tenant_bank_a",
  userId: "usr_agent_01",
  roleIds: [Role.TENANT_ADMIN],
  permissions: [
    Permission.QUEUE_READ,
    Permission.QUEUE_UPDATE,
    Permission.QUEUE_TRANSFER,
    Permission.QUEUE_REQUEUE_OVERRIDE,
    Permission.BOOKING_CREATE,
    Permission.BOOKING_READ,
    Permission.BOOKING_UPDATE,
  ],
  branchIds: ["branch_central", "branch_north"],
  sessionId: "sess_test_01",
  securityVersion: 1,
};

const tenantB_Context: TenantContext = {
  tenantId: "tenant_hospital_b",
  userId: "usr_doc_02",
  roleIds: [Role.TENANT_ADMIN],
  permissions: [Permission.QUEUE_READ, Permission.QUEUE_UPDATE, Permission.BOOKING_CREATE],
  branchIds: ["branch_clinic"],
  sessionId: "sess_test_02",
  securityVersion: 1,
};

describe("QueueFlow Socket.IO & Redis Caching Real-Time Lifecycle Suite", () => {
  let cacheService: RealtimeCacheService;
  let mockEmitter: RealtimeEmitter;
  let emittedQueueEvents: Array<{ eventType: string; payload: any }> = [];
  let emittedBookingEvents: Array<{ eventType: string; payload: any }> = [];
  let emittedDisplayCalls: any[] = [];
  let emittedDisplayClears: any[] = [];

  beforeEach(() => {
    cacheService = new RealtimeCacheService();
    emittedQueueEvents = [];
    emittedBookingEvents = [];
    emittedDisplayCalls = [];
    emittedDisplayClears = [];

    // Mock RealtimeEmitter to inspect dispatched real-time packets
    mockEmitter = {
      emitQueueEvent: vi.fn((_tenantId, _branchId, eventType, payload) => {
        emittedQueueEvents.push({ eventType, payload });
      }),
      emitBookingEvent: vi.fn((_tenantId, _branchId, eventType, payload) => {
        emittedBookingEvents.push({ eventType, payload });
      }),
      emitDisplayCall: vi.fn((_tenantId, _branchId, payload) => {
        emittedDisplayCalls.push(payload);
      }),
      emitDisplayClear: vi.fn((_tenantId, _branchId, payload) => {
        emittedDisplayClears.push(payload);
      }),
    } as unknown as RealtimeEmitter;
  });

  // ============================================================================
  // 1. SOCKET AUTHORIZATION & ROOM ISOLATION
  // ============================================================================

  describe("1. Socket Room Authorization & Multi-Tenant Isolation", () => {
    it("should allow a tenant socket to join its own tenant broadcast room", () => {
      const mockSocketA: any = {
        id: "sock_a",
        tenantContext: tenantA_Context,
        join: vi.fn(),
        emit: vi.fn(),
      };

      const allowed = SocketAuthorizer.joinRoom(mockSocketA, "tenant:tenant_bank_a");
      expect(allowed).toBe(true);
      expect(mockSocketA.join).toHaveBeenCalledWith("tenant:tenant_bank_a");
    });

    it("should allow a tenant socket to join an authorized branch room and display room", () => {
      const mockSocketA: any = {
        id: "sock_a",
        tenantContext: tenantA_Context,
        join: vi.fn(),
        emit: vi.fn(),
      };

      const branchRoomAllowed = SocketAuthorizer.joinRoom(
        mockSocketA,
        "tenant:tenant_bank_a:branch:branch_central"
      );
      expect(branchRoomAllowed).toBe(true);

      const displayRoomAllowed = SocketAuthorizer.joinRoom(
        mockSocketA,
        "tenant:tenant_bank_a:branch:branch_central:display"
      );
      expect(displayRoomAllowed).toBe(true);
    });

    it("should strictly reject cross-tenant room subscriptions", () => {
      const mockSocketA: any = {
        id: "sock_a",
        tenantContext: tenantA_Context,
        join: vi.fn(),
        emit: vi.fn(),
      };

      // Tenant A trying to snoop on Tenant B's room
      const denied = SocketAuthorizer.joinRoom(mockSocketA, "tenant:tenant_hospital_b");
      expect(denied).toBe(false);
      expect(mockSocketA.emit).toHaveBeenCalledWith("error", {
        message: "Unauthorized socket room subscription attempt",
      });
    });
  });

  // ============================================================================
  // 2. REDIS CACHING & FAST-PATH SNAPSHOTS
  // ============================================================================

  describe("2. Redis Caching Layer (Active Queue, Calling Display, Bookings)", () => {
    it("should cache and retrieve branch active queue with invalidation on mutation", async () => {
      const mockEntries = [
        { id: "qe_1", tokenLabel: "A-101", status: "WAITING" },
        { id: "qe_2", tokenLabel: "A-102", status: "WAITING" },
      ];

      await cacheService.cacheBranchQueue("tenant_bank_a", "branch_central", mockEntries, 60);
      const cached = await cacheService.getCachedBranchQueue("tenant_bank_a", "branch_central");
      expect(cached).toEqual(mockEntries);

      // Invalidation
      await cacheService.invalidateBranchQueue("tenant_bank_a", "branch_central");
      const afterInvalidate = await cacheService.getCachedBranchQueue("tenant_bank_a", "branch_central");
      expect(afterInvalidate).toBeNull();
    });

    it("should store and update Digital Display calling states per counter", async () => {
      await cacheService.setCallingDisplay("tenant_bank_a", "branch_central", "counter_1", {
        queueEntryId: "qe_1",
        tokenNumber: 101,
        tokenLabel: "A-101",
        counterId: "counter_1",
        counterNumber: "Counter 1",
        serviceName: "KYC Service",
        calledAt: new Date().toISOString(),
      });

      const displayState = await cacheService.getCallingDisplay("tenant_bank_a", "branch_central");
      expect(displayState["counter_1"]).toBeDefined();
      expect(displayState["counter_1"].tokenLabel).toBe("A-101");

      // Clear calling display
      await cacheService.clearCallingDisplay("tenant_bank_a", "branch_central", "counter_1");
      const clearedState = await cacheService.getCallingDisplay("tenant_bank_a", "branch_central");
      expect(clearedState["counter_1"]).toBeUndefined();
    });

    it("should cache and invalidate booking appointments", async () => {
      const bookingData = { id: "bk_99", status: "CONFIRMED", customerName: "John Doe" };
      await cacheService.cacheBooking("tenant_bank_a", "bk_99", bookingData, 60);

      const cachedBooking = await cacheService.getCachedBooking("tenant_bank_a", "bk_99");
      expect(cachedBooking).toEqual(bookingData);

      await cacheService.invalidateBooking("tenant_bank_a", "bk_99");
      const afterDelete = await cacheService.getCachedBooking("tenant_bank_a", "bk_99");
      expect(afterDelete).toBeNull();
    });
  });

  // ============================================================================
  // 3. QUEUE LIFECYCLE: CALL, START, COMPLETE, REQUEUE, NO-SHOW, CANCEL
  // ============================================================================

  describe("3. Queue Lifecycle Real-Time Events & Booking Auto-Completion", () => {
    it("should emit QUEUE_ENTRY_CALLED and DISPLAY_CALL with audio cue when calling a token", async () => {
      const mockQueueRepo: any = {
        findEntryById: vi.fn().mockResolvedValue({
          id: "qe_101",
          tenantId: "tenant_bank_a",
          locationId: "branch_central",
          serviceId: "srv_kyc",
          tokenNumber: 101,
          tokenLabel: "A-101",
          status: "WAITING",
          service: { name: "KYC Verification" },
        }),
        updateEntryStatus: vi.fn().mockResolvedValue({ id: "qe_101", status: "CALLED" }),
      };

      const queueService = new QueueService({
        queueRepo: mockQueueRepo,
        emitter: mockEmitter,
        cache: cacheService,
      });

      await queueService.callEntry(tenantA_Context, "qe_101", "counter_3");

      // Verify WebSocket queue event emitted
      expect(mockEmitter.emitQueueEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.QUEUE_ENTRY_CALLED,
        expect.objectContaining({
          queueEntryId: "qe_101",
          tokenLabel: "A-101",
          status: "CALLED",
        })
      );

      // Verify Display Announcement emitted with audio chime
      expect(mockEmitter.emitDisplayCall).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        expect.objectContaining({
          queueEntryId: "qe_101",
          tokenLabel: "A-101",
          soundCue: "CHIME",
        })
      );

      // Verify Redis calling display cache updated
      const displayState = await cacheService.getCallingDisplay("tenant_bank_a", "branch_central");
      expect(displayState["counter_3"]).toBeDefined();
      expect(displayState["counter_3"].tokenLabel).toBe("A-101");
    });

    it("should emit QUEUE_ENTRY_STARTED when service starts", async () => {
      const mockQueueRepo: any = {
        findEntryById: vi.fn().mockResolvedValue({
          id: "qe_101",
          tenantId: "tenant_bank_a",
          locationId: "branch_central",
          serviceId: "srv_kyc",
          status: "CALLED",
        }),
        updateEntryStatus: vi.fn().mockResolvedValue({ id: "qe_101", status: "IN_SERVICE" }),
      };

      const queueService = new QueueService({
        queueRepo: mockQueueRepo,
        emitter: mockEmitter,
        cache: cacheService,
      });

      await queueService.startService(tenantA_Context, "qe_101");

      expect(mockEmitter.emitQueueEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.QUEUE_ENTRY_STARTED,
        expect.objectContaining({
          queueEntryId: "qe_101",
          status: "IN_SERVICE",
        })
      );
    });

    it("should complete service, clear display screen, AND transition linked Booking to COMPLETED", async () => {
      const mockQueueRepo: any = {
        findEntryById: vi.fn().mockResolvedValue({
          id: "qe_101",
          tenantId: "tenant_bank_a",
          locationId: "branch_central",
          serviceId: "srv_kyc",
          status: "IN_SERVICE",
          counterId: "counter_3",
          bookingId: "bk_appointment_456", // LINKED BOOKING
        }),
        updateEntryStatus: vi.fn().mockResolvedValue({ id: "qe_101", status: "COMPLETED" }),
      };

      const mockBookingRepo: any = {
        updateStatus: vi.fn().mockResolvedValue({ id: "bk_appointment_456", status: BookingStatus.COMPLETED }),
      };

      const queueService = new QueueService({
        queueRepo: mockQueueRepo,
        bookingRepo: mockBookingRepo,
        emitter: mockEmitter,
        cache: cacheService,
      });

      // Seed display cache
      await cacheService.setCallingDisplay("tenant_bank_a", "branch_central", "counter_3", {
        queueEntryId: "qe_101",
        tokenNumber: 101,
        tokenLabel: "A-101",
        counterId: "counter_3",
        calledAt: new Date().toISOString(),
      });

      await queueService.completeEntry(tenantA_Context, "qe_101");

      // 1. Verify queue entry completed emitted
      expect(mockEmitter.emitQueueEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.QUEUE_ENTRY_COMPLETED,
        expect.objectContaining({ queueEntryId: "qe_101", status: "COMPLETED" })
      );

      // 2. Verify display cleared
      expect(mockEmitter.emitDisplayClear).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        expect.objectContaining({ counterId: "counter_3" })
      );

      // 3. Verify linked booking transitioned to COMPLETED in database
      expect(mockBookingRepo.updateStatus).toHaveBeenCalledWith(
        tenantA_Context,
        "bk_appointment_456",
        BookingStatus.COMPLETED
      );

      // 4. Verify BOOKING_COMPLETED real-time event was emitted
      expect(mockEmitter.emitBookingEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.BOOKING_COMPLETED,
        expect.objectContaining({
          bookingId: "bk_appointment_456",
          status: "COMPLETED",
        })
      );
    });

    it("should emit QUEUE_ENTRY_REQUEUED with updated requeueCount on token requeue", async () => {
      const mockQueueRepo: any = {
        findEntryById: vi.fn().mockResolvedValue({
          id: "qe_101",
          tenantId: "tenant_bank_a",
          locationId: "branch_central",
          serviceId: "srv_kyc",
          tokenNumber: 101,
          tokenLabel: "A-101",
          status: "CALLED",
          requeueCount: 0,
        }),
        requeueEntry: vi.fn().mockResolvedValue({ id: "qe_101", status: "WAITING", requeueCount: 1 }),
      };

      const queueService = new QueueService({
        queueRepo: mockQueueRepo,
        emitter: mockEmitter,
        cache: cacheService,
      });

      await queueService.requeueEntry(tenantA_Context, "qe_101", { reason: "Customer missed call" });

      expect(mockEmitter.emitQueueEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.QUEUE_ENTRY_REQUEUED,
        expect.objectContaining({
          queueEntryId: "qe_101",
          status: "WAITING",
          requeueCount: 1,
          reason: "Customer missed call",
        })
      );
    });

    it("should emit QUEUE_ENTRY_NO_SHOW and clear display screen on no-show", async () => {
      const mockQueueRepo: any = {
        findEntryById: vi.fn().mockResolvedValue({
          id: "qe_101",
          tenantId: "tenant_bank_a",
          locationId: "branch_central",
          serviceId: "srv_kyc",
          counterId: "counter_2",
          status: "CALLED",
        }),
        updateEntryStatus: vi.fn().mockResolvedValue({ id: "qe_101", status: "NO_SHOW" }),
      };

      const queueService = new QueueService({
        queueRepo: mockQueueRepo,
        emitter: mockEmitter,
        cache: cacheService,
      });

      await queueService.markNoShow(tenantA_Context, "qe_101");

      expect(mockEmitter.emitQueueEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.QUEUE_ENTRY_NO_SHOW,
        expect.objectContaining({
          queueEntryId: "qe_101",
          status: "NO_SHOW",
        })
      );
      expect(mockEmitter.emitDisplayClear).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 4. BOOKING LIFECYCLE: CREATE, CHECK-IN, CANCEL
  // ============================================================================

  describe("4. Booking Lifecycle Real-Time Events", () => {
    it("should emit BOOKING_CREATED and cache in Redis on booking creation", async () => {
      const mockBranchRepo: any = {
        findById: vi.fn().mockResolvedValue({ id: "branch_central", tenantId: "tenant_bank_a" }),
      };
      const mockCustomerRepo: any = {
        findById: vi.fn().mockResolvedValue({ id: "cust_1", tenantId: "tenant_bank_a" }),
      };
      const mockFormRepo: any = {
        findFormById: vi.fn().mockResolvedValue({ id: "form_1", tenantId: "tenant_bank_a", publishedVersionId: "fv_1" }),
      };
      const mockBookingRepo: any = {
        createBooking: vi.fn().mockResolvedValue({
          id: "bk_new_01",
          bookingNo: "BK-1001",
          status: BookingStatus.CONFIRMED,
          scheduledAt: new Date(),
          createdAt: new Date(),
        }),
      };

      const bookingService = createBookingService({
        bookingRepo: mockBookingRepo,
        branchRepo: mockBranchRepo,
        customerRepo: mockCustomerRepo,
        formRepo: mockFormRepo,
        emitter: mockEmitter,
        cache: cacheService,
      });

      await bookingService.createBooking(tenantA_Context, {
        branchId: "branch_central",
        serviceId: "srv_kyc",
        customerId: "cust_1",
        formId: "form_1",
        scheduledAt: new Date(),
      });

      expect(mockEmitter.emitBookingEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.BOOKING_CREATED,
        expect.objectContaining({
          bookingId: "bk_new_01",
          bookingNo: "BK-1001",
        })
      );

      // Verify cached in Redis
      const cached = await cacheService.getCachedBooking<{ id: string }>("tenant_bank_a", "bk_new_01");
      expect(cached).toBeDefined();
      expect(cached?.id).toBe("bk_new_01");
    });

    it("should emit BOOKING_CHECKED_IN and QUEUE_ENTRY_CREATED when customer checks in", async () => {
      const mockBookingRepo: any = {
        findById: vi.fn().mockResolvedValue({
          id: "bk_new_01",
          tenantId: "tenant_bank_a",
          locationId: "branch_central",
        }),
        checkInAndCreateQueueEntry: vi.fn().mockResolvedValue({
          booking: { id: "bk_new_01", status: BookingStatus.ARRIVED },
          queueEntry: {
            id: "qe_gen_55",
            tokenNumber: 555,
            tokenLabel: "B-555",
            status: "WAITING",
            serviceId: "srv_kyc",
            createdAt: new Date(),
          },
        }),
      };

      const bookingService = createBookingService({
        bookingRepo: mockBookingRepo,
        emitter: mockEmitter,
        cache: cacheService,
      });

      await bookingService.checkInBooking(tenantA_Context, "bk_new_01");

      // Verify BOOKING_CHECKED_IN emitted
      expect(mockEmitter.emitBookingEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.BOOKING_CHECKED_IN,
        expect.objectContaining({
          bookingId: "bk_new_01",
          status: "ARRIVED",
          tokenLabel: "B-555",
        })
      );

      // Verify QUEUE_ENTRY_CREATED emitted for staff queues
      expect(mockEmitter.emitQueueEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.QUEUE_ENTRY_CREATED,
        expect.objectContaining({
          queueEntryId: "qe_gen_55",
          tokenLabel: "B-555",
          source: "BOOKING",
        })
      );
    });

    it("should emit BOOKING_CANCELLED when booking is cancelled", async () => {
      const mockBookingRepo: any = {
        findById: vi.fn().mockResolvedValue({
          id: "bk_new_01",
          tenantId: "tenant_bank_a",
          locationId: "branch_central",
        }),
        updateStatus: vi.fn().mockResolvedValue({ id: "bk_new_01", status: BookingStatus.CANCELLED }),
      };

      const bookingService = createBookingService({
        bookingRepo: mockBookingRepo,
        emitter: mockEmitter,
        cache: cacheService,
      });

      await bookingService.cancelBooking(tenantA_Context, "bk_new_01", "Client request");

      expect(mockEmitter.emitBookingEvent).toHaveBeenCalledWith(
        "tenant_bank_a",
        "branch_central",
        RealtimeEventType.BOOKING_CANCELLED,
        expect.objectContaining({
          bookingId: "bk_new_01",
          status: "CANCELLED",
          reason: "Client request",
        })
      );
    });
  });
});

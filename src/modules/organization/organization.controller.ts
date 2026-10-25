import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../../config/prisma";
import { OrganizationService } from "./organization.service";
import { OrganizationRepository } from "../../repository/organization.repository";
import { AuthUser } from "../../common/types";

export const createOrganizationController = (deps: {
  organizationService: OrganizationService;
  organizationRepository: OrganizationRepository;
}) => {
  const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser | undefined = req.user
        ? {
            id: req.user.id,
            email: req.user.email,
            role: req.user.role,
            tenantId: req.user.tenantId,
          }
        : undefined;

      const result = await deps.organizationService.registerOrganization(req.body, actor);

      res.status(201).json({
        success: true,
        message: result.message || "Organization registered successfully. Confirmation email dispatched to admin.",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId, email, otp } = req.body;
      const result = await deps.organizationService.verifyOrganizationEmail({
        organizationId,
        email,
        otp,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser = {
        id: req.user?.id || "anonymous",
        email: req.user?.email,
        role: req.user?.role || "USER",
        tenantId: req.user?.tenantId,
      };

      const result = await deps.organizationService.getOrganizationById(req.params.id as string, actor);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const approve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser = {
        id: req.user?.id || "anonymous",
        email: req.user?.email,
        role: req.user?.role || "USER",
        tenantId: req.user?.tenantId,
      };

      const result = await deps.organizationService.approveOrganization(
        req.params.id as string,
        actor,
        req.body?.notes
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const reject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser = {
        id: req.user?.id || "anonymous",
        email: req.user?.email,
        role: req.user?.role || "USER",
        tenantId: req.user?.tenantId,
      };

      const result = await deps.organizationService.rejectOrganization(
        req.params.id as string,
        actor,
        req.body?.reason
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const listPending = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser = {
        id: req.user?.id || "anonymous",
        email: req.user?.email,
        role: req.user?.role || "USER",
        tenantId: req.user?.tenantId,
      };

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const cursor = req.query.cursor as string | undefined;

      const result = await deps.organizationService.listPendingOrganizations(actor, { limit, cursor });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const getReviewLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor: AuthUser = {
        id: req.user?.id || "anonymous",
        email: req.user?.email,
        role: req.user?.role || "USER",
        tenantId: req.user?.tenantId,
      };

      const logs = await deps.organizationService.getOrganizationReviewLogs(
        req.params.id as string,
        actor
      );

      res.status(200).json({
        success: true,
        data: logs,
      });
    } catch (error) {
      next(error);
    }
  };

  const listPublic = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const list = await prisma.tenant.findMany({
        where: {
          status: "ACTIVE",
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          legalName: true,
          slug: true,
          type: true,
          email: true,
          phone: true,
          country: true,
          timezone: true,
          status: true,
          _count: {
            select: {
              locations: true,
              services: true,
            },
          },
        },
        orderBy: { name: "asc" },
      });
      res.status(200).json({
        success: true,
        data: list,
      });
    } catch (error) {
      next(error);
    }
  };

  const listTenantServices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.id as string;
      const services = await prisma.service.findMany({
        where: {
          tenantId,
          status: "ACTIVE",
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          status: true,
          estimatedDurationSec: true,
          tenantId: true,
        },
        orderBy: { name: "asc" },
      });
      res.status(200).json({
        success: true,
        data: services,
      });
    } catch (error) {
      next(error);
    }
  };

  const listTenantBranches = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.id as string;
      const branches = await prisma.location.findMany({
        where: {
          tenantId,
          status: "ACTIVE",
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          phone: true,
          status: true,
          tenantId: true,
          _count: {
            select: {
              counters: true,
              services: true,
            },
          },
        },
        orderBy: { name: "asc" },
      });
      res.status(200).json({
        success: true,
        data: branches,
      });
    } catch (error) {
      next(error);
    }
  };

  const publicBookingIdempotencyCache = new Map<string, { status: number; body: any; expiresAt: number }>();
  const inFlightBookings = new Map<string, Promise<{ status: number; body: any }>>();

  const sanitizeText = (val: unknown, maxLen = 60): string => {
    if (typeof val !== "string") return "";
    return val
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim()
      .slice(0, maxLen);
  };

  const bookPublicToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.id as string;
      const { branchId, serviceId, timeSlot, customerName, customerPhone } = req.body;

      if (!branchId) {
        res.status(400).json({ success: false, message: "branchId is required" });
        return;
      }

      // Idempotency Key Handling
      const rawIdempKey =
        req.headers["idempotency-key"] ||
        req.headers["x-idempotency-key"] ||
        req.body?.idempotencyKey;
      const idempotencyKey = typeof rawIdempKey === "string" ? rawIdempKey.trim() : undefined;
      const cacheKey = idempotencyKey ? `${tenantId}:${idempotencyKey}` : null;

      if (cacheKey) {
        // 1. Check in-memory cache
        const cached = publicBookingIdempotencyCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT");
          res.status(cached.status).json(cached.body);
          return;
        }

        // 2. Check Database persistence
        try {
          const dbKey = await prisma.idempotencyKey.findUnique({
            where: { tenantId_key: { tenantId, key: idempotencyKey! } },
          });
          if (dbKey && dbKey.responseStatus && dbKey.responseBody && dbKey.expiresAt > new Date()) {
            publicBookingIdempotencyCache.set(cacheKey, {
              status: dbKey.responseStatus,
              body: dbKey.responseBody,
              expiresAt: dbKey.expiresAt.getTime(),
            });
            res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT");
            res.status(dbKey.responseStatus).json(dbKey.responseBody);
            return;
          }
        } catch {
          // Fall through if database idempotency query fails
        }

        // 3. Handle concurrent in-flight requests (e.g. rapid double-clicks on mobile)
        if (inFlightBookings.has(cacheKey)) {
          const inFlightResult = await inFlightBookings.get(cacheKey)!;
          res.setHeader("X-Cache-Lookup", "HIT-IDEMPOTENT-INFLIGHT");
          res.status(inFlightResult.status).json(inFlightResult.body);
          return;
        }
      }

      // Execute booking creation logic
      const executeBooking = async (): Promise<{ status: number; body: any }> => {
        // 1. Verify tenant exists and is active
        const tenant = await prisma.tenant.findFirst({
          where: { id: tenantId, status: "ACTIVE", deletedAt: null },
        });
        if (!tenant) {
          return {
            status: 404,
            body: { success: false, message: "Organization not found or inactive" },
          };
        }

        // 2. Verify branch belongs to this tenant and is active (prevents cross-tenant IDOR)
        const branch = await prisma.location.findFirst({
          where: { id: branchId, tenantId, status: "ACTIVE", deletedAt: null },
        });
        if (!branch) {
          return {
            status: 400,
            body: { success: false, message: "Invalid branch for this organization" },
          };
        }

        // 3. Verify service belongs to this tenant if provided
        let resolvedServiceId = serviceId;
        if (resolvedServiceId) {
          const service = await prisma.service.findFirst({
            where: { id: resolvedServiceId, tenantId, status: "ACTIVE", deletedAt: null },
          });
          if (!service) {
            return {
              status: 400,
              body: { success: false, message: "Invalid service for this organization" },
            };
          }
        } else {
          const firstService = await prisma.service.findFirst({
            where: { tenantId, status: "ACTIVE", deletedAt: null },
          });
          resolvedServiceId = firstService?.id || "";
        }

        // 4. Sanitize inputs to prevent Stored XSS
        const cleanCustomerName = sanitizeText(customerName, 60) || (req as any).user?.email || "Valued Customer";
        const cleanCustomerPhone = customerPhone ? sanitizeText(customerPhone, 20) : undefined;
        const cleanTimeSlot = sanitizeText(timeSlot, 30) || "Now";

        let queue = await prisma.queue.findFirst({
          where: { locationId: branchId, ...(resolvedServiceId ? { serviceId: resolvedServiceId } : {}) },
        });

        if (!queue) {
          queue = await prisma.queue.findFirst({
            where: { locationId: branchId },
          });
        }

        if (!queue && resolvedServiceId) {
          queue = await prisma.queue.create({
            data: {
              tenantId,
              locationId: branchId,
              serviceId: resolvedServiceId,
              name: `Queue-${branchId.substring(0, 6)}`,
              code: `Q-${branchId.substring(0, 6).toUpperCase()}`,
            },
          });
        }

        const nextTokenNum = (queue?.lastTokenNumber ?? 20) + 1;
        const prefix = queue?.tokenPrefix || "K0";
        const tokenStr = `${prefix}${String(nextTokenNum).padStart(2, "0")}`;

        if (queue) {
          await prisma.queue.update({
            where: { id: queue.id },
            data: { lastTokenNumber: nextTokenNum },
          });
        }

        const queueEntry = await prisma.queueEntry.create({
          data: {
            tenantId,
            locationId: branchId,
            queueId: queue?.id || "default-queue",
            serviceId: resolvedServiceId || queue?.serviceId || "default-service",
            tokenNumber: nextTokenNum,
            tokenLabel: tokenStr,
            status: "WAITING",
            source: "ONLINE",
            metadata: {
              customerName: cleanCustomerName,
              customerPhone: cleanCustomerPhone,
              timeSlot: cleanTimeSlot,
              bookedVia: "QueuePortal",
              idempotencyKey,
            },
          },
        });

        const responsePayload = {
          success: true,
          data: {
            id: queueEntry.id,
            tokenNumber: tokenStr,
            tokenLabel: tokenStr,
            status: queueEntry.status,
            queueId: queueEntry.queueId,
            locationId: branchId,
            serviceId: resolvedServiceId,
            timeSlot: cleanTimeSlot,
            createdAt: queueEntry.createdAt,
          },
        };

        // Cache idempotent response
        if (cacheKey && idempotencyKey) {
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          publicBookingIdempotencyCache.set(cacheKey, {
            status: 201,
            body: responsePayload,
            expiresAt: expiresAt.getTime(),
          });

          // Asynchronously persist to database idempotency table
          try {
            await prisma.idempotencyKey?.upsert?.({
              where: { tenantId_key: { tenantId, key: idempotencyKey } },
              create: {
                tenantId,
                key: idempotencyKey,
                scope: "PUBLIC_QUEUE_BOOKING",
                requestHash: crypto
                  .createHash("sha256")
                  .update(JSON.stringify(req.body || {}))
                  .digest("hex"),
                responseStatus: 201,
                responseBody: responsePayload,
                expiresAt,
              },
              update: {
                responseStatus: 201,
                responseBody: responsePayload,
              },
            });
          } catch {
            // Safe fallback if database idempotency table is unavailable
          }
        }

        return { status: 201, body: responsePayload };
      };

      if (cacheKey) {
        const promise = executeBooking().finally(() => {
          inFlightBookings.delete(cacheKey);
        });
        inFlightBookings.set(cacheKey, promise);
        const result = await promise;
        res.status(result.status).json(result.body);
      } else {
        const result = await executeBooking();
        res.status(result.status).json(result.body);
      }
    } catch (error) {
      next(error);
    }
  };

  return {
    register,
    verifyOtp,
    approve,
    reject,
    listPending,
    getById,
    getReviewLogs,
    listPublic,
    listTenantServices,
    listTenantBranches,
    bookPublicToken,
  };
};

export type OrganizationController = ReturnType<typeof createOrganizationController>;
export const OrganizationController = createOrganizationController;

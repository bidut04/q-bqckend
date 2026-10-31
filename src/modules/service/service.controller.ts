import { Request, Response, NextFunction } from "express";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";
import { getTenantDb } from "../../common/base.repository";
import { ServiceStatus } from "@prisma/client";

const formatServiceResponse = (s: any) => {
  const metadata = (s.priorityRules && typeof s.priorityRules === "object") ? s.priorityRules : {};
  return {
    id: s.id,
    name: s.name,
    code: s.code || `SRV-${s.id.slice(0, 4)}`,
    category: metadata.category || "General",
    durationMinutes: s.estimatedDurationSec ? Math.round(s.estimatedDurationSec / 60) : 15,
    price: metadata.price || "$0",
    totalBookingsThisMonth: s._count?.bookings ?? 0,
    growthRate: 0,
    status: s.status === "ACTIVE" ? "Active" : "Inactive",
    description: s.description || "",
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
};

export const createServiceController = () => {
  const getServices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);

      const services = await db.service.findMany({
        where: {
          tenantId: context.tenantId,
          deletedAt: null,
        },
        include: {
          _count: {
            select: { bookings: true },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const formatted = services.map(formatServiceResponse);
      res.status(200).json({ success: true, data: formatted });
    } catch (error) {
      next(error);
    }
  };

  const getServiceById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const service = await db.service.findFirst({
        where: {
          id,
          tenantId: context.tenantId,
          deletedAt: null,
        },
        include: {
          _count: {
            select: { bookings: true },
          },
        },
      });

      if (!service) {
        res.status(404).json({ success: false, code: "NOT_FOUND", message: `Service '${id}' not found` });
        return;
      }

      res.status(200).json({ success: true, data: formatServiceResponse(service) });
    } catch (error) {
      next(error);
    }
  };

  const createService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const { name, category, durationMinutes, price, status, description, code } = req.body;

      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "Service name is required" });
        return;
      }

      const created = await db.service.create({
        data: {
          tenantId: context.tenantId,
          name: name.trim(),
          code: code || `SRV-${Math.floor(100 + Math.random() * 900)}`,
          description: description || null,
          status: status === "Inactive" ? ServiceStatus.INACTIVE : ServiceStatus.ACTIVE,
          estimatedDurationSec: (Number(durationMinutes) || 15) * 60,
          priorityRules: {
            category: category || "General",
            price: price || "$0",
          },
        },
        include: {
          _count: {
            select: { bookings: true },
          },
        },
      });

      res.status(201).json({ success: true, data: formatServiceResponse(created) });
    } catch (error) {
      next(error);
    }
  };

  const updateService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { name, category, durationMinutes, price, status, description, code } = req.body;

      const existing = await db.service.findFirst({
        where: {
          id,
          tenantId: context.tenantId,
          deletedAt: null,
        },
      });

      if (!existing) {
        res.status(404).json({ success: false, code: "NOT_FOUND", message: `Service '${id}' not found` });
        return;
      }

      const existingRules = (existing.priorityRules && typeof existing.priorityRules === "object") ? existing.priorityRules : {};

      const updated = await db.service.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(status !== undefined ? { status: status === "Inactive" ? ServiceStatus.INACTIVE : ServiceStatus.ACTIVE } : {}),
          ...(durationMinutes !== undefined ? { estimatedDurationSec: (Number(durationMinutes) || 15) * 60 } : {}),
          priorityRules: {
            ...existingRules,
            ...(category !== undefined ? { category } : {}),
            ...(price !== undefined ? { price } : {}),
          },
        },
        include: {
          _count: {
            select: { bookings: true },
          },
        },
      });

      res.status(200).json({ success: true, data: formatServiceResponse(updated) });
    } catch (error) {
      next(error);
    }
  };

  const deleteService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const existing = await db.service.findFirst({
        where: {
          id,
          tenantId: context.tenantId,
          deletedAt: null,
        },
      });

      if (!existing) {
        res.status(404).json({ success: false, code: "NOT_FOUND", message: `Service '${id}' not found` });
        return;
      }

      await db.service.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: ServiceStatus.INACTIVE,
        },
      });

      res.status(200).json({ success: true, message: "Service deleted successfully", id });
    } catch (error) {
      next(error);
    }
  };

  return {
    getServices,
    getServiceById,
    createService,
    updateService,
    deleteService,
  };
};

export type ServiceController = ReturnType<typeof createServiceController>;


import { Request, Response, NextFunction } from "express";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";
import { getTenantDb } from "../../common/base.repository";
import { Prisma } from "@prisma/client";

export const createCategoryController = () => {
  const getCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);

      // 1. Fetch saved categories from tenant settings
      const setting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "categories",
          },
        },
      });

      let list: any[] = [];
      if (setting && Array.isArray(setting.value) && setting.value.length > 0) {
        list = [...(setting.value as any[])];
      }

      // 2. Fetch all active services to compute live service counts and discover active categories
      const activeServices = await db.service.findMany({
        where: {
          tenantId: context.tenantId,
          deletedAt: null,
        },
        select: {
          id: true,
          priorityRules: true,
        },
      });

      const serviceCountByCategory = new Map<string, number>();
      for (const s of activeServices) {
        const cat = (s.priorityRules as any)?.category || "General";
        const normalized = cat.trim().toLowerCase();
        serviceCountByCategory.set(normalized, (serviceCountByCategory.get(normalized) || 0) + 1);
      }

      // Update totalServices count for existing configured categories
      list = list.map((c) => {
        const count = serviceCountByCategory.get(c.name.trim().toLowerCase()) || 0;
        return {
          ...c,
          totalServices: count,
        };
      });

      // Include any active categories found in services that aren't yet in settings
      for (const s of activeServices) {
        const catName = ((s.priorityRules as any)?.category || "General").trim();
        const exists = list.some((c) => c.name.toLowerCase() === catName.toLowerCase());
        if (!exists) {
          list.push({
            id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            code: `CAT-${Math.floor(100 + Math.random() * 900)}`,
            name: catName,
            description: `Auto-cataloged category for active services`,
            status: "Active",
            color: "#3b82f6",
            totalServices: serviceCountByCategory.get(catName.toLowerCase()) || 1,
            createdAt: new Date().toISOString().split("T")[0],
          });
        }
      }

      res.status(200).json({ success: true, data: list });
    } catch (error) {
      next(error);
    }
  };

  const getCategoryById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const setting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "categories",
          },
        },
      });

      const list: any[] = setting && Array.isArray(setting.value) ? (setting.value as any[]) : [];
      const found = list.find(
        (c) => c.id === id || c.code === id || c.name?.toLowerCase() === id.toLowerCase()
      );

      if (!found) {
        // Also check if any service uses this category name
        const service = await db.service.findFirst({
          where: {
            tenantId: context.tenantId,
            deletedAt: null,
          },
        });

        if (service && (service.priorityRules as any)?.category?.toLowerCase() === id.toLowerCase()) {
          const generated = {
            id,
            code: `CAT-${Math.floor(100 + Math.random() * 900)}`,
            name: (service.priorityRules as any)?.category,
            description: "Service category",
            status: "Active",
            color: "#3b82f6",
            totalServices: 1,
            createdAt: new Date().toISOString().split("T")[0],
          };
          res.status(200).json({ success: true, data: generated });
          return;
        }

        res.status(404).json({ success: false, code: "NOT_FOUND", message: `Category '${id}' not found` });
        return;
      }

      res.status(200).json({ success: true, data: found });
    } catch (error) {
      next(error);
    }
  };

  const createCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const { code, name, description, status, color } = req.body;

      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ success: false, code: "VALIDATION_ERROR", message: "Category name is required" });
        return;
      }

      const newCategory = {
        id: `cat-${Date.now()}`,
        code: code || `CAT-${Math.floor(100 + Math.random() * 900)}`,
        name: name.trim(),
        description: description || "",
        status: status || "Active",
        color: color || "#3b82f6",
        totalServices: 0,
        createdAt: new Date().toISOString().split("T")[0],
      };

      const existingSetting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "categories",
          },
        },
      });

      let currentList: any[] = [];
      if (existingSetting && Array.isArray(existingSetting.value)) {
        currentList = [...(existingSetting.value as any[])];
      }

      currentList.push(newCategory);

      await db.tenantSetting.upsert({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "categories",
          },
        },
        create: {
          tenantId: context.tenantId,
          namespace: "categories",
          value: currentList as Prisma.InputJsonValue,
          updatedBy: context.userId,
        },
        update: {
          value: currentList as Prisma.InputJsonValue,
          updatedBy: context.userId,
          version: { increment: 1 },
        },
      });

      res.status(201).json({ success: true, data: newCategory });
    } catch (error) {
      next(error);
    }
  };

  const updateCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { code, name, description, status, color } = req.body;

      const setting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "categories",
          },
        },
      });

      let currentList: any[] = [];
      if (setting && Array.isArray(setting.value)) {
        currentList = [...(setting.value as any[])];
      }

      const index = currentList.findIndex((c) => c.id === id || c.code === id);
      if (index === -1) {
        res.status(404).json({ success: false, code: "NOT_FOUND", message: `Category '${id}' not found` });
        return;
      }

      const updated = {
        ...currentList[index],
        ...(code !== undefined ? { code } : {}),
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(color !== undefined ? { color } : {}),
      };

      currentList[index] = updated;

      await db.tenantSetting.upsert({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "categories",
          },
        },
        create: {
          tenantId: context.tenantId,
          namespace: "categories",
          value: currentList as Prisma.InputJsonValue,
          updatedBy: context.userId,
        },
        update: {
          value: currentList as Prisma.InputJsonValue,
          updatedBy: context.userId,
          version: { increment: 1 },
        },
      });

      res.status(200).json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  };

  const deleteCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const setting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "categories",
          },
        },
      });

      let currentList: any[] = [];
      if (setting && Array.isArray(setting.value)) {
        currentList = [...(setting.value as any[])];
      }

      const filtered = currentList.filter((c) => c.id !== id && c.code !== id);

      await db.tenantSetting.upsert({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "categories",
          },
        },
        create: {
          tenantId: context.tenantId,
          namespace: "categories",
          value: filtered as Prisma.InputJsonValue,
          updatedBy: context.userId,
        },
        update: {
          value: filtered as Prisma.InputJsonValue,
          updatedBy: context.userId,
          version: { increment: 1 },
        },
      });

      res.status(200).json({ success: true, message: "Category deleted successfully", id });
    } catch (error) {
      next(error);
    }
  };

  return {
    getCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
  };
};

export type CategoryController = ReturnType<typeof createCategoryController>;


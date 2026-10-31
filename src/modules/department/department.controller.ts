import { Request, Response, NextFunction } from "express";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";
import { getTenantDb } from "../../common/base.repository";
import { Prisma } from "@prisma/client";

export const createDepartmentController = () => {
  const getDepartments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);

      // 1. Fetch saved departments from tenant settings (real database)
      const setting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "departments",
          },
        },
      });

      let list: any[] = [];
      if (setting && Array.isArray(setting.value) && setting.value.length > 0) {
        list = [...(setting.value as any[])];
      }

      // 2. Fetch distinct departments actively assigned to employees in database
      const employeeDepts = await db.employee.findMany({
        where: {
          tenantId: context.tenantId,
          department: { not: null },
          deletedAt: null,
        },
        select: { department: true },
        distinct: ["department"],
      });

      for (const emp of employeeDepts) {
        if (emp.department && !list.some((d) => d.deptName?.toLowerCase() === emp.department!.toLowerCase())) {
          list.push({
            id: `dept-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            deptCode: `DEP-${Math.floor(200 + Math.random() * 800)}`,
            deptName: emp.department,
            headOfDept: null,
            branch: null,
            totalStaff: 1,
            activeCounters: 1,
            status: "Active",
            createdDate: new Date().toISOString().split("T")[0],
          });
        }
      }

      res.status(200).json({ success: true, data: list });
    } catch (error) {
      next(error);
    }
  };

  const createDepartment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const { deptCode, deptName, headOfDept, branch, status } = req.body;

      const newDept = {
        id: `dept-${Date.now()}`,
        deptCode: deptCode || `DEP-${Math.floor(100 + Math.random() * 900)}`,
        deptName: deptName || "New Department",
        headOfDept: headOfDept || null,
        branch: branch || null,
        totalStaff: 0,
        activeCounters: 0,
        status: status || "Active",
        createdDate: new Date().toISOString().split("T")[0],
      };

      const existingSetting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "departments",
          },
        },
      });

      let currentList: any[] = [];
      if (existingSetting && Array.isArray(existingSetting.value)) {
        currentList = [...(existingSetting.value as any[])];
      }

      currentList.push(newDept);

      await db.tenantSetting.upsert({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "departments",
          },
        },
        create: {
          tenantId: context.tenantId,
          namespace: "departments",
          value: currentList as Prisma.InputJsonValue,
          updatedBy: context.userId,
        },
        update: {
          value: currentList as Prisma.InputJsonValue,
          updatedBy: context.userId,
          version: { increment: 1 },
        },
      });

      res.status(201).json({ success: true, data: newDept });
    } catch (error) {
      next(error);
    }
  };

  const getDepartmentById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const setting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "departments",
          },
        },
      });

      const list: any[] = setting && Array.isArray(setting.value) && setting.value.length > 0
        ? (setting.value as any[])
        : [];

      const found = list.find((d) => d.id === id || d.deptCode === id || d.deptName?.toLowerCase() === id.toLowerCase());

      if (!found) {
        // Also check if an employee in the tenant has this department assigned in database
        const emp = await db.employee.findFirst({
          where: {
            tenantId: context.tenantId,
            department: id,
            deletedAt: null,
          },
          select: { department: true },
        });

        if (emp && emp.department) {
          const generated = {
            id,
            deptCode: `DEP-${Math.floor(200 + Math.random() * 800)}`,
            deptName: emp.department,
            headOfDept: null,
            branch: null,
            totalStaff: 1,
            activeCounters: 1,
            status: "Active",
            createdDate: new Date().toISOString().split("T")[0],
          };
          res.status(200).json({ success: true, data: generated });
          return;
        }

        res.status(404).json({ success: false, code: "RESOURCE_NOT_FOUND", message: `Department '${id}' not found` });
        return;
      }

      res.status(200).json({ success: true, data: found });
    } catch (error) {
      next(error);
    }
  };

  const updateDepartment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { deptCode, deptName, headOfDept, branch, status, totalStaff, activeCounters } = req.body;

      const setting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "departments",
          },
        },
      });

      let currentList: any[] = [];
      if (setting && Array.isArray(setting.value)) {
        currentList = [...(setting.value as any[])];
      }

      const index = currentList.findIndex((d) => d.id === id || d.deptCode === id);
      if (index === -1) {
        res.status(404).json({ success: false, code: "RESOURCE_NOT_FOUND", message: `Department '${id}' not found` });
        return;
      }

      const updated = {
        ...currentList[index],
        ...(deptCode !== undefined ? { deptCode } : {}),
        ...(deptName !== undefined ? { deptName } : {}),
        ...(headOfDept !== undefined ? { headOfDept } : {}),
        ...(branch !== undefined ? { branch } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(totalStaff !== undefined ? { totalStaff } : {}),
        ...(activeCounters !== undefined ? { activeCounters } : {}),
      };

      currentList[index] = updated;

      await db.tenantSetting.upsert({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "departments",
          },
        },
        create: {
          tenantId: context.tenantId,
          namespace: "departments",
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

  const deleteDepartment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const db = await getTenantDb(context);
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const setting = await db.tenantSetting.findUnique({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "departments",
          },
        },
      });

      let currentList: any[] = [];
      if (setting && Array.isArray(setting.value)) {
        currentList = [...(setting.value as any[])];
      }

      const filtered = currentList.filter((d) => d.id !== id && d.deptCode !== id);

      await db.tenantSetting.upsert({
        where: {
          tenantId_namespace: {
            tenantId: context.tenantId,
            namespace: "departments",
          },
        },
        create: {
          tenantId: context.tenantId,
          namespace: "departments",
          value: filtered as Prisma.InputJsonValue,
          updatedBy: context.userId,
        },
        update: {
          value: filtered as Prisma.InputJsonValue,
          updatedBy: context.userId,
          version: { increment: 1 },
        },
      });

      res.status(200).json({ success: true, message: "Department deleted successfully" });
    } catch (error) {
      next(error);
    }
  };

  return {
    getDepartments,
    getDepartmentById,
    createDepartment,
    updateDepartment,
    deleteDepartment,
  };
};

export type DepartmentController = ReturnType<typeof createDepartmentController>;

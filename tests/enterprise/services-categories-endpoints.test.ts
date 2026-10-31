import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServiceController } from '../../src/modules/service/service.controller';
import { createCategoryController } from '../../src/modules/category/category.controller';
import { ServiceStatus } from '@prisma/client';

// Mock in-memory stores for Vitest
const { serviceStore, tenantSettingStore, mockDb } = vi.hoisted(() => {
  const serviceStore = new Map<string, any>();
  const tenantSettingStore = new Map<string, any>();

  const mockDb: any = {
    service: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return Array.from(serviceStore.values()).filter((s) => {
          if (where.tenantId && s.tenantId !== where.tenantId) return false;
          if (where.deletedAt === null && s.deletedAt !== null) return false;
          return true;
        });
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        for (const s of serviceStore.values()) {
          if (where.tenantId && s.tenantId !== where.tenantId) continue;
          if (where.id && s.id !== where.id) continue;
          if (where.deletedAt === null && s.deletedAt !== null) continue;
          return s;
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const record = {
          id,
          tenantId: data.tenantId,
          name: data.name,
          code: data.code,
          description: data.description,
          status: data.status,
          estimatedDurationSec: data.estimatedDurationSec,
          priorityRules: data.priorityRules,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { bookings: 0 },
        };
        serviceStore.set(id, record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const existing = serviceStore.get(where.id);
        if (!existing) throw new Error('Service not found');
        const updated = {
          ...existing,
          ...data,
          updatedAt: new Date(),
        };
        serviceStore.set(where.id, updated);
        return updated;
      }),
    },
    tenantSetting: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = `${where.tenantId_namespace.tenantId}_${where.tenantId_namespace.namespace}`;
        return tenantSettingStore.get(key) || null;
      }),
      upsert: vi.fn().mockImplementation(async ({ where, create, update }: any) => {
        const key = `${where.tenantId_namespace.tenantId}_${where.tenantId_namespace.namespace}`;
        const existing = tenantSettingStore.get(key);
        const record = existing
          ? { ...existing, ...update, version: (existing.version || 1) + 1 }
          : { id: `setting-${Date.now()}`, ...create, version: 1 };
        tenantSettingStore.set(key, record);
        return record;
      }),
    },
  };

  return {
    serviceStore,
    tenantSettingStore,
    mockDb,
  };
});

// Mock base repository
vi.mock('../../src/common/base.repository', () => ({
  getTenantDb: vi.fn().mockImplementation(async () => mockDb),
}));

// Mock tenant context helper
vi.mock('../../src/core/tenant/tenant-context.helper', () => ({
  getTenantContextFromRequest: vi.fn().mockImplementation(() => ({
    tenantId: 'tenant_test_service_123',
    userId: 'user_admin_123',
    roleIds: ['TENANT_ADMIN'],
    permissions: ['SERVICE_READ', 'SERVICE_WRITE'],
    branchIds: [],
    sessionId: 'session_test',
    securityVersion: 1,
  })),
}));

describe('Enterprise Services & Categories Endpoints Test Suite', () => {
  beforeEach(() => {
    serviceStore.clear();
    tenantSettingStore.clear();
    vi.clearAllMocks();
  });

  describe('1. Services Endpoints (/api/v1/services)', () => {
    it('should create and retrieve a service from database without mock data', async () => {
      const controller = createServiceController();

      // 1. Create a service
      const createReq: any = {
        body: {
          name: 'General Consultation',
          code: 'SRV-101',
          category: 'Consultation',
          durationMinutes: 20,
          price: '$45',
          status: 'Active',
          description: 'Standard doctor consultation desk',
        },
      };

      let createStatus: number = 0;
      let createBody: any = null;
      const createRes: any = {
        status: (code: number) => {
          createStatus = code;
          return { json: (data: any) => { createBody = data; } };
        },
      };
      const next = vi.fn();

      await controller.createService(createReq, createRes, next);

      expect(createStatus).toBe(201);
      expect(createBody.success).toBe(true);
      expect(createBody.data.name).toBe('General Consultation');
      expect(createBody.data.category).toBe('Consultation');
      expect(createBody.data.durationMinutes).toBe(20);
      expect(createBody.data.price).toBe('$45');
      expect(createBody.data.status).toBe('Active');

      const createdId = createBody.data.id;

      // 2. Fetch list of services
      const listReq: any = {};
      let listStatus: number = 0;
      let listBody: any = null;
      const listRes: any = {
        status: (code: number) => {
          listStatus = code;
          return { json: (data: any) => { listBody = data; } };
        },
      };

      await controller.getServices(listReq, listRes, next);

      expect(listStatus).toBe(200);
      expect(listBody.success).toBe(true);
      expect(listBody.data.length).toBe(1);
      expect(listBody.data[0].id).toBe(createdId);

      // 3. Fetch single service by id
      const getReq: any = { params: { id: createdId } };
      let getStatus: number = 0;
      let getBody: any = null;
      const getRes: any = {
        status: (code: number) => {
          getStatus = code;
          return { json: (data: any) => { getBody = data; } };
        },
      };

      await controller.getServiceById(getReq, getRes, next);

      expect(getStatus).toBe(200);
      expect(getBody.success).toBe(true);
      expect(getBody.data.id).toBe(createdId);
      expect(getBody.data.name).toBe('General Consultation');

      // 4. Update service
      const updateReq: any = {
        params: { id: createdId },
        body: { price: '$55', durationMinutes: 30 },
      };
      let updateStatus: number = 0;
      let updateBody: any = null;
      const updateRes: any = {
        status: (code: number) => {
          updateStatus = code;
          return { json: (data: any) => { updateBody = data; } };
        },
      };

      await controller.updateService(updateReq, updateRes, next);

      expect(updateStatus).toBe(200);
      expect(updateBody.success).toBe(true);
      expect(updateBody.data.price).toBe('$55');
      expect(updateBody.data.durationMinutes).toBe(30);

      // 5. Delete service
      const deleteReq: any = { params: { id: createdId } };
      let deleteStatus: number = 0;
      let deleteBody: any = null;
      const deleteRes: any = {
        status: (code: number) => {
          deleteStatus = code;
          return { json: (data: any) => { deleteBody = data; } };
        },
      };

      await controller.deleteService(deleteReq, deleteRes, next);

      expect(deleteStatus).toBe(200);
      expect(deleteBody.success).toBe(true);

      // Service should now be soft deleted
      await controller.getServices(listReq, listRes, next);
      expect(listBody.data.length).toBe(0);
    });
  });

  describe('2. Categories Endpoints (/api/v1/categories)', () => {
    it('should create and retrieve categories and compute live service count dynamically', async () => {
      const categoryController = createCategoryController();
      const next = vi.fn();

      // 1. Create a category
      const createReq: any = {
        body: {
          code: 'CAT-MED',
          name: 'Medical & Healthcare',
          description: 'Clinical consultations and diagnostics',
          status: 'Active',
          color: '#10b981',
        },
      };

      let createStatus: number = 0;
      let createBody: any = null;
      const createRes: any = {
        status: (code: number) => {
          createStatus = code;
          return { json: (data: any) => { createBody = data; } };
        },
      };

      await categoryController.createCategory(createReq, createRes, next);

      expect(createStatus).toBe(201);
      expect(createBody.success).toBe(true);
      expect(createBody.data.name).toBe('Medical & Healthcare');
      expect(createBody.data.code).toBe('CAT-MED');
      expect(createBody.data.color).toBe('#10b981');

      const createdCatId = createBody.data.id;

      // Seed 2 active services belonging to this category in database
      serviceStore.set('srv-1', {
        id: 'srv-1',
        tenantId: 'tenant_test_service_123',
        name: 'General Practitioner',
        status: ServiceStatus.ACTIVE,
        priorityRules: { category: 'Medical & Healthcare' },
        deletedAt: null,
      });
      serviceStore.set('srv-2', {
        id: 'srv-2',
        tenantId: 'tenant_test_service_123',
        name: 'Blood Pressure & ECG',
        status: ServiceStatus.ACTIVE,
        priorityRules: { category: 'Medical & Healthcare' },
        deletedAt: null,
      });

      // 2. Fetch categories and verify totalServices is computed dynamically as 2
      const listReq: any = {};
      let listStatus: number = 0;
      let listBody: any = null;
      const listRes: any = {
        status: (code: number) => {
          listStatus = code;
          return { json: (data: any) => { listBody = data; } };
        },
      };

      await categoryController.getCategories(listReq, listRes, next);

      expect(listStatus).toBe(200);
      expect(listBody.success).toBe(true);
      const cat = listBody.data.find((c: any) => c.id === createdCatId);
      expect(cat).toBeDefined();
      expect(cat.totalServices).toBe(2);

      // 3. Update category
      const updateReq: any = {
        params: { id: createdCatId },
        body: { description: 'Updated clinical care description', color: '#6366f1' },
      };
      let updateStatus: number = 0;
      let updateBody: any = null;
      const updateRes: any = {
        status: (code: number) => {
          updateStatus = code;
          return { json: (data: any) => { updateBody = data; } };
        },
      };

      await categoryController.updateCategory(updateReq, updateRes, next);

      expect(updateStatus).toBe(200);
      expect(updateBody.success).toBe(true);
      expect(updateBody.data.color).toBe('#6366f1');
      expect(updateBody.data.description).toBe('Updated clinical care description');

      // 4. Delete category
      const deleteReq: any = { params: { id: createdCatId } };
      let deleteStatus: number = 0;
      let deleteBody: any = null;
      const deleteRes: any = {
        status: (code: number) => {
          deleteStatus = code;
          return { json: (data: any) => { deleteBody = data; } };
        },
      };

      await categoryController.deleteCategory(deleteReq, deleteRes, next);

      expect(deleteStatus).toBe(200);
      expect(deleteBody.success).toBe(true);
    });
  });
});


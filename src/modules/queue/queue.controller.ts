import { Request, Response, NextFunction } from "express";
import { QueueService } from "./queue.service";
import { QueueRepository } from "./queue.repository";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";

export const createQueueController = (deps: {
  queueService: QueueService;
  queueRepository: QueueRepository;
}) => {
  const getActiveByBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const branchId = req.params.branchId as string;
      const entries = await deps.queueRepository.findActiveByBranch(context, branchId);
      res.status(200).json({ success: true, data: entries });
    } catch (error) {
      next(error);
    }
  };

  const getEntryById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const entry = await deps.queueRepository.findEntryById(context, id);
      res.status(200).json({ success: true, data: entry });
    } catch (error) {
      next(error);
    }
  };

  const callEntry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const { counterId } = req.body;
      const result = await deps.queueService.callEntry(context, id, counterId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const startService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const result = await deps.queueService.startService(context, id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const completeService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const result = await deps.queueService.completeService(context, id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const markNoShow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const result = await deps.queueService.markNoShow(context, id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const cancelEntry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const { reason } = req.body;
      const result = await deps.queueService.cancelEntry(context, id, reason);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const requeueEntry = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const { bypassRules, reason } = req.body || {};
      const result = await deps.queueService.requeueEntry(context, id, {
        bypassRules: Boolean(bypassRules),
        reason,
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const getQueuePolicy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const queueId = req.params.queueId as string;
      const result = await deps.queueService.getQueuePolicy(context, queueId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  const updateQueuePolicy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const queueId = req.params.queueId as string;
      const result = await deps.queueService.updateQueuePolicy(context, queueId, req.body);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  return {
    getActiveByBranch,
    getEntryById,
    callEntry,
    startService,
    completeService,
    markNoShow,
    cancelEntry,
    requeueEntry,
    getQueuePolicy,
    updateQueuePolicy,
  };
};

export type QueueController = ReturnType<typeof createQueueController>;


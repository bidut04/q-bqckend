import { Request, Response, NextFunction } from "express";
import { BookingService } from "./booking.service";
import { BookingRepository } from "./booking.repository";
import { getTenantContextFromRequest } from "../../core/tenant/tenant-context.helper";

export const createBookingController = (deps: {
  bookingService: BookingService;
  bookingRepository: BookingRepository;
}) => {
  const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const result = await deps.bookingService.createBooking(context, req.body);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const result = await deps.bookingRepository.findById(context, req.params.id as string);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const getByBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const result = await deps.bookingRepository.findByBranch(context, req.params.branchId as string);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const checkIn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const result = await deps.bookingService.checkInBooking(context, id);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const { reason } = req.body || {};
      const result = await deps.bookingService.cancelBooking(context, id, reason);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const complete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = getTenantContextFromRequest(req);
      const id = req.params.id as string;
      const result = await deps.bookingService.completeBooking(context, id);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  return {
    create,
    getById,
    getByBranch,
    checkIn,
    cancel,
    complete,
  };
};

export type BookingController = ReturnType<typeof createBookingController>;


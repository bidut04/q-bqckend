import {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";

import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import jwt from "jsonwebtoken";

import { AppError } from "../lib/errors";
import { env } from "../config/env";

export const errorMiddleware: ErrorRequestHandler = (
  error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const isProduction = env.NODE_ENV === "production";

  // ---------------------------------------------
  // Log server-side
  // ---------------------------------------------
  console.error({
    message: error?.message,
    name: error?.name,
    method: req.method,
    path: req.originalUrl,
    stack: isProduction ? undefined : error?.stack,
  });

  // ---------------------------------------------
  // AppError
  // ---------------------------------------------
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
    return;
  }

  // ---------------------------------------------
  // Zod validation error
  // ---------------------------------------------
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Invalid request data",
      errors: error.flatten().fieldErrors,
    });
    return;
  }

  // ---------------------------------------------
  // Prisma known errors
  // ---------------------------------------------
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      res.status(409).json({
        success: false,
        code: "DUPLICATE_RESOURCE",
        message: "Resource already exists",
      });
      return;
    }

    if (error.code === "P2025") {
      res.status(404).json({
        success: false,
        code: "RESOURCE_NOT_FOUND",
        message: "Resource not found",
      });
      return;
    }
  }

  // ---------------------------------------------
  // JWT errors
  // ---------------------------------------------
  if (error instanceof jwt.TokenExpiredError) {
    res.status(401).json({
      success: false,
      code: "TOKEN_EXPIRED",
      message: "Access token expired",
    });
    return;
  }

  if (error instanceof jwt.JsonWebTokenError) {
    console.warn("[JWT Error]:", error.name, error.message);
    res.status(401).json({
      success: false,
      code: "INVALID_TOKEN",
      message: "Invalid access token",
      details: isProduction ? undefined : error.message,
    });
    return;
  }

  // ---------------------------------------------
  // Unknown error
  // ---------------------------------------------
  res.status(500).json({
    success: false,
    code: "INTERNAL_SERVER_ERROR",
    message: isProduction
      ? "Internal server error"
      : error?.message ?? "Internal server error",
  });
};

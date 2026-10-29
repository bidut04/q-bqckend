import { Request, Response, NextFunction } from "express";
import {
  generateTraceId,
  generateSpanId,
  formatTraceparent,
  parseTraceparent,
  runWithTraceContext,
  TraceContext,
} from "./tracer";

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      spanId?: string;
      parentSpanId?: string;
    }
  }
}

/**
 * OpenTelemetry HTTP Tracing Middleware
 * - Extracts or initializes W3C Trace Context (traceparent / X-Trace-ID)
 * - Binds TraceContext into AsyncLocalStorage for downstream services, workers & emitters
 * - Emits latency telemetry for Jaeger / Datadog
 */
export const tracingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const rawTraceparent = req.header("traceparent");
  const rawTraceId = req.header("x-trace-id") || req.header("x-request-id");

  const parsed = parseTraceparent(rawTraceparent);

  const traceId = parsed?.traceId || (rawTraceId && /^[a-f0-9]{32}$/i.test(rawTraceId) ? rawTraceId.toLowerCase() : generateTraceId());
  const parentSpanId = parsed?.parentSpanId;
  const spanId = generateSpanId();
  const traceFlags = parsed?.traceFlags || "01";
  const startTime = Date.now();

  const context: TraceContext = {
    traceId,
    spanId,
    parentSpanId,
    traceFlags,
    startTime,
    metadata: {
      method: req.method,
      path: req.path,
    },
  };

  req.traceId = traceId;
  req.spanId = spanId;
  req.parentSpanId = parentSpanId;

  // Propagate trace headers on the response
  res.setHeader("traceparent", formatTraceparent(traceId, spanId, traceFlags === "01"));
  res.setHeader("X-Trace-ID", traceId);

  // Measure response duration & log structured telemetry
  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    if (process.env.NODE_ENV !== "test") {
      console.log(JSON.stringify({
        telemetry: "http_trace",
        traceId,
        spanId,
        parentSpanId,
        method: req.method,
        path: req.originalUrl || req.path,
        statusCode: res.statusCode,
        durationMs,
        timestamp: new Date().toISOString(),
      }));
    }
  });

  runWithTraceContext(context, () => {
    next();
  });
};

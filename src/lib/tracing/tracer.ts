import crypto from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly traceFlags: string;
  readonly startTime: number;
  readonly metadata?: Record<string, unknown>;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTime: number;
  finish: (attributes?: Record<string, unknown>) => SpanResult;
}

export interface SpanResult {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly durationMs: number;
  readonly status: "OK" | "ERROR";
  readonly attributes: Record<string, unknown>;
}

const traceAsyncLocalStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Generates a 32-character hex trace ID (16 bytes, 128-bit) compliant with W3C Trace Context
 */
export const generateTraceId = (): string => {
  return crypto.randomBytes(16).toString("hex");
};

/**
 * Generates a 16-character hex span ID (8 bytes, 64-bit) compliant with W3C Trace Context
 */
export const generateSpanId = (): string => {
  return crypto.randomBytes(8).toString("hex");
};

/**
 * Formats a W3C traceparent header string: `00-${traceId}-${spanId}-${flags}`
 */
export const formatTraceparent = (
  traceId: string,
  spanId: string,
  sampled = true
): string => {
  const flags = sampled ? "01" : "00";
  return `00-${traceId}-${spanId}-${flags}`;
};

/**
 * Parses a standard W3C traceparent header: `00-${traceId}-${spanId}-${flags}`
 */
export const parseTraceparent = (
  traceparent?: string | null
): { traceId: string; parentSpanId: string; traceFlags: string } | null => {
  if (!traceparent || typeof traceparent !== "string") {
    return null;
  }

  const parts = traceparent.trim().split("-");
  if (parts.length === 4 && parts[0] === "00" && parts[1].length === 32 && parts[2].length === 16) {
    return {
      traceId: parts[1].toLowerCase(),
      parentSpanId: parts[2].toLowerCase(),
      traceFlags: parts[3],
    };
  }

  return null;
};

/**
 * Runs an asynchronous execution within an active TraceContext
 */
export const runWithTraceContext = <R>(
  context: TraceContext,
  fn: () => Promise<R> | R
): Promise<R> | R => {
  return traceAsyncLocalStorage.run(Object.freeze(context), fn);
};

/**
 * Retrieves the currently active TraceContext
 */
export const getActiveTraceContext = (): TraceContext | undefined => {
  return traceAsyncLocalStorage.getStore();
};

/**
 * Injects W3
 * C trace context headers into an outgoing HTTP or event headers object
 */
export const injectTraceHeaders = (
  target: Record<string, string> = {}
): Record<string, string> => {
  const current = getActiveTraceContext();
  if (current) {
    target["traceparent"] = formatTraceparent(current.traceId, current.spanId, current.traceFlags === "01");
    target["x-trace-id"] = current.traceId;
  }
  return target;
};

/**
 * Starts a new logical child span and returns a finisher callback
 */
export const startSpan = (name: string, attributes?: Record<string, unknown>): Span => {
  const current = getActiveTraceContext();
  const traceId = current?.traceId || generateTraceId();
  const parentSpanId = current?.spanId;
  const spanId = generateSpanId();
  const startTime = Date.now();

  return {
    traceId,
    spanId,
    parentSpanId,
    name,
    startTime,
    finish: (attrs = {}) => {
      const durationMs = Date.now() - startTime;
      const combinedAttrs = { ...(attributes || {}), ...attrs };
      const status: "OK" | "ERROR" = combinedAttrs.error ? "ERROR" : "OK";

      const result: SpanResult = {
        traceId,
        spanId,
        parentSpanId,
        name,
        durationMs,
        status,
        attributes: combinedAttrs,
      };

      // Structured OpenTelemetry / Datadog JSON log format
      if (process.env.NODE_ENV !== "test") {
        console.log(JSON.stringify({
          telemetry: "trace_span",
          ...result,
          timestamp: new Date().toISOString(),
        }));
      }

      return result;
    },
  };
};

/**
 * Wraps an async function execution with an active OpenTelemetry span
 */
export const withSpan = async <R>(
  name: string,
  fn: (span: Span) => Promise<R> | R,
  attributes?: Record<string, unknown>
): Promise<R> => {
  const span = startSpan(name, attributes);
  const childContext: TraceContext = {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    traceFlags: "01",
    startTime: span.startTime,
    metadata: attributes,
  };

  try {
    const result = await runWithTraceContext(childContext, () => fn(span));
    span.finish();
    return result;
  } catch (error: any) {
    span.finish({ error: error?.message || String(error) });
    throw error;
  }
};

export const tracer = {
  generateTraceId,
  generateSpanId,
  formatTraceparent,
  parseTraceparent,
  runWithTraceContext,
  getActiveTraceContext,
  injectTraceHeaders,
  startSpan,
  withSpan,
};

export type Tracer = typeof tracer;

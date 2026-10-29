import { getActiveTraceContext, formatTraceparent } from "../tracing/tracer";

export interface KafkaEventEnvelope<T = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly branchId?: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly traceparent?: string;
  readonly payload: T;
}

export const createKafkaEnvelope = <T>(
  tenantId: string,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: T,
  meta?: {
    branchId?: string;
    correlationId?: string;
    causationId?: string;
    traceId?: string;
    spanId?: string;
    traceparent?: string;
  }
): KafkaEventEnvelope<T> => {
  const activeTrace = getActiveTraceContext();
  const traceId = meta?.traceId || activeTrace?.traceId;
  const spanId = meta?.spanId || activeTrace?.spanId;
  const traceparent =
    meta?.traceparent ||
    (traceId && spanId ? formatTraceparent(traceId, spanId) : undefined);

  return {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    eventType,
    tenantId,
    branchId: meta?.branchId,
    aggregateId,
    aggregateType,
    occurredAt: new Date().toISOString(),
    correlationId: meta?.correlationId || `corr_${Date.now()}`,
    causationId: meta?.causationId,
    traceId,
    spanId,
    traceparent,
    payload,
  };
};

export const KafkaEventFactory = {
  createEnvelope: createKafkaEnvelope,
};



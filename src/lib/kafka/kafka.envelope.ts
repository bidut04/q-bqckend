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
  readonly payload: T;
}

export class KafkaEventFactory {
  public static createEnvelope<T>(
    tenantId: string,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: T,
    meta?: { branchId?: string; correlationId?: string; causationId?: string }
  ): KafkaEventEnvelope<T> {
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
      payload,
    };
  }
}

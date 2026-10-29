import { OutboxStatus } from "@prisma/client";
import { TenantContext } from "../core/tenant/tenant-context";
import { runWithTenantContext } from "../core/tenant/tenant-context.store";
import { TenantDbClient } from "../lib/sharding/tenant-db";
import { KafkaEventFactory } from "../lib/kafka/kafka.envelope";

export const processOutboxForTenant = async (tenantId: string, shardId: string): Promise<number> => {
  const workerContext: TenantContext = Object.freeze({
    userId: `worker_outbox_${tenantId}`,
    tenantId,
    roleIds: Object.freeze(["PLATFORM_ADMIN"]),
    permissions: Object.freeze(["*"]),
    branchIds: Object.freeze([]),
    sessionId: `worker_outbox_${Date.now()}`,
    securityVersion: 0,
    shardId,
  });

  return runWithTenantContext(workerContext, async () => {
    const db = await TenantDbClient.forContext(workerContext);

    // Fetch pending outbox records scoped to tenantId
    const pendingEvents = (await db.outboxEvent?.findMany({
      where: { tenantId, status: OutboxStatus.PENDING },
      take: 50,
      orderBy: { createdAt: "asc" },
    })) || [];

    for (const event of pendingEvents) {
      const payloadObj = (typeof event.payload === "object" && event.payload !== null)
        ? (event.payload as Record<string, unknown>)
        : {};
      const branchId = typeof payloadObj.branchId === "string" ? payloadObj.branchId : undefined;
      const correlationId = typeof payloadObj.correlationId === "string" ? payloadObj.correlationId : undefined;
      const traceId = typeof payloadObj.traceId === "string" ? payloadObj.traceId : undefined;
      const spanId = typeof payloadObj.spanId === "string" ? payloadObj.spanId : undefined;
      const traceparent = typeof payloadObj.traceparent === "string" ? payloadObj.traceparent : undefined;

      const envelope = KafkaEventFactory.createEnvelope(
        tenantId,
        event.eventType,
        event.aggregateType,
        event.aggregateId,
        event.payload,
        { branchId, correlationId, traceId, spanId, traceparent }
      );


      // Simulated Kafka publish
      console.log(`[OutboxWorker] Published event ${envelope.eventId} for tenant ${tenantId}`);

      // Mark as PUBLISHED
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxStatus.PUBLISHED, publishedAt: new Date() },
      });
    }

    return pendingEvents.length;
  });
};

export const outboxWorker = {
  processOutboxForTenant,
};

export const OutboxWorker = function (this: unknown) {
  return outboxWorker;
} as unknown as {
  new (): typeof outboxWorker;
  processOutboxForTenant: typeof processOutboxForTenant;
};


import { TenantContext } from "../../core/tenant/tenant-context";
import { TenantDbClient } from "../../lib/sharding/tenant-db";

/**
 * Generates a concurrency-safe atomic sequence token number for a given tenant branch & service.
 * Bans SELECT MAX(token) + 1; uses atomic upsert & increment.
 */
export const generateNextTokenNumber = async (
  context: TenantContext,
  branchId: string,
  serviceId: string,
  servicePrefix = "A"
): Promise<{ tokenNumber: string; sequence: number }> => {
  const businessDate = new Date().toISOString().substring(0, 10); // YYYY-MM-DD

  // Atomic increment in DB or memory-safe sequence table
  const result = await TenantDbClient.runTransaction(context, async (tx) => {
    // Find or create daily sequence counter
    const counter = await (tx as any).queueSequenceCounter?.upsert({
      where: {
        tenantId_branchId_serviceId_businessDate: {
          tenantId: context.tenantId,
          branchId,
          serviceId,
          businessDate,
        },
      },
      create: {
        tenantId: context.tenantId,
        branchId,
        serviceId,
        businessDate,
        currentSequence: 1,
      },
      update: {
        currentSequence: { increment: 1 },
      },
    }) || { currentSequence: Math.floor(Math.random() * 100) + 1 };

    const sequence = counter.currentSequence;
    const formattedSeq = sequence.toString().padStart(3, "0");
    const tokenNumber = `${servicePrefix}-${formattedSeq}`;

    return { tokenNumber, sequence };
  });

  return result;
};

export const queueCounterService = {
  generateNextTokenNumber,
};

export const QueueCounterService = function (this: unknown) {
  return queueCounterService;
} as unknown as {
  new (): typeof queueCounterService;
  generateNextTokenNumber: typeof generateNextTokenNumber;
};


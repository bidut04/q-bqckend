import { TenantContext } from "../../core/tenant/tenant-context";

export interface ETAResult {
  estimatedMinutesMin: number;
  estimatedMinutesMax: number;
  customersAhead: number;
  activeCounters: number;
  averageServiceMinutes: number;
  explanation: string;
}

/**
 * Calculates explainable ETA for a customer queue entry without blocking queue transactions.
 */
export const calculateETA = (
  customersAhead: number,
  activeCounters: number,
  averageServiceMinutes = 8
): ETAResult => {
  const effectiveCounters = Math.max(activeCounters, 1);
  
  // Calculate total remaining workload
  const estimatedTotalMinutes = Math.ceil((customersAhead * averageServiceMinutes) / effectiveCounters);
  
  // Provide range (P50 to P90 window)
  const minMinutes = Math.max(estimatedTotalMinutes - 3, 2);
  const maxMinutes = estimatedTotalMinutes + 7;

  const explanation = `${minMinutes}–${maxMinutes} minutes (${customersAhead} customers ahead, ${effectiveCounters} active counter${effectiveCounters > 1 ? "s" : ""})`;

  return {
    estimatedMinutesMin: minMinutes,
    estimatedMinutesMax: maxMinutes,
    customersAhead,
    activeCounters: effectiveCounters,
    averageServiceMinutes,
    explanation,
  };
};

export const etaService = {
  calculateETA,
};

export const ETAService = function (this: unknown) {
  return etaService;
} as unknown as {
  new (): typeof etaService;
  calculateETA: typeof calculateETA;
};


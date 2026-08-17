export type EtaEstimate = {
  estimatedArrivalAt: Date | null;
  effectiveSpeedKmh: number | null;
  delayMinutes: number | null;
  confidence: "none" | "low" | "medium";
  source: "unavailable" | "baseline-model" | "route-history" | "observed-pace";
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function estimateArrival(input: {
  remainingDistanceKm: number | null;
  completedDistanceKm: number | null;
  departedAt: Date | null;
  lastPositionAt: Date | null;
  plannedArrivalAt: Date | null;
  delivered?: boolean;
  futureServiceMinutes?: number;
  historicalEffectiveSpeedKmh?: number | null;
  historicalTripCount?: number;
}): EtaEstimate {
  const { remainingDistanceKm, completedDistanceKm, departedAt, lastPositionAt, plannedArrivalAt } = input;
  if (remainingDistanceKm === null || lastPositionAt === null) {
    return { estimatedArrivalAt: null, effectiveSpeedKmh: null, delayMinutes: null, confidence: "none", source: "unavailable" };
  }

  if (input.delivered || remainingDistanceKm <= 0.5) {
    const delayMinutes = plannedArrivalAt ? Math.round((lastPositionAt.getTime() - plannedArrivalAt.getTime()) / 60_000) : null;
    return { estimatedArrivalAt: lastPositionAt, effectiveSpeedKmh: null, delayMinutes, confidence: "medium", source: "observed-pace" };
  }

  const historicalSpeed = typeof input.historicalEffectiveSpeedKmh === "number" && Number.isFinite(input.historicalEffectiveSpeedKmh)
    ? clamp(input.historicalEffectiveSpeedKmh, 25, 85)
    : null;
  let effectiveSpeedKmh = historicalSpeed ?? 55;
  let confidence: EtaEstimate["confidence"] = historicalSpeed !== null && (input.historicalTripCount ?? 0) >= 5 ? "medium" : "low";
  let source: EtaEstimate["source"] = historicalSpeed !== null ? "route-history" : "baseline-model";

  if (departedAt && completedDistanceKm !== null && completedDistanceKm >= 100) {
    const elapsedHours = (lastPositionAt.getTime() - departedAt.getTime()) / 3_600_000;
    if (elapsedHours >= 2) {
      effectiveSpeedKmh = clamp(completedDistanceKm / elapsedHours, 25, 85);
      confidence = "medium";
      source = "observed-pace";
    }
  }

  const serviceMinutes = clamp(input.futureServiceMinutes ?? 0, 0, 24 * 60);
  const hoursRemaining = remainingDistanceKm / effectiveSpeedKmh;
  const estimatedArrivalAt = new Date(lastPositionAt.getTime() + hoursRemaining * 3_600_000 + serviceMinutes * 60_000);
  const delayMinutes = plannedArrivalAt ? Math.round((estimatedArrivalAt.getTime() - plannedArrivalAt.getTime()) / 60_000) : null;

  return { estimatedArrivalAt, effectiveSpeedKmh, delayMinutes, confidence, source };
}

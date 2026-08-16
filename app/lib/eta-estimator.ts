export type EtaEstimate = {
  estimatedArrivalAt: Date | null;
  effectiveSpeedKmh: number | null;
  delayMinutes: number | null;
  confidence: "none" | "low" | "medium";
  source: "unavailable" | "baseline-model" | "observed-pace";
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
}): EtaEstimate {
  const { remainingDistanceKm, completedDistanceKm, departedAt, lastPositionAt, plannedArrivalAt } = input;
  if (remainingDistanceKm === null || lastPositionAt === null) {
    return { estimatedArrivalAt: null, effectiveSpeedKmh: null, delayMinutes: null, confidence: "none", source: "unavailable" };
  }

  if (input.delivered || remainingDistanceKm <= 0.5) {
    const delayMinutes = plannedArrivalAt ? Math.round((lastPositionAt.getTime() - plannedArrivalAt.getTime()) / 60_000) : null;
    return { estimatedArrivalAt: lastPositionAt, effectiveSpeedKmh: null, delayMinutes, confidence: "medium", source: "observed-pace" };
  }

  let effectiveSpeedKmh = 55;
  let confidence: EtaEstimate["confidence"] = "low";
  let source: EtaEstimate["source"] = "baseline-model";

  if (departedAt && completedDistanceKm !== null && completedDistanceKm >= 100) {
    const elapsedHours = (lastPositionAt.getTime() - departedAt.getTime()) / 3_600_000;
    if (elapsedHours >= 2) {
      // Effective pace deliberately includes real stops/delays. Clamp extreme GPS
      // or event timing values so one bad fix cannot create an absurd ETA.
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

import type { DeliveryEventRow, DeliveryRow } from "./delivery-store.types";
import { shouldDetectDelay } from "./delay-detection";
import { estimateArrival } from "./eta-estimator";
import { calculateRouteMetrics, rebaseRouteMetrics } from "./route-progress";

function explicitDestination(row: DeliveryRow): [number, number] | null {
  return typeof row.destinationLatitude === "number" && typeof row.destinationLongitude === "number"
    ? [row.destinationLongitude, row.destinationLatitude]
    : null;
}

export function shouldCreateDelayEvent(row: DeliveryRow, events: DeliveryEventRow[]) {
  if (row.status === "Delivered" || events.some((event) => event.type === "DELAY_DETECTED")) return false;
  if (typeof row.latitude !== "number" || typeof row.longitude !== "number" || !row.lastPositionAt) return false;

  const baselineProgress = events.find((event) => event.type === "GPS_BASELINE")?.progress ?? 0;
  const absoluteMetrics = calculateRouteMetrics(
    row.latitude,
    row.longitude,
    row.destination,
    explicitDestination(row),
  );
  const metrics = rebaseRouteMetrics(absoluteMetrics, baselineProgress);
  const departedAt = events.find((event) => event.type === "DEPARTED")?.createdAt ?? null;
  const eta = estimateArrival({
    remainingDistanceKm: metrics.remainingDistanceKm,
    completedDistanceKm: metrics.completedDistanceKm,
    departedAt,
    lastPositionAt: row.lastPositionAt,
    plannedArrivalAt: row.plannedArrivalAt,
    delivered: false,
  });

  return shouldDetectDelay({
    eta,
    delivered: false,
    alreadyDetected: false,
  });
}

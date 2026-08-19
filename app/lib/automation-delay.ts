import type { DeliveryEventRow, DeliveryRow } from "./delivery-store.types.ts";
import { shouldDetectDelay } from "./delay-detection.ts";
import { estimateArrival } from "./eta-estimator.ts";
import { calculateRouteMetrics, rebaseRouteMetrics } from "./route-progress.ts";
import { pendingServiceMinutesBefore } from "./truck-stop-plan.ts";

function explicitDestination(row: DeliveryRow): [number, number] | null {
  return typeof row.destinationLatitude === "number" && typeof row.destinationLongitude === "number"
    ? [row.destinationLongitude, row.destinationLatitude]
    : null;
}
function explicitOrigin(row: DeliveryRow): [number, number] | null {
  return typeof row.originLatitude === "number" && typeof row.originLongitude === "number"
    ? [row.originLongitude, row.originLatitude]
    : null;
}

export function shouldCreateDelayEvent(row: DeliveryRow, events: DeliveryEventRow[], companyDeliveries: DeliveryRow[] = [row]) {
  if (
    row.status === "Delivered"
    || events.some((event) => event.type === "DELAY_DETECTED" || event.type === "ARRIVED_AT_SITE")
  ) return false;
  if (typeof row.latitude !== "number" || typeof row.longitude !== "number" || !row.lastPositionAt) return false;

  const origin = explicitOrigin(row);
  const baselineProgress = origin ? 0 : (events.find((event) => event.type === "GPS_BASELINE")?.progress ?? 0);
  const absoluteMetrics = calculateRouteMetrics(
    row.latitude,
    row.longitude,
    row.destination,
    explicitDestination(row),
    origin,
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
    futureServiceMinutes: pendingServiceMinutesBefore(row, companyDeliveries),
  });

  return shouldDetectDelay({
    eta,
    delivered: false,
    alreadyDetected: false,
  });
}

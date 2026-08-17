import type { DeliveryEventRow, DeliveryRow, EtaObservationInput } from "./delivery-store.types.ts";
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

export function buildEtaObservation(
  row: DeliveryRow,
  events: DeliveryEventRow[],
  companyDeliveries: DeliveryRow[] = [row],
): EtaObservationInput | null {
  if (row.gpsSource !== "sendatrack" || typeof row.latitude !== "number" || typeof row.longitude !== "number" || !row.lastPositionAt) return null;

  const origin = explicitOrigin(row);
  const baselineProgress = origin ? 0 : (events.find((event) => event.type === "GPS_BASELINE")?.progress ?? 0);
  const absoluteMetrics = calculateRouteMetrics(row.latitude, row.longitude, row.destination, explicitDestination(row), origin);
  const metrics = rebaseRouteMetrics(absoluteMetrics, baselineProgress);
  const departedAt = events.find((event) => event.type === "DEPARTED")?.createdAt ?? null;
  const eta = estimateArrival({
    remainingDistanceKm: metrics.remainingDistanceKm,
    completedDistanceKm: metrics.completedDistanceKm,
    departedAt,
    lastPositionAt: row.lastPositionAt,
    plannedArrivalAt: row.plannedArrivalAt,
    delivered: row.status === "Delivered",
    futureServiceMinutes: pendingServiceMinutesBefore(row, companyDeliveries),
  });

  if (!eta.estimatedArrivalAt) return null;
  return {
    deliveryId: row.id,
    positionAt: row.lastPositionAt,
    estimatedArrivalAt: eta.estimatedArrivalAt,
    plannedArrivalAt: row.plannedArrivalAt,
    delayMinutes: eta.delayMinutes,
    effectiveSpeedKmh: eta.effectiveSpeedKmh,
    remainingDistanceKm: metrics.remainingDistanceKm,
    progress: row.progress,
    confidence: eta.confidence,
    source: eta.source,
  };
}

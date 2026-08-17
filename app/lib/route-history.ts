import type { DeliveryEventRow, DeliveryRow, EtaObservationRow } from "./delivery-store.types.ts";
import type { TruckStopPlan } from "./truck-stop-plan.ts";
import { buildTruckStopPlans } from "./truck-stop-plan.ts";

export type EtaRouteContext = {
  routeTemplateId: string;
  tripInstanceId: string;
  destinationSiteId: string;
};

export type RouteHistoryStats = {
  tripCount: number;
  medianEffectiveSpeedKmh: number | null;
  medianDelayMinutes: number | null;
  usableEffectiveSpeedKmh: number | null;
};

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function validDateValue(value: Date | null) {
  return value && Number.isFinite(value.getTime()) ? value.getTime() : null;
}

export function routeTripInstanceId(plan: TruckStopPlan, deliveries: DeliveryRow[]) {
  const ids = new Set(plan.stops.flatMap((stop) => stop.deliveryIds));
  const rows = deliveries.filter((delivery) => ids.has(delivery.id));
  const plannedAnchors = plan.stops.map((stop) => validDateValue(stop.plannedArrivalAt)).filter((value): value is number => value !== null);
  const createdAnchors = rows.map((row) => row.createdAt.getTime()).filter(Number.isFinite);
  const anchor = plannedAnchors.length ? Math.min(...plannedAnchors) : createdAnchors.length ? Math.min(...createdAnchors) : 0;
  return `TRIP-${hashString(`${plan.routeTemplateId}|${plan.vehicleKey}|${anchor}`)}`;
}

export function buildEtaRouteContexts(deliveries: DeliveryRow[], plans = buildTruckStopPlans(deliveries)) {
  const contexts = new Map<string, EtaRouteContext>();
  for (const plan of plans) {
    const tripInstanceId = routeTripInstanceId(plan, deliveries);
    for (const stop of plan.stops) {
      for (const deliveryId of stop.deliveryIds) {
        contexts.set(deliveryId, {
          routeTemplateId: plan.routeTemplateId,
          tripInstanceId,
          destinationSiteId: stop.siteId,
        });
      }
    }
  }
  return contexts;
}

export function stableEtaRouteContext(
  computed: EtaRouteContext | null,
  observations: EtaObservationRow[],
  events: DeliveryEventRow[],
): EtaRouteContext | null {
  const departedAt = events.find((event) => event.type === "DEPARTED")?.createdAt ?? null;
  if (!departedAt) return computed;

  const frozen = observations
    .filter((observation) =>
      observation.routeTemplateId &&
      observation.tripInstanceId &&
      observation.destinationSiteId &&
      observation.positionAt.getTime() >= departedAt.getTime()
    )
    .sort((a, b) => a.positionAt.getTime() - b.positionAt.getTime())[0];

  if (!frozen?.routeTemplateId || !frozen.tripInstanceId || !frozen.destinationSiteId) return computed;
  return {
    routeTemplateId: frozen.routeTemplateId,
    tripInstanceId: frozen.tripInstanceId,
    destinationSiteId: frozen.destinationSiteId,
  };
}

export function summarizeRouteHistory(observations: EtaObservationRow[], minimumTrips = 5, excludeTripInstanceId: string | null = null): RouteHistoryStats {
  const byTrip = new Map<string, EtaObservationRow[]>();
  for (const observation of observations) {
    if (!observation.tripInstanceId || observation.tripInstanceId === excludeTripInstanceId) continue;
    const rows = byTrip.get(observation.tripInstanceId) ?? [];
    rows.push(observation);
    byTrip.set(observation.tripInstanceId, rows);
  }

  const tripSpeeds: number[] = [];
  const tripDelays: number[] = [];
  for (const rows of byTrip.values()) {
    const speeds = rows
      .filter((row) => row.source === "observed-pace" && typeof row.effectiveSpeedKmh === "number" && Number.isFinite(row.effectiveSpeedKmh))
      .map((row) => row.effectiveSpeedKmh as number);
    const speed = median(speeds);
    if (speed !== null) tripSpeeds.push(speed);

    const withDelay = rows
      .filter((row) => typeof row.delayMinutes === "number" && Number.isFinite(row.delayMinutes))
      .sort((a, b) => b.positionAt.getTime() - a.positionAt.getTime());
    if (withDelay[0]?.delayMinutes !== null && withDelay[0]?.delayMinutes !== undefined) tripDelays.push(withDelay[0].delayMinutes);
  }

  const medianEffectiveSpeedKmh = median(tripSpeeds);
  const tripCount = tripSpeeds.length;
  return {
    tripCount,
    medianEffectiveSpeedKmh,
    medianDelayMinutes: median(tripDelays),
    usableEffectiveSpeedKmh: tripCount >= minimumTrips ? medianEffectiveSpeedKmh : null,
  };
}

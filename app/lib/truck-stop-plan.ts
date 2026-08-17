import type { DeliveryRow } from "./delivery-store.types";
import { routeOriginSiteId, routeTemplateId } from "./route-template.ts";
import { isUnassignedVehicle } from "./delivery-vehicle-choice.ts";

export type TruckStop = {
  siteId: string;
  destination: string;
  plannedArrivalAt: Date | null;
  deliveryIds: string[];
  customers: string[];
};

export type TruckStopPlan = {
  vehicleKey: string;
  truck: string;
  sendatrackVehicleId: string;
  routeTemplateId: string;
  tripId: string | null;
  originSiteId: string | null;
  source: "planned-arrival";
  stops: TruckStop[];
};

function timeValue(value: Date | null) {
  return value && Number.isFinite(value.getTime()) ? value.getTime() : Number.POSITIVE_INFINITY;
}

function vehicleKey(delivery: DeliveryRow) {
  return delivery.sendatrackVehicleId || delivery.truck;
}

export function configuredStopServiceMinutes() {
  const parsed = Number(process.env.TRACKFLEET_STOP_SERVICE_MINUTES ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(0, Math.min(240, Math.round(parsed)));
}

function priorStopSiteIds(delivery: DeliveryRow, deliveries: DeliveryRow[]) {
  if (!delivery.destinationSiteId || isUnassignedVehicle(delivery)) return [];
  const targetTime = timeValue(delivery.plannedArrivalAt);
  const targetVehicle = vehicleKey(delivery);
  const priorSites = new Set<string>();

  for (const candidate of deliveries) {
    if (candidate.id === delivery.id || candidate.status === "Delivered" || !candidate.destinationSiteId || isUnassignedVehicle(candidate)) continue;
    if (vehicleKey(candidate) !== targetVehicle) continue;
    if (candidate.destinationSiteId === delivery.destinationSiteId) continue;
    if (timeValue(candidate.plannedArrivalAt) >= targetTime) continue;
    priorSites.add(candidate.destinationSiteId);
  }
  return [...priorSites];
}

export function pendingServiceMinutesBefore(
  delivery: DeliveryRow,
  deliveries: DeliveryRow[],
  serviceMinutesPerStop = configuredStopServiceMinutes(),
) {
  if (serviceMinutesPerStop <= 0) return 0;
  return priorStopSiteIds(delivery, deliveries).length * serviceMinutesPerStop;
}

export function pendingServiceMinutesBeforeWithHistory(
  delivery: DeliveryRow,
  deliveries: DeliveryRow[],
  learnedMinutesBySite: ReadonlyMap<string, number>,
  fallbackMinutesPerStop = configuredStopServiceMinutes(),
) {
  return priorStopSiteIds(delivery, deliveries).reduce((total, siteId) => {
    const learned = learnedMinutesBySite.get(siteId);
    const minutes = typeof learned === "number" && Number.isFinite(learned)
      ? Math.max(0, Math.min(240, Math.round(learned)))
      : fallbackMinutesPerStop;
    return total + minutes;
  }, 0);
}

export function buildTruckStopPlans(deliveries: DeliveryRow[]): TruckStopPlan[] {
  const active = deliveries.filter((delivery) => delivery.status !== "Delivered" && delivery.destinationSiteId && !isUnassignedVehicle(delivery));
  const groups = new Map<string, DeliveryRow[]>();

  for (const delivery of active) {
    const key = delivery.tripId ? `trip:${delivery.tripId}` : `vehicle:${vehicleKey(delivery)}`;
    const rows = groups.get(key) ?? [];
    rows.push(delivery);
    groups.set(key, rows);
  }

  return [...groups.entries()].map(([, rows]) => {
    const bySite = new Map<string, DeliveryRow[]>();
    for (const row of rows) {
      const siteId = row.destinationSiteId!;
      const siteRows = bySite.get(siteId) ?? [];
      siteRows.push(row);
      bySite.set(siteId, siteRows);
    }

    const stops: TruckStop[] = [...bySite.entries()].map(([siteId, siteRows]) => {
      const ordered = [...siteRows].sort((a, b) => timeValue(a.plannedArrivalAt) - timeValue(b.plannedArrivalAt));
      return {
        siteId,
        destination: ordered[0].destination,
        plannedArrivalAt: ordered[0].plannedArrivalAt,
        deliveryIds: ordered.map((row) => row.id),
        customers: [...new Set(ordered.map((row) => row.customer))],
      };
    }).sort((a, b) => timeValue(a.plannedArrivalAt) - timeValue(b.plannedArrivalAt));

    const first = rows[0];
    const originSiteId = routeOriginSiteId(rows);
    const explicitTripIds = [...new Set(rows.map((delivery) => delivery.tripId).filter((value): value is string => Boolean(value)))];
    return {
      vehicleKey: vehicleKey(first),
      truck: first.truck,
      sendatrackVehicleId: first.sendatrackVehicleId,
      routeTemplateId: routeTemplateId(originSiteId, stops.map((stop) => stop.siteId)),
      tripId: explicitTripIds.length === 1 ? explicitTripIds[0] : null,
      originSiteId,
      source: "planned-arrival" as const,
      stops,
    };
  }).sort((a, b) => a.truck.localeCompare(b.truck));
}

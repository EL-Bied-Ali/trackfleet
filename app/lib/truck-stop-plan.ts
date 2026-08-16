import type { DeliveryRow } from "./delivery-store.types";

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

// Returns only future service time before this delivery's stop. Stops whose
// deliveries are already Delivered are excluded, so elapsed dwell time is not
// counted twice on top of the observed GPS pace.
export function pendingServiceMinutesBefore(
  delivery: DeliveryRow,
  deliveries: DeliveryRow[],
  serviceMinutesPerStop = configuredStopServiceMinutes(),
) {
  if (!delivery.destinationSiteId || serviceMinutesPerStop <= 0) return 0;
  const targetTime = timeValue(delivery.plannedArrivalAt);
  const targetVehicle = vehicleKey(delivery);
  const priorSites = new Set<string>();

  for (const candidate of deliveries) {
    if (candidate.id === delivery.id || candidate.status === "Delivered" || !candidate.destinationSiteId) continue;
    if (vehicleKey(candidate) !== targetVehicle) continue;
    if (candidate.destinationSiteId === delivery.destinationSiteId) continue;
    if (timeValue(candidate.plannedArrivalAt) >= targetTime) continue;
    priorSites.add(candidate.destinationSiteId);
  }

  return priorSites.size * serviceMinutesPerStop;
}

export function buildTruckStopPlans(deliveries: DeliveryRow[]): TruckStopPlan[] {
  const active = deliveries.filter((delivery) => delivery.status !== "Delivered" && delivery.destinationSiteId);
  const byVehicle = new Map<string, DeliveryRow[]>();

  for (const delivery of active) {
    const key = vehicleKey(delivery);
    const rows = byVehicle.get(key) ?? [];
    rows.push(delivery);
    byVehicle.set(key, rows);
  }

  return [...byVehicle.entries()].map(([key, rows]) => {
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
    return {
      vehicleKey: key,
      truck: first.truck,
      sendatrackVehicleId: first.sendatrackVehicleId,
      source: "planned-arrival" as const,
      stops,
    };
  }).sort((a, b) => a.truck.localeCompare(b.truck));
}

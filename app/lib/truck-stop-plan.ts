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

export function buildTruckStopPlans(deliveries: DeliveryRow[]): TruckStopPlan[] {
  const active = deliveries.filter((delivery) => delivery.status !== "Delivered" && delivery.destinationSiteId);
  const byVehicle = new Map<string, DeliveryRow[]>();

  for (const delivery of active) {
    const vehicleKey = delivery.sendatrackVehicleId || delivery.truck;
    const rows = byVehicle.get(vehicleKey) ?? [];
    rows.push(delivery);
    byVehicle.set(vehicleKey, rows);
  }

  return [...byVehicle.entries()].map(([vehicleKey, rows]) => {
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
      vehicleKey,
      truck: first.truck,
      sendatrackVehicleId: first.sendatrackVehicleId,
      source: "planned-arrival" as const,
      stops,
    };
  }).sort((a, b) => a.truck.localeCompare(b.truck));
}

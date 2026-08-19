import { isUnassignedVehicle } from "./delivery-vehicle-choice";

export type OperationalDelivery = {
  id: string;
  customer: string;
  destination: string;
  truck: string;
  status: "In transit" | "Delayed" | "Loading" | "Delivered";
  sendatrackVehicleId?: string | null;
  gpsFresh?: boolean;
  positionAgeMinutes?: number | null;
  etaDelayMinutes?: number | null;
  plannedArrivalAt?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
};

export type OperationalAlertKind =
  | "integration_offline"
  | "vehicle_unassigned"
  | "gps_stale"
  | "eta_severely_delayed"
  | "planned_arrival_overdue"
  | "destination_not_geocoded";

export type OperationalAlert = {
  id: string;
  kind: OperationalAlertKind;
  severity: "critical" | "high" | "medium";
  deliveryId: string | null;
  customer: string | null;
  destination: string | null;
  ageMinutes: number | null;
  delayMinutes: number | null;
};

export type OperationalAlertSummary = {
  alerts: OperationalAlert[];
  critical: number;
  high: number;
  medium: number;
  affectedDeliveries: number;
};

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function active(delivery: OperationalDelivery) {
  return delivery.status !== "Delivered";
}

function overdueMinutes(plannedArrivalAt: string | null | undefined, now: Date) {
  if (!plannedArrivalAt) return null;
  const timestamp = new Date(plannedArrivalAt).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.floor((now.getTime() - timestamp) / 60_000);
  return minutes > 0 ? minutes : null;
}

export function detectOperationalAlerts(
  deliveries: OperationalDelivery[],
  integrationConnected: boolean,
  now = new Date(),
): OperationalAlertSummary {
  const alerts: OperationalAlert[] = [];

  if (!integrationConnected) {
    alerts.push({
      id: "system-integration-offline",
      kind: "integration_offline",
      severity: "critical",
      deliveryId: null,
      customer: null,
      destination: null,
      ageMinutes: null,
      delayMinutes: null,
    });
  }

  for (const delivery of deliveries) {
    if (!active(delivery)) continue;

    if (isUnassignedVehicle(delivery)) {
      alerts.push({
        id: `${delivery.id}:vehicle_unassigned`,
        kind: "vehicle_unassigned",
        severity: "high",
        deliveryId: delivery.id,
        customer: delivery.customer,
        destination: delivery.destination,
        ageMinutes: null,
        delayMinutes: null,
      });
    }

    const positionAgeMinutes = finiteNumber(delivery.positionAgeMinutes);
    if (positionAgeMinutes !== null && positionAgeMinutes > 30) {
      alerts.push({
        id: `${delivery.id}:gps_stale`,
        kind: "gps_stale",
        severity: positionAgeMinutes >= 120 ? "critical" : "high",
        deliveryId: delivery.id,
        customer: delivery.customer,
        destination: delivery.destination,
        ageMinutes: Math.round(positionAgeMinutes),
        delayMinutes: null,
      });
    }

    const delayMinutes = finiteNumber(delivery.etaDelayMinutes);
    if (delayMinutes !== null && delayMinutes >= 60) {
      alerts.push({
        id: `${delivery.id}:eta_severely_delayed`,
        kind: "eta_severely_delayed",
        severity: delayMinutes >= 180 ? "critical" : "high",
        deliveryId: delivery.id,
        customer: delivery.customer,
        destination: delivery.destination,
        ageMinutes: null,
        delayMinutes: Math.round(delayMinutes),
      });
    }

    const overdue = overdueMinutes(delivery.plannedArrivalAt, now);
    if (overdue !== null && overdue >= 30) {
      alerts.push({
        id: `${delivery.id}:planned_arrival_overdue`,
        kind: "planned_arrival_overdue",
        severity: overdue >= 180 ? "critical" : "high",
        deliveryId: delivery.id,
        customer: delivery.customer,
        destination: delivery.destination,
        ageMinutes: overdue,
        delayMinutes: overdue,
      });
    }

    const latitude = finiteNumber(delivery.destinationLatitude);
    const longitude = finiteNumber(delivery.destinationLongitude);
    if (latitude === null || longitude === null) {
      alerts.push({
        id: `${delivery.id}:destination_not_geocoded`,
        kind: "destination_not_geocoded",
        severity: "medium",
        deliveryId: delivery.id,
        customer: delivery.customer,
        destination: delivery.destination,
        ageMinutes: null,
        delayMinutes: null,
      });
    }
  }

  const severityRank = { critical: 0, high: 1, medium: 2 } as const;
  alerts.sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || left.id.localeCompare(right.id));

  return {
    alerts,
    critical: alerts.filter((alert) => alert.severity === "critical").length,
    high: alerts.filter((alert) => alert.severity === "high").length,
    medium: alerts.filter((alert) => alert.severity === "medium").length,
    affectedDeliveries: new Set(alerts.flatMap((alert) => alert.deliveryId ? [alert.deliveryId] : [])).size,
  };
}
